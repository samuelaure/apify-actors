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
    
    // We will create the client inside the loop to ensure per-profile sticky sessions
    const allResults: NauIGPost[] = [];

    // Process Usernames
    for (const username of input.usernames) {
        log.info(`Scraping profile: ${username}`);
        try {
            // Per-profile sticky session for proxy
            const sessionKey = `user_${username.toLowerCase()}_${Math.random().toString(36).substring(2, 7)}`;
            const proxyUrl = await proxyConfiguration?.newUrl(sessionKey);
            const client = new IGClient(proxyUrl);

            const stateKey = `state-${username}`;
            const state = await Actor.useState<{ 
                after?: string, 
                count: number,
                hasNextPage: boolean,
                isFinished: boolean 
            }>(stateKey, {
                count: 0,
                hasNextPage: true,
                isFinished: false
            });

            if (state.isFinished) {
                log.info(`Profile ${username} already processed in previous run. Skipping.`);
                continue;
            }

            const { userId, initialData } = await client.getUserIdAndInitialData(username);
            let firstExecution = !state.after && state.count === 0;

            while (state.hasNextPage && state.count < input.limit + input.offset) {
                let timeline;
                if (firstExecution && initialData) {
                    timeline = initialData;
                    log.info(`Using initial data (first page) for ${username}`);
                } else {
                    // Random delay to mimic human behavior (3-8 seconds)
                    const delay = Math.floor(Math.random() * 5000) + 3000;
                    log.info(`Wait ${delay}ms before next request...`);
                    await new Promise(resolve => setTimeout(resolve, delay));

                    timeline = await client.getProfileFeed(userId, 50, state.after);
                }
                
                firstExecution = false;
                const pageInfo = timeline?.page_info;
                const edges = timeline?.edges || [];

                log.info(`Processing ${edges.length} nodes for ${username}`);

                // Block Detection: Public profile with posts but 0 nodes returned
                if (edges.length === 0 && state.hasNextPage) {
                   log.warning(`Received 0 nodes for ${username} but page_info says has_next_page. Possible block or rate limit.`);
                   // We could rotate session here or just stop to avoid wasting credits
                   break;
                }

                for (const edge of edges) {
                    const node = edge.node;
                    const takenAt = new Date(node.taken_at_timestamp * 1000);

                    // Date Framing
                    if (input.newerThanDate && takenAt < input.newerThanDate) {
                        log.info(`Reached post older than ${input.newerThanDate.toISOString()}. Stopping.`);
                        state.hasNextPage = false;
                        break;
                    }
                    if (input.olderThanDate && takenAt > input.olderThanDate) {
                        log.info(`Skipping post newer than ${input.olderThanDate.toISOString()} (taken: ${takenAt.toISOString()})`);
                        continue;
                    }

                    // Offset & Limit
                    if (state.count >= input.offset) {
                        const post = MediaTransformer.transformProfilePost(node, username);
                        allResults.push(post);
                    }

                    state.count++;
                    if (state.count >= input.limit + input.offset) {
                        state.hasNextPage = false;
                        break;
                    }
                }

                state.after = pageInfo?.end_cursor;
                state.hasNextPage = state.hasNextPage && pageInfo?.has_next_page;

                // Mandatory break every ~100 posts
                if (state.count > 0 && state.count % 100 === 0) {
                    log.info(`Mandatory cool-down break (30s)...`);
                    await new Promise(resolve => setTimeout(resolve, 30000));
                }
            }
            state.isFinished = true;
        } catch (error: any) {
            log.error(`Failed to scrape profile ${username}: ${error.message}`);
        }
    }

    // Process Direct URLs
    for (const postUrl of input.postUrls) {
        log.info(`Scraping direct URL: ${postUrl}`);
        try {
            const proxyUrl = await proxyConfiguration?.newUrl();
            const client = new IGClient(proxyUrl);

            const shortcode = postUrl.match(/\/p\/([^/]+)/)?.[1] || postUrl.match(/\/reels\/([^/]+)/)?.[1] || postUrl.match(/\/tv\/([^/]+)/)?.[1];
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
