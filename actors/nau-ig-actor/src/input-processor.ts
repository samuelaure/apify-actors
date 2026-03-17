import { Actor } from 'apify';

export interface ActorInput {
    usernames?: string[];
    postUrls?: string[];
    newerThan?: string;
    olderThan?: string;
    limit?: number;
    offset?: number;
    maxComments?: number;
    mode?: 'FEED' | 'PROFILE' | 'COMMENTS';
    sortDirection?: 'asc' | 'desc';
    proxyConfiguration?: any;
}

export interface NormalizedInput {
    usernames: string[];
    postUrls: string[];
    newerThanDate: Date | null;
    olderThanDate: Date | null;
    limit: number;
    offset: number;
    maxComments: number;
    mode: 'FEED' | 'PROFILE' | 'COMMENTS';
    sortDirection: 'asc' | 'desc';
    proxyConfiguration: any;
}

export class InputProcessor {
    static async getNormalizedInput(): Promise<NormalizedInput> {
        const input = await Actor.getInput<ActorInput>();
        if (!input) throw new Error('Input is missing.');

        const usernamesRaw = input.usernames || [];
        const postUrlsRaw = input.postUrls || [];

        const usernames: string[] = [];
        const postUrls: string[] = [];

        // Enhanced Recognition Logic
        [...usernamesRaw, ...postUrlsRaw].forEach(item => {
            const trimmed = item.trim();
            if (!trimmed) return;

            // 1. Detect if it's a specific post URL
            if (trimmed.includes('/p/') || trimmed.includes('/reels/') || trimmed.includes('/tv/')) {
                postUrls.push(trimmed);
                return;
            }

            // 2. Detect if it's a profile URL or just a username
            // Handles: @user, user, https://instagram.com/user, instagram.com/user/
            let username = trimmed;
            if (trimmed.includes('instagram.com/')) {
                // Extract username from URL path
                const path = trimmed.split('instagram.com/')[1];
                username = path.split('/')[0].split('?')[0];
            }
            
            username = username.replace(/^@/, '');
            
            if (username && !postUrls.includes(trimmed)) {
                usernames.push(username);
            }
        });

        const uniqueUsernames = [...new Set(usernames)];
        const uniquePostUrls = [...new Set(postUrls)];

        if (uniqueUsernames.length === 0 && uniquePostUrls.length === 0) {
            throw new Error('At least one username or post URL must be provided.');
        }

        let olderThanDate = input.olderThan ? new Date(input.olderThan) : null;
        if (olderThanDate && input.olderThan && !input.olderThan.includes('T')) {
            olderThanDate.setHours(23, 59, 59, 999);
        }

        // Force Residential Proxies natively if not specified otherwise or if Apify Proxy is enabled
        const proxyConfig = input.proxyConfiguration || { useApifyProxy: true };
        if (proxyConfig.useApifyProxy && (!proxyConfig.apifyProxyGroups || proxyConfig.apifyProxyGroups.length === 0)) {
            proxyConfig.apifyProxyGroups = ['RESIDENTIAL'];
        }

        return {
            usernames: uniqueUsernames,
            postUrls: uniquePostUrls,
            newerThanDate: input.newerThan ? new Date(input.newerThan) : null,
            olderThanDate: olderThanDate,
            limit: input.limit ?? 100,
            offset: input.offset ?? 0,
            maxComments: input.maxComments ?? 20,
            mode: input.mode ?? 'FEED',
            sortDirection: input.sortDirection ?? 'desc',
            proxyConfiguration: proxyConfig,
        };
    }

    static validateDates(input: NormalizedInput) {
        if (input.newerThanDate && isNaN(input.newerThanDate.getTime())) {
            throw new Error('Invalid newerThan date format.');
        }
        if (input.olderThanDate && isNaN(input.olderThanDate.getTime())) {
            throw new Error('Invalid olderThan date format.');
        }
    }
}
