export interface NauIGPost {
    id: string;
    shortcode: string;
    url: string;
    caption: string;
    takenAt: string; // ISO string
    likesCount: number;
    commentsCount: number;
    videoViewCount?: number;
    playCount?: number;
    author: {
        id: string;
        username: string;
        fullName?: string;
        profilePicUrl?: string;
        isVerified?: boolean;
        isOwner: boolean;
    };
    location?: {
        id: string;
        name: string;
        slug: string;
    };
    hashtags: string[];
    mentions: string[];
    media: NauIGMedia[];
    isPinned: boolean;
    isReel: boolean;
    videoDuration?: number;
    productType?: string;
    music?: {
        id: string;
        title: string;
        artist: string;
    };
    comments?: NauIGComment[];
}

export interface NauIGMedia {
    type: 'image' | 'video' | 'sidecar_child';
    url: string;
    width: number;
    height: number;
    thumbnail?: string;
    duration?: number;
    viewCount?: number;
}

export interface NauIGComment {
    id: string;
    text: string;
    author: string;
    authorId: string;
    authorProfilePic: string;
    takenAt: string;
    likesCount: number;
    replyCount: number;
}

export interface NauIGProfile {
    id: string;
    username: string;
    fullName: string;
    biography: string;
    profilePicUrl: string;
    profilePicUrlHD?: string;
    followersCount: number;
    followsCount: number;
    postsCount: number;
    externalUrl?: string;
    isBusinessAccount: boolean;
    isVerified: boolean;
}
