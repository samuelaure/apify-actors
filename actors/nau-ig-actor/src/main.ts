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
    const allResults: any[] = [];

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

            // Handshake Recovery Loop with Proxy Rotation
            const kv = await Actor.openKeyValueStore();
            let userId = (await kv.getValue<string>(`id-${username.toLowerCase()}`)) || '';
            let initialData: any;
            let fullProfile: any;

            let handshakeAttempts = 0;
            const maxHandshakeAttempts = 3;

            while (handshakeAttempts < maxHandshakeAttempts) {
                try {
                    const handshake = await client.getUserIdAndInitialData(username);
                    userId = handshake.userId;
                    initialData = handshake.initialData;
                    fullProfile = handshake.fullProfile;
                    
                    // Cache the ID for future 0-cost handshakes
                    if (userId) await kv.setValue(`id-${username.toLowerCase()}`, userId);
                    break; 
                } catch (err: any) {
                    handshakeAttempts++;
                    if (handshakeAttempts >= maxHandshakeAttempts) throw err;
                    
                    log.warning(`Handshake failed for ${username} (Attempt ${handshakeAttempts}). Rotating proxy...`);
                    // Rotate proxy session
                    const newSessionKey = `user_${username.toLowerCase()}_${Math.random().toString(36).substring(2, 7)}`;
                    const newProxyUrl = await proxyConfiguration?.newUrl(newSessionKey);
                    client.setProxy(newProxyUrl!);
                    await new Promise(resolve => setTimeout(resolve, handshakeAttempts * 5000));
                }
            }
            
            // Push profile info as the first result for this user (Useful for nauthenticity/9nau)
            if (fullProfile) {
                allResults.push(MediaTransformer.transformProfile(fullProfile));
            }

            if (input.mode === 'PROFILE') {
                state.isFinished = true;
                continue;
            }

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

                    // Retry Logic for individual pagination requests
                    let attempts = 0;
                    const maxAttempts = 3;
                    while (attempts < maxAttempts) {
                        try {
                            timeline = await client.getProfileFeed(userId, 50, state.after);
                            break; // Success
                        } catch (err: any) {
                            attempts++;
                            if (attempts >= maxAttempts) throw err;
                            const retryDelay = attempts * 10000;
                            log.warning(`Pagination request failed (attempt ${attempts}/${maxAttempts}): ${err.message}. Retrying in ${retryDelay}ms...`);
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                        }
                    }
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
                    const isPinned = !!(node.is_pinned || node.pinned);
                    if (input.newerThanDate && takenAt < input.newerThanDate) {
                        if (isPinned) {
                            log.info(`Skipping pinned post older than range: ${takenAt.toISOString()}`);
                            continue;
                        }
                        
                        if (firstExecution) {
                            log.info(`Skipping old post on first page (potential pin): ${takenAt.toISOString()}`);
                            continue;
                        }

                        log.info(`Reached post older than ${input.newerThanDate.toISOString()} on page ${state.count / 50 + 1}. Stopping.`);
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
                        
                        // Fetch comments if needed
                        if (input.maxComments > 0 || input.mode === 'COMMENTS') {
                            const rawComments = await client.getComments(post.shortcode, input.maxComments, input.includeReplies);
                            post.comments = rawComments.map((c: any) => MediaTransformer.transformComment(c));
                        }

                        allResults.push(post);
                    }

                    state.count++;
                    if (state.count >= input.limit + input.offset) {
                        state.hasNextPage = false;
                        break;
                    }
                }

                if (state.count > 0 && state.count % 100 === 0) {
                    log.info(`Mandatory cool-down break (30s)...`);
                    await new Promise(resolve => setTimeout(resolve, 30000));
                }

                state.after = pageInfo?.end_cursor;
                state.hasNextPage = state.hasNextPage && pageInfo?.has_next_page;
                firstExecution = false;
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
            const node = response;
            if (!node) throw new Error(`Could not find post data for shortcode: ${shortcode}`);

            // Fetch and push owner profile first (Useful for 9nau context)
            const postAuthor = node.owner || node.user || {};
            if (postAuthor.username) {
                try {
                    const { fullProfile } = await client.getUserIdAndInitialData(postAuthor.username);
                    if (fullProfile) {
                        allResults.push(MediaTransformer.transformProfile(fullProfile));
                    }
                } catch (e: any) {
                    log.debug(`Could not fetch profile for post owner ${postAuthor.username}: ${e.message}`);
                }
            }

            const post = MediaTransformer.transformProfilePost(node, ''); 
            
            // Fetch comments if needed
            if (input.maxComments > 0 || input.mode === 'COMMENTS') {
                const rawComments = await client.getComments(post.shortcode, input.maxComments, input.includeReplies);
                post.comments = rawComments.map((c: any) => MediaTransformer.transformComment(c));
            }

            allResults.push(post);
        } catch (error: any) {
            log.error(`Failed to scrape post ${postUrl}: ${error.message}`);
        }
    }


    // Sorting (Separate profile from posts to avoid NaN dates)
    const profileResults = allResults.filter(r => !r.takenAt); // Profiles/Metadata
    const postResults = allResults.filter(r => r.takenAt);     // Posts

    if (input.sortDirection === 'asc') {
        postResults.sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime());
    } else {
        postResults.sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime());
    }

    const finalResults = [...profileResults, ...postResults];

    // Push to Dataset
    log.info(`Pushing ${finalResults.length} results to dataset.`);
    await Dataset.pushData(finalResults);

} catch (error: any) {
    log.error(`Actor failed: ${error.message}`);
}

await Actor.exit();
