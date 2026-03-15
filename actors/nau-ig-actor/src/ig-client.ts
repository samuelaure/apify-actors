import { gotScraping } from 'got-scraping';
import { log } from 'apify';

export class IGClient {
    private proxyUrl?: string;

    constructor(proxyUrl?: string) {
        this.proxyUrl = proxyUrl;
    }

    private async request(url: string, searchParams?: Record<string, string>, extraHeaders?: Record<string, string>) {
        try {
            const response = await gotScraping({
                url,
                searchParams,
                proxyUrl: this.proxyUrl,
                headers: {
                    ...extraHeaders,
                },
                headerGeneratorOptions: {
                    browsers: [{ name: 'chrome', minVersion: 120 }],
                    devices: ['desktop'],
                    locales: ['en-US'],
                },
            });
            return response.body;
        } catch (error: any) {
            log.error(`Request failed: ${url}`, { error: error.message });
            throw error;
        }
    }

    async getUserIdAndInitialData(username: string): Promise<{ userId: string; initialData?: any }> {
        log.info(`Attempting to fetch User ID and initial data for ${username}...`);

        const headers = {
            'x-ig-app-id': '936619743392459',
            'x-asbd-id': '359341',
            'x-requested-with': 'XMLHttpRequest',
            'referer': `https://www.instagram.com/${username}/`,
        };

        // Option 1: web_profile_info API
        try {
            const url = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
            const body = await this.request(url, {}, headers);
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
            const body = await this.request(url, {}, headers);
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
            const html = await this.request(profileUrl, {}, headers);
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
        
        const headers = {
            'x-ig-app-id': '936619743392459',
            'x-asbd-id': '359341',
            'x-requested-with': 'XMLHttpRequest',
        };

        const url = `https://www.instagram.com/graphql/query/?doc_id=${DOC_ID}&variables=${JSON.stringify(variables)}`;
        const body = await this.request(url, {}, headers);
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


