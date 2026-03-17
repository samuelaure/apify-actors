import { NauIGPost } from './types.js';

export class MediaTransformer {
    static transformProfilePost(node: any, profileUsername: string): NauIGPost {
        const author = node.owner || {};
        const isOwner = author.username === profileUsername;

        const post: NauIGPost = {
            id: node.id,
            url: `https://www.instagram.com/p/${node.shortcode}/`,
            caption: node.edge_media_to_caption?.edges?.[0]?.node?.text || '',
            takenAt: new Date(node.taken_at_timestamp * 1000).toISOString(),
            likesCount: node.edge_media_preview_like?.count || 0,
            commentsCount: node.edge_media_to_comment?.count || 0,
            author: {
                id: author.id,
                username: author.username,
                isOwner,
            },
            media: [],
        };

        if (node.__typename === 'GraphSidecar') {
            const children = node.edge_sidecar_to_children?.edges || [];
            for (const child of children) {
                post.media.push(this.extractMediaItem(child.node, true));
            }
        } else {
            post.media.push(this.extractMediaItem(node, false));
        }

        // Add Reel / Product Type markers to metadata if possible (flat properties for dataset)
        if (node.product_type === 'clips') {
            (post as any).isReel = true;
            (post as any).videoDuration = node.video_duration;
            (post as any).playCount = node.play_count || node.video_view_count;
        }

        return post;
    }

    private static extractMediaItem(node: any, isChild: boolean) {
        const isVideo = node.is_video || node.__typename === 'GraphVideo';
        const type = isChild ? 'sidecar_child' : isVideo ? 'video' : 'image';

        // Select highest resolution display resource
        const displayResources = node.display_resources || [];
        const highestRes = [...displayResources].sort((a, b) => (b.config_width * b.config_height) - (a.config_width * a.config_height))[0] || {
            src: node.display_url,
            config_width: node.dimensions?.width,
            config_height: node.dimensions?.height,
        };

        return {
            type: type as any,
            url: isVideo ? (node.video_url || highestRes.src) : highestRes.src,
            width: highestRes.config_width || node.dimensions?.width,
            height: highestRes.config_height || node.dimensions?.height,
            thumbnail: isVideo ? (highestRes.src || node.display_url) : undefined,
            duration: isVideo ? node.video_duration : undefined,
            viewCount: isVideo ? (node.video_view_count || node.play_count) : undefined,
        };
    }
}
