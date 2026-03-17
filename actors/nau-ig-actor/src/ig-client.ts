import { gotScraping } from 'got-scraping';
import { log } from 'apify';

export class IGClient {
    private proxyUrl?: string;
    private sessionKey: string;
    private cookies: string[] = [];

    constructor(proxyUrl?: string) {
        this.proxyUrl = proxyUrl;
        // Unique session key per client instance to maintain sticky proxy sessions
        this.sessionKey = Math.random().toString(36).substring(2, 12);
    }

    private async request(url: string, searchParams?: Record<string, string>, extraHeaders?: Record<string, string>) {
        try {
            const response = await gotScraping({
                url,
                searchParams,
                proxyUrl: this.proxyUrl,
                // We rely on proxyUrl already containing the session if needed, 
                // or got-scraping managing headers via internal state.
                headers: {
                    'accept': '*/*',
                    'accept-language': 'en-US,en;q=0.9',
                    'sec-ch-ua': '"Not(A:Bar";v="99", "Google Chrome";v="133", "Chromium";v="133"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-origin',
                    'cookie': this.cookies.join('; '),
                    ...extraHeaders,
                },
                headerGeneratorOptions: {
                    browsers: [{ name: 'chrome', minVersion: 120 }],
                    devices: ['desktop'],
                    locales: ['en-US'],
                },
            });

            // Update internal cookie store
            const setCookie = response.headers['set-cookie'];
            if (setCookie) {
                this.cookies = [...new Set([...this.cookies, ...(Array.isArray(setCookie) ? setCookie : [setCookie])])];
            }

            return response.body;
        } catch (error: any) {
            if (error.response?.statusCode === 429) {
                log.warning(`Rate limited by Instagram (429). Proxy: ${this.proxyUrl?.split('@').pop()}`);
            }
            log.error(`Request failed: ${url}`, { 
                error: error.message,
                statusCode: error.response?.statusCode 
            });
            throw error;
        }
    }

    /**
     * Performs a warm-up request to establish session cookies
     */
    private async warmUp(username: string) {
        log.debug(`Performing warm-up session discovery for ${username}...`);
        try {
            await this.request(`https://www.instagram.com/${username}/`);
        } catch (error: any) {
            log.debug(`Warm-up failed, continuing anyway: ${error.message}`);
        }
    }

    async getUserIdAndInitialData(username: string): Promise<{ userId: string; initialData?: any }> {
        log.info(`Attempting to fetch User ID and initial data for ${username}...`);

        // 1. Establish session
        await this.warmUp(username);

        const commonHeaders = {
            'x-ig-app-id': '936619743392459',
            'x-asbd-id': '129477',
            'x-requested-with': 'XMLHttpRequest',
            'referer': `https://www.instagram.com/${username}/`,
        };

        // Option 1: web_profile_info API
        try {
            const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
            const body = await this.request(url, {}, commonHeaders);
            const data = JSON.parse(body);
            const user = data?.data?.user || data?.data?.xdt_api__v1__feed__user__timeline_graphql_fixed?.user;
            if (user?.id) {
                log.info(`Found User data via web_profile_info for ${username}`);
                return { 
                    userId: user.id, 
                    initialData: user.edge_owner_to_timeline_media 
                };
            }
        } catch (error: any) {
            log.debug(`web_profile_info failed for ${username}: ${error.message}`);
        }

        // Option 2: Legacy __a=1 endpoint
        try {
            const url = `https://www.instagram.com/${username}/?__a=1&__d=dis`;
            const body = await this.request(url, {}, commonHeaders);
            const data = JSON.parse(body);
            const user = data?.graphql?.user || data?.user;
            if (user?.id) {
                log.info(`Found User data via __a=1 for ${username}`);
                return { 
                    userId: user.id, 
                    initialData: user.edge_owner_to_timeline_media || user.edge_felix_video_timeline
                };
            }
        } catch (error: any) {
            log.debug(`__a=1 failed for ${username}: ${error.message}`);
        }

        // Option 3: Profile Page Source Extraction (Fallback)
        try {
            const profileUrl = `https://www.instagram.com/${username}/`;
            const html = await this.request(profileUrl, {}, commonHeaders);
            const idMatch = html.match(/profilePage_(\d+)/) || html.match(/"profile_id":"(\d+)"/) || html.match(/"id":"(\d+)"/);
            if (idMatch?.[1]) {
                log.info(`Found User ID via page source: ${idMatch[1]}`);
                return { userId: idMatch[1] };
            }
        } catch (error: any) {
            log.debug(`Page source extraction failed for ${username}: ${error.message}`);
        }

        throw new Error(`Could not find User ID for username: ${username}. The account might be private, restricted, or the scraper is blocked.`);
    }

    async getProfileFeed(userId: string, first: number = 50, after?: string) {
        // Modern Instagram uses doc_id for PolarisProfilePostsQuery
        const DOC_ID = '7950326061742207'; 
        const variables = { 
            id: userId, 
            first, 
            after 
        };
        
        const url = `https://www.instagram.com/graphql/query/?doc_id=${DOC_ID}&variables=${JSON.stringify(variables)}`;
        const body = await this.request(url, {}, { 'x-ig-app-id': '936619743392459', 'x-asbd-id': '129477' });
        const response = JSON.parse(body);
        
        const timeline = response?.data?.user?.edge_owner_to_timeline_media 
            || response?.data?.xdt_api__v1__feed__user__timeline_graphql_fixed?.edge_owner_to_timeline_media;

        if (!timeline) {
            log.debug(`Response keys: ${Object.keys(response || {})}`);
            if (response?.data) log.debug(`Data keys: ${Object.keys(response.data)}`);
        }

        return timeline;
    }

    async getPostDetails(shortcode: string) {
        // Alternative method for single posts
        const url = `https://www.instagram.com/p/${shortcode}/?__a=1&__d=dis`;
        const body = await this.request(url);
        return JSON.parse(body);
    }
}


