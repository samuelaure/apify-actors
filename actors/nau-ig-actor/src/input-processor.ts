import { Actor } from 'apify';

export interface ActorInput {
    usernames?: string[];
    postUrls?: string[];
    newerThan?: string;
    olderThan?: string;
    limit?: number;
    offset?: number;
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
    sortDirection: 'asc' | 'desc';
    proxyConfiguration: any;
}

export class InputProcessor {
    static async getNormalizedInput(): Promise<NormalizedInput> {
        const input = await Actor.getInput<ActorInput>();
        if (!input) throw new Error('Input is missing.');

        const usernames = (input.usernames || []).map((u) => u.trim().replace(/^@/, '')).filter(Boolean);
        const postUrls = (input.postUrls || []).map((url) => url.trim()).filter(Boolean);

        if (usernames.length === 0 && postUrls.length === 0) {
            throw new Error('At least one username or post URL must be provided.');
        }

        let olderThanDate = input.olderThan ? new Date(input.olderThan) : null;
        if (olderThanDate && input.olderThan && !input.olderThan.includes('T')) {
            olderThanDate.setHours(23, 59, 59, 999);
        }

        return {
            usernames,
            postUrls,
            newerThanDate: input.newerThan ? new Date(input.newerThan) : null,
            olderThanDate: olderThanDate,
            limit: input.limit ?? 100,
            offset: input.offset ?? 0,
            sortDirection: input.sortDirection ?? 'desc',
            proxyConfiguration: input.proxyConfiguration,
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
