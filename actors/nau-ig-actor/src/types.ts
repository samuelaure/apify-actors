export interface NauIGPost {
    id: string;
    url: string;
    caption: string;
    takenAt: string; // ISO string
    likesCount: number;
    commentsCount: number;
    author: {
        id: string;
        username: string;
        isOwner: boolean;
    };
    media: Array<{
        type: 'image' | 'video' | 'sidecar_child';
        url: string;
        width: number;
        height: number;
        thumbnail?: string;
        duration?: number;
        viewCount?: number;
    }>;
}
