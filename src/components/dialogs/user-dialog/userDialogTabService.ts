import type { EntityRecord } from '@/domain/entities/shared';
import type { RemoteTabStatus } from '@/domain/shared/types';
import {
    entityQueryPolicies,
    fetchCachedData,
    queryKeys
} from '@/lib/entityQueryCache';
import {
    commands,
    type QueryOrder,
    type ReleaseStatusFilter,
    type WorldSearchSort
} from '@/platform/tauri/bindings';
import type { AvatarProfileRecord } from '@/repositories/avatarProfileRepository';
import { isRecord } from '@/shared/utils/record';

import type {
    UserDialogWorldOrder,
    UserDialogWorldSort
} from './userDialogListOptions';

export type UserDialogDataTab =
    | 'mutual'
    | 'groups'
    | 'worlds'
    | 'favorite-worlds'
    | 'avatars';

export type UserDialogLoadStatus = RemoteTabStatus;
export type UserDialogRemoteStatus = Partial<
    Record<UserDialogDataTab, UserDialogLoadStatus>
>;

type UserDialogAvatarSearchRow = EntityRecord &
    Pick<AvatarProfileRecord, 'authorId'>;

export type UserDialogRepositories = {
    avatarSearchProviderRepository: {
        getConfig(): Promise<{ enabled: boolean; activeProviders: string[] }>;
        search(input: {
            providers: readonly string[];
            query: string;
        }): Promise<{ avatars: UserDialogAvatarSearchRow[] }>;
    };
    myAvatarRepository: {
        getMyAvatars(input: {
            endpoint?: string;
            currentUserId?: string;
            currentAvatarId?: string;
            previousAvatarSwapTime?: number;
        }): Promise<unknown[]>;
    };
    groupProfileRepository: {
        getUserGroups(input: {
            userId?: string;
            endpoint?: string;
        }): Promise<unknown[]>;
    };
    userProfileRepository: {
        getAllMutualFriends(input: {
            userId?: string;
            endpoint?: string;
        }): Promise<{
            rows: unknown[];
            persisted: boolean;
        }>;
    };
    vrchatFavoriteRepository: {
        getAllFavoriteGroups(input: {
            endpoint?: string;
            ownerId?: string;
        }): Promise<unknown[]>;
        getAllFavoriteWorlds(input: {
            endpoint?: string;
            ownerId?: string;
            userId?: string;
            tag?: string;
        }): Promise<unknown[]>;
    };
    worldProfileRepository: {
        getAllWorldsByUser(input: {
            userId?: string;
            endpoint?: string;
            sort?: WorldSearchSort;
            order?: QueryOrder;
            releaseStatus?: ReleaseStatusFilter;
        }): Promise<unknown[]>;
    };
};

export type UserDialogTabCounts = {
    mutual?: number;
    groups?: number;
    worlds?: number;
    'favorite-worlds'?: number;
    avatars?: number;
};

