export type UserRecord = Record<string, unknown>;

export interface TrustLevelInfo {
    trustLevel: string;
    trustClass: string;
    trustSortNum: number;
    isModerator: boolean;
    isTroll: boolean;
    isProbableTroll: boolean;
    trustColorKey: string;
}

export type TrustRank =
    | 'visitor'
    | 'newUser'
    | 'user'
    | 'knownUser'
    | 'trustedUser';

const TRUST_RANKS: Readonly<
    Record<
        TrustRank,
        {
            level: string;
            className: string;
            colorKey: string;
            sortNum: number;
        }
    >
> = Object.freeze({
    visitor: {
        level: 'Visitor',
        className: 'x-tag-untrusted',
        colorKey: 'untrusted',
        sortNum: 1
    },
    newUser: {
        level: 'New User',
        className: 'x-tag-basic',
        colorKey: 'basic',
        sortNum: 2
    },
    user: {
        level: 'User',
        className: 'x-tag-known',
        colorKey: 'known',
        sortNum: 3
    },
    knownUser: {
        level: 'Known User',
        className: 'x-tag-trusted',
        colorKey: 'trusted',
        sortNum: 4
    },
    trustedUser: {
        level: 'Trusted User',
        className: 'x-tag-veteran',
        colorKey: 'veteran',
        sortNum: 5
    }
});

export function trustRankFromTags(tags: string[]): TrustRank {
    if (tags.includes('system_trust_veteran')) {
        return 'trustedUser';
    }
    if (tags.includes('system_trust_trusted')) {
        return 'knownUser';
    }
    if (tags.includes('system_trust_known')) {
        return 'user';
    }
    if (tags.includes('system_trust_basic')) {
        return 'newUser';
    }
    return 'visitor';
}

export function computeTrustLevel(
    tags: string[],
    developerType: string
): TrustLevelInfo {
    const isModerator =
        (Boolean(developerType) && developerType !== 'none') ||
        tags.includes('admin_moderator');
    const isTroll = tags.includes('system_troll');
    const isProbableTroll = tags.includes('system_probable_troll') && !isTroll;

    const rank = TRUST_RANKS[trustRankFromTags(tags)];
    let trustColorKey = rank.colorKey;
    let trustSortNum = rank.sortNum;

    if (isTroll || isProbableTroll) {
        trustColorKey = 'troll';
        trustSortNum += 0.1;
    }
    if (isModerator) {
        trustColorKey = 'vip';
        trustSortNum += 0.3;
    }

    return {
        trustLevel: rank.level,
        trustClass: rank.className,
        trustSortNum,
        isModerator,
        isTroll,
        isProbableTroll,
        trustColorKey
    };
}

export function computeUserPlatform(
    platform?: string,
    lastPlatform?: string
): string {
    if (platform && platform !== 'offline' && platform !== 'web') {
        return platform;
    }
    return lastPlatform || '';
}

export function createDefaultUserRef<TUser extends UserRecord>(
    json: TUser
): TUser & UserRecord {
    return {
        ageVerificationStatus: '',
        ageVerified: false,
        allowAvatarCopying: false,
        currentAvatarImageUrl: '',
        currentAvatarTags: [],
        currentAvatarThumbnailImageUrl: '',
        date_joined: '',
        developerType: '',
        discordId: '',
        displayName: '',
        friendKey: '',
        friendRequestStatus: '',
        id: '',
        instanceId: '',
        isFriend: false,
        last_activity: '',
        last_login: '',
        last_mobile: null,
        last_platform: '',
        location: '',
        platform: '',
        note: null,
        state: '',
        status: '',
        statusDescription: '',
        tags: [],
        travelingToInstance: '',
        travelingToLocation: '',
        travelingToWorld: '',
        worldId: '',
        fallbackAvatar: '',
        $location: {},
        $isVRCPlus: false,
        $isModerator: false,
        $isTroll: false,
        $isProbableTroll: false,
        $trustLevel: 'Visitor',
        $trustClass: 'x-tag-untrusted',
        $userColour: '',
        $trustSortNum: 1,
        $languages: [],
        $previousLocation: '',
        $customTag: '',
        $customTagColour: '',
        $friendNumber: 0,
        $platform: '',
        $moderations: {},
        ...json
    };
}
