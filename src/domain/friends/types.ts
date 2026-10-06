import type { LoadStatus } from '../shared/types';
import type { PresenceEntry, PresenceView } from './presence';

export type FriendRosterBucket = 'online' | 'active' | 'offline';
type FriendRosterLoadStatus = LoadStatus;

export const FRIEND_PROFILE_STRING_FIELDS = [
    'ageVerificationStatus',
    'bannerColor',
    'bannerType',
    'bannerUrl',
    'discordId',
    'friendKey',
    'iconFrame',
    'iconUrl',
    'nameplateEffect',
    'profileEffect',
    'status',
    'statusDescription'
] as const;

export const FRIEND_PROFILE_BOOLEAN_FIELDS = [
    'ageVerified',
    'allowAvatarCopying'
] as const;

export type FriendProfileFields = Partial<
    Record<(typeof FRIEND_PROFILE_STRING_FIELDS)[number], string | null>
> &
    Partial<Record<(typeof FRIEND_PROFILE_BOOLEAN_FIELDS)[number], boolean>> & {
        badges?: unknown[];
    };

export type FriendRecordInput = Record<string, unknown> & {
    id?: string;
    userId?: string;
    user_id?: string;
    displayName?: string;
    username?: string;
    tags?: string[];
    developerType?: string;
    platform?: string;
    last_platform?: string;
    lastPlatform?: string;
    $trustLevel?: string;
    $friendNumber?: number;
    $trustClass?: string;
    $trustSortNum?: number;
    $isModerator?: boolean;
    $isTroll?: boolean;
    $isProbableTroll?: boolean;
    $platform?: string;
    $profileSource?: string;
    $presence?: PresenceView;
};

export type FriendRecord = FriendRecordInput &
    FriendProfileFields & {
        id: string;
        displayName: string;
        tags: string[];
        $presence: PresenceView;
        $trustLevel: string;
        $friendNumber: number;
        $trustClass: string;
        $trustSortNum: number;
        $isModerator: boolean;
        $isTroll: boolean;
        $isProbableTroll: boolean;
        $platform: string;
    };

export type FriendRosterById = Record<string, FriendRecord>;
export type FriendRosterInputById = Record<string, FriendRecordInput>;

export type FriendRosterOrdering = {
    onlineIds: string[];
    activeIds: string[];
    offlineIds: string[];
    orderedFriendIds: string[];
};

type FriendRosterSnapshot = FriendRosterOrdering & {
    currentUserId: string | null;
    friendsById: FriendRosterById;
    detail?: string;
};

export type FriendPresenceById = Record<string, PresenceEntry>;

export type FriendRosterSnapshotInput = {
    currentUserId?: string | null;
    friendsById?: FriendRosterInputById | null;
    presenceById?: FriendPresenceById | null;
    generation?: number | null;
    detail?: string;
};

export type FriendPatchEntry = {
    userId?: string;
    patch?: FriendRecordInput | null;
    presence?: PresenceEntry;
    generation?: number;
};

export type FriendRosterState = FriendRosterSnapshot & {
    presenceRevById: Record<string, number>;
    presenceGeneration: number | null;
    loadStatus: FriendRosterLoadStatus;
    detail: string;
    lastLoadedAt: string | null;
};

export type FriendRosterStore = FriendRosterState & {
    setRosterLoading(currentUserId: string, detail?: string): void;
    setRosterReady(detail?: string): void;
    setRosterSnapshot(snapshot: FriendRosterSnapshotInput): void;
    setRosterError(detail: string): void;
    applyFriendPatch(entry: FriendPatchEntry & { detail?: string }): void;
    applyFriendPatches(patches?: FriendPatchEntry[], detail?: string): void;
    removeFriend(userId: string, detail?: string): void;
    resetRoster(): void;
};
