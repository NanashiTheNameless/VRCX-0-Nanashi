import type { PresenceView } from '@/domain/friends/presence';

type UserFactSource =
    | 'seed'
    | 'instance'
    | 'playerSnapshot'
    | 'friend'
    | 'profile'
    | 'realtime'
    | 'currentUser';

interface UserFactMergeOptions {
    endpoint?: string;
    source?: UserFactSource;
    isCurrentUser?: boolean;
    isFriend?: boolean;
}

interface UserFact {
    [key: string]: unknown;
    id: string;
    endpoint: string;
    username?: string;
    displayName?: string;
    iconUrl?: string;
    currentAvatar?: string;
    currentAvatarImageUrl?: string;
    currentAvatarThumbnailImageUrl?: string;
    currentAvatarName?: string;
    status?: string;
    statusDescription?: string;
    friendNumber?: number;
    isCurrentUser?: boolean;
    isFriend?: boolean;
    isBoopingEnabled?: boolean;
    hasSharedConnectionsOptOut?: boolean;
    tags?: string[];
    platform?: string;
    last_platform?: string;
    developerType?: string;
    $trustLevel?: string;
    $trustClass?: string;
    $trustSortNum?: number;
    $isModerator?: boolean;
    $isTroll?: boolean;
    $isProbableTroll?: boolean;
    $platform?: string;
    $presence?: PresenceView;
    memo?: string;
    note?: string;
    updatedAt: string;
}

function normalizeText(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeUserId(value: unknown): string {
    return normalizeText(value);
}

function normalizeEndpoint(value: unknown): string {
    return normalizeText(value) || 'default';
}

function userFactKey(endpoint: unknown, userId: unknown): string {
    const normalizedUserId = normalizeUserId(userId);
    return normalizedUserId
        ? `${normalizeEndpoint(endpoint)}::${normalizedUserId}`
        : '';
}

export { normalizeEndpoint, normalizeUserId, userFactKey };
export type { UserFact, UserFactMergeOptions, UserFactSource };
