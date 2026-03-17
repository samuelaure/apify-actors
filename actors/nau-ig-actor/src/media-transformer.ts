import { NauIGPost, NauIGMedia, NauIGComment, NauIGProfile } from './types.js';

export class MediaTransformer {
    static transformProfilePost(node: any, profileUsername: string): NauIGPost {
        const author = node.owner || node.user || {};
        const isOwner = author.username === profileUsername;
        const caption = node.edge_media_to_caption?.edges?.[0]?.node?.text || node.caption?.text || '';

        const post: NauIGPost = {
            id: node.id,
            shortcode: node.shortcode || node.code,
            url: `https://www.instagram.com/p/${node.shortcode || node.code}/`,
            caption,
            takenAt: new Date((node.taken_at_timestamp || node.taken_at || node.pk) * 1000).toISOString(),
            likesCount: node.edge_media_preview_like?.count || node.like_count || 0,
            commentsCount: node.edge_media_to_comment?.count || node.edge_threaded_comments?.count || node.comment_count || 0,
            videoViewCount: node.video_view_count,
            playCount: node.play_count || node.video_play_count,
            author: {
                id: author.id || author.pk,
                username: author.username,
                fullName: author.full_name,
                profilePicUrl: author.profile_pic_url,
                isVerified: !!author.is_verified,
                isOwner,
            },
            location: node.location ? {
                id: node.location.id,
                name: node.location.name,
                slug: node.location.slug,
            } : undefined,
            hashtags: this.extractHashtags(caption),
            mentions: this.extractMentions(caption),
            media: [],
            isReel: node.product_type === 'clips',
            videoDuration: node.video_duration,
            productType: node.product_type,
            music: node.clips_music_attribution_info ? {
                id: node.clips_music_attribution_info.audio_id,
                title: node.clips_music_attribution_info.song_name,
                artist: node.clips_music_attribution_info.artist_name,
            } : undefined,
        };

        if (node.__typename === 'GraphSidecar') {
            const children = node.edge_sidecar_to_children?.edges || [];
            for (const child of children) {
                post.media.push(this.extractMediaDetail(child.node, true));
            }
        } else {
            post.media.push(this.extractMediaDetail(node, false));
        }

        // Handle comments if they were fetched (usually only on post-details mode)
        const commentEdges = node.edge_threaded_comments?.edges || node.edge_media_to_comment?.edges || [];
        if (commentEdges.length > 0) {
            post.comments = commentEdges.map((edge: any) => this.transformComment(edge.node));
        }

        return post;
    }

    static transformProfile(rawUser: any): NauIGProfile {
        return {
            id: rawUser.id,
            username: rawUser.username,
            fullName: rawUser.full_name || '',
            biography: rawUser.biography || '',
            profilePicUrl: rawUser.profile_pic_url || '',
            profilePicUrlHD: rawUser.hd_profile_pic_url_info?.url || rawUser.profile_pic_url_hd,
            followersCount: rawUser.edge_followed_by?.count || 0,
            followsCount: rawUser.edge_follow?.count || 0,
            postsCount: rawUser.edge_owner_to_timeline_media?.count || 0,
            externalUrl: rawUser.external_url,
            isBusinessAccount: !!rawUser.is_business_account,
            isVerified: !!rawUser.is_verified,
        };
    }

    static transformComment(node: any): NauIGComment {
        const author = node.owner || node.user || {};
        const comment: NauIGComment = {
            id: (node.id || node.pk).toString(),
            text: node.text || '',
            author: author.username || '',
            authorId: (author.id || author.pk).toString(),
            authorProfilePic: author.profile_pic_url || '',
            takenAt: new Date((node.created_at || node.created_at_utc) * 1000).toISOString(),
            likesCount: node.edge_liked_by?.count || node.comment_like_count || 0,
            replyCount: node.edge_threaded_comments?.count || node.child_comment_count || 0,
        };

        // If child comments (replies) are present from deeper scrape
        if (node.child_comments?.length > 0) {
            (comment as any).replies = node.child_comments.map((reply: any) => this.transformComment(reply));
        }

        return comment;
    }

    private static extractMediaDetail(node: any, isChild: boolean): NauIGMedia {
        const isVideo = !!node.is_video || node.__typename === 'GraphVideo';
        const type = isChild ? 'sidecar_child' : isVideo ? 'video' : 'image';

        // Select highest resolution display resource
        const displayResources = node.display_resources || [];
        const highestRes = [...displayResources].sort((a, b) => 
            (b.config_width * b.config_height) - (a.config_width * a.config_height)
        )[0] || {
            src: node.display_url,
            config_width: node.dimensions?.width,
            config_height: node.dimensions?.height,
        };

        return {
            type,
            url: isVideo ? (node.video_url || highestRes.src) : highestRes.src,
            width: highestRes.config_width || node.dimensions?.width,
            height: highestRes.config_height || node.dimensions?.height,
            thumbnail: isVideo ? (highestRes.src || node.display_url) : undefined,
            duration: node.video_duration,
            viewCount: node.video_view_count || node.play_count,
        };
    }

    private static extractHashtags(text: string): string[] {
        if (!text) return [];
        const matches = text.match(/#[\w\u00C0-\u017F]+/g);
        return matches ? [...new Set(matches.map(h => h.slice(1)))] : [];
    }

    private static extractMentions(text: string): string[] {
        if (!text) return [];
        const matches = text.match(/@[\w.]+/g);
        return matches ? [...new Set(matches.map(m => m.slice(1)))] : [];
    }
}