function recordRows(value: unknown): EntityRecord[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

const userDialogDataTabs = [
    'mutual',
    'groups',
    'worlds',
    'favorite-worlds',
    'avatars'
] as const satisfies readonly UserDialogDataTab[];

export function isUserDialogDataTab(tab: string): tab is UserDialogDataTab {
    return userDialogDataTabs.some((candidate) => candidate === tab);
}

export function userDialogDataKeyForTab(tab: UserDialogDataTab) {
    return tab === 'favorite-worlds' ? 'favoriteWorlds' : tab;
}

export async function loadUserDialogTabCounts({
    userId,
    endpoint,
    currentUserId,
    effectiveAvatarReleaseStatus,
    includeMutualFriends,
    force = false
}: {
    userId: string;
    endpoint: string;
    currentUserId: string;
    effectiveAvatarReleaseStatus: ReleaseStatusFilter;
    includeMutualFriends: boolean;
    force?: boolean;
}): Promise<UserDialogTabCounts> {
    if (!userId) {
        return {};
    }
    return fetchCachedData({
        queryKey: queryKeys.userDialogTabCounts(
            {
                userId,
                currentUserId,
                avatarReleaseStatus: effectiveAvatarReleaseStatus,
                includeMutualFriends
            },
            endpoint
        ),
        policy: entityQueryPolicies.userDialogTabCounts,
        force,
        queryFn: async () => {
            const counts = await commands.appUserDialogTabCountsGet({
                userId,
                avatarReleaseStatus: effectiveAvatarReleaseStatus,
                includeMutualFriends,
                force
            });

            return {
                mutual: counts.mutualFriends ?? undefined,
                groups: counts.groups ?? undefined,
                worlds: counts.worlds ?? undefined,
                'favorite-worlds': counts.favoriteWorlds ?? undefined,
                avatars: counts.avatars ?? undefined
            };
        }
    });
}

export async function loadUserDialogTabData({
    tab,
    userId,
    endpoint,
    currentUserId,
    currentAvatarId = '',
    previousAvatarSwapTime = 0,
    worldSort,
    worldOrder,
    repositories
}: {
    tab: string;
    userId: string;
    endpoint?: string;
    currentUserId?: string;
    currentAvatarId?: string;
    previousAvatarSwapTime?: number;
    worldSort?: UserDialogWorldSort;
    worldOrder?: UserDialogWorldOrder;
    repositories: UserDialogRepositories;
}): Promise<{
    rows: EntityRecord[];
    favoriteWorldGroups: EntityRecord[];
    mutualGraphUpdated?: boolean;
}> {
    if (!isUserDialogDataTab(tab)) {
        return { rows: [], favoriteWorldGroups: [] };
    }

    if (tab === 'mutual') {
        const { rows, persisted } =
            await repositories.userProfileRepository.getAllMutualFriends({
                userId,
                endpoint
            });
        return {
            rows: recordRows(rows),
            favoriteWorldGroups: [],
            mutualGraphUpdated: persisted
        };
    }

    if (tab === 'groups') {
        const rows = await repositories.groupProfileRepository.getUserGroups({
            userId,
            endpoint
        });
        return { rows: recordRows(rows), favoriteWorldGroups: [] };
    }

    if (tab === 'worlds') {
        const rows =
            await repositories.worldProfileRepository.getAllWorldsByUser({
                userId,
                endpoint,
                sort: worldSort,
                order: worldOrder,
                releaseStatus: userId === currentUserId ? 'all' : 'public'
            });
        return { rows: recordRows(rows), favoriteWorldGroups: [] };
    }

    if (tab === 'avatars') {
        if (userId === currentUserId) {
            const rows = await repositories.myAvatarRepository.getMyAvatars({
                endpoint,
                currentUserId,
                currentAvatarId,
                previousAvatarSwapTime
            });
            return { rows: recordRows(rows), favoriteWorldGroups: [] };
        }

        const providerConfig =
            await repositories.avatarSearchProviderRepository.getConfig();
        if (!providerConfig.enabled || !providerConfig.activeProviders.length) {
            return { rows: [], favoriteWorldGroups: [] };
        }

        const response =
            await repositories.avatarSearchProviderRepository.search({
                providers: providerConfig.activeProviders,
                query: userId
            });
        return {
            rows: response.avatars.filter(
                (avatar) => avatar.authorId === userId
            ),
            favoriteWorldGroups: []
        };
    }

    const favoriteGroups =
        await repositories.vrchatFavoriteRepository.getAllFavoriteGroups({
            endpoint,
            ownerId: userId
        });
    const worldGroups = favoriteGroups.filter(
        (group): group is EntityRecord & { name: string } =>
            isRecord(group) &&
            group.type === 'world' &&
            typeof group.name === 'string'
    );
    const worldListResults = await Promise.allSettled(
        worldGroups.map(async (group) => {
            const worlds =
                await repositories.vrchatFavoriteRepository.getAllFavoriteWorlds(
                    {
                        endpoint,
                        ownerId: userId,
                        userId,
                        tag: group.name
                    }
                );
            return recordRows(worlds).map((world) => ({
                ...world,
                $favoriteGroup: group.displayName || group.name,
                $favoriteGroupKey: group.name
            }));
        })
    );
    return {
        rows: worldListResults.flatMap((result) =>
            result.status === 'fulfilled' ? result.value : []
        ),
        favoriteWorldGroups: recordRows(worldGroups)
    };
}
