import { Actor } from 'apify';
import { Dataset, log } from '@crawlee/cheerio';
import { InputProcessor } from './input-processor.js';
import { IGClient } from './ig-client.js';
import { MediaTransformer } from './media-transformer.js';
import { NauIGPost } from './types.js';

await Actor.init();

try {
    const input = await InputProcessor.getNormalizedInput();
    InputProcessor.validateDates(input);

    const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);
    const proxyUrl = await proxyConfiguration?.newUrl();
    const client = new IGClient(proxyUrl);

    const allResults: NauIGPost[] = [];

    // Process Usernames
    for (const username of input.usernames) {
        log.info(`Scraping profile: ${username}`);
        try {
            const { userId, initialData } = await client.getUserIdAndInitialData(username);
            let hasNextPage = true;
            let after: string | undefined;
            let count = 0;
            let firstExecution = true;

            while (hasNextPage && count < input.limit + input.offset) {
                let timeline;
                if (firstExecution && initialData) {
                    timeline = initialData;
                    log.info(`Using initial data (first page) for ${username}`);
                } else {
                    timeline = await client.getProfileFeed(userId, 50, after);
                }
                
                firstExecution = false;
                const pageInfo = timeline?.page_info;
                const edges = timeline?.edges || [];

                log.info(`Processing ${edges.length} nodes for ${username}`);

                for (const edge of edges) {
                    const node = edge.node;
                    const takenAt = new Date(node.taken_at_timestamp * 1000);

                    // Date Framing
                    if (input.newerThanDate && takenAt < input.newerThanDate) {
                        log.info(`Reached post older than ${input.newerThanDate.toISOString()}. Stopping.`);
                        hasNextPage = false;
                        break;
                    }
                    if (input.olderThanDate && takenAt > input.olderThanDate) {
                        log.info(`Skipping post newer than ${input.olderThanDate.toISOString()} (taken: ${takenAt.toISOString()})`);
                        continue;
                    }

                    // Offset & Limit
                    if (count >= input.offset) {
                        const post = MediaTransformer.transformProfilePost(node, username);
                        allResults.push(post);
                    }

                    count++;
                    if (count >= input.limit + input.offset) {
                        hasNextPage = false;
                        break;
                    }
                }

                after = pageInfo?.end_cursor;
                hasNextPage = hasNextPage && pageInfo?.has_next_page;
            }
        } catch (error: any) {
            log.error(`Failed to scrape profile ${username}: ${error.message}`);
        }
    }

    // Process Direct URLs
    for (const postUrl of input.postUrls) {
        log.info(`Scraping direct URL: ${postUrl}`);
        try {
            const shortcode = postUrl.match(/\/p\/([^/]+)/)?.[1] || postUrl.match(/\/reels\/([^/]+)/)?.[1];
            if (!shortcode) throw new Error(`Could not extract shortcode from URL: ${postUrl}`);

            const response = await client.getPostDetails(shortcode);
            const node = response?.items?.[0] || response?.graphql?.shortcode_media;
            if (!node) throw new Error(`Could not find post data for shortcode: ${shortcode}`);

            // Transformation logic might differ slightly for different endpoints
            // but we'll try to reuse MediaTransformer or adjust it
            // For now, assume __a=1 response structure
            const post = MediaTransformer.transformProfilePost(node, ''); 
            allResults.push(post);
        } catch (error: any) {
            log.error(`Failed to scrape post ${postUrl}: ${error.message}`);
        }
    }


    // Sorting
    if (input.sortDirection === 'asc') {
        allResults.sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());
    } else {
        allResults.sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime());
    }

    // Push to Dataset
    log.info(`Pushing ${allResults.length} results to dataset.`);
    await Dataset.pushData(allResults);

} catch (error: any) {
    log.error(`Actor failed: ${error.message}`);
}

await Actor.exit();
