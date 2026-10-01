import type { FavoriteGroupMap } from '@/domain/favorites/types';
import {
    compareByActiveStatus,
    getFriendsSortFunction,
    type FriendSortContext
} from '@/shared/utils/friend';
import type { FriendSortMethod } from '@/shared/utils/friend';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';

import {
    type FriendLocationFriend,
    type FriendLocationTarget,
    type SameInstanceGroup,
    locationTarget,
    resolveLocationSummary,
    friendLocationTarget,
    summarizeLocation
} from './friendsLocationsRows';

type TranslationFn = (key: string, options?: Record<string, unknown>) => string;

type FavoriteGroupOption = {
    key?: string;
    displayName?: string;
    name?: string;
};

type FavoriteGroupLabelsByFriendId = Map<string, string[]>;

type FavoriteGroupLabelsInput = {
    favoriteFriendGroups?: FavoriteGroupOption[] | null;
    groupedFavoriteFriendIdsByGroupKey?: Record<string, string[]>;
    localFriendFavorites?: FavoriteGroupMap;
    t?: TranslationFn | null;
};

type FavoriteGroupSortValue = {
    key: string;
    label?: string;
};

type FriendsLocationSectionDescriptor = {
    key: string;
    title: string;
    description: string;
    worldId: string;
    groupId: string;
    rawLocation?: string;
};

type FriendsLocationSection<
    TFriend extends FriendLocationFriend = FriendLocationFriend
> = FriendsLocationSectionDescriptor & {
    displayInstanceInfo?: boolean;
    friends: TFriend[];
};

type BuildSameInstanceSectionsInput<
    TFriend extends FriendLocationFriend = FriendLocationFriend
> = {
    sameInstanceGroups: SameInstanceGroup<TFriend>[];
    displayInstanceInfo?: boolean;
    favoriteIds?: Set<string>;
    favoriteGroupLabelsByFriendId?: FavoriteGroupLabelsByFriendId;
    t?: TranslationFn | null;
};

type BuildFriendSectionsInput<
    TFriend extends FriendLocationFriend = FriendLocationFriend
> = {
    friends: TFriend[];
    groupingMode: string;
    favoriteIds: Set<string>;
    favoriteGroupLabelsByFriendId: FavoriteGroupLabelsByFriendId;
    t?: TranslationFn | null;
};

const FRIEND_SORT_METHODS = new Set<string>([
    'Sort Alphabetically',
    'Sort Private to Bottom',
    'Sort by Status',
    'Sort by Last Active',
    'Sort by Last Seen',
    'Sort by Time in Instance',
    'Sort by Location',
    'None'
]);

function isFriendSortMethod(value: unknown): value is FriendSortMethod {
    return typeof value === 'string' && FRIEND_SORT_METHODS.has(value);
}

function interpolateFallback(
    value: unknown,
    values: Record<string, unknown> = {}
) {
    return String(value ?? '').replace(/\{(\w+)\}/g, (match, key: string) =>
        Object.hasOwn(values, key) ? String(values[key]) : match
    );
}

function localized(
    t: TranslationFn | null | undefined,
    key: string,
    fallback: string,
    values: Record<string, unknown> = {}
) {
    if (typeof t !== 'function') {
        return interpolateFallback(fallback, values);
    }

    return interpolateFallback(
        t(key, { defaultValue: fallback, ...values }),
        values
    );
}

function appendLabel(
    labelsByFriendId: FavoriteGroupLabelsByFriendId,
    friendId: string,
    label: string
) {
    const normalizedFriendId = normalizeString(friendId);
    const normalizedLabel = label.trim();
    if (!normalizedFriendId || !normalizedLabel) {
        return;
    }

    const labels = labelsByFriendId.get(normalizedFriendId) ?? [];
    if (!labels.includes(normalizedLabel)) {
        labels.push(normalizedLabel);
    }
    labelsByFriendId.set(normalizedFriendId, labels);
}

export function buildFavoriteGroupLabelsByFriendId({
    favoriteFriendGroups,
    groupedFavoriteFriendIdsByGroupKey,
    localFriendFavorites,
    t
}: FavoriteGroupLabelsInput) {
    const labelsByFriendId: FavoriteGroupLabelsByFriendId = new Map();

    for (const group of favoriteFriendGroups ?? []) {
        const groupKey = normalizeString(group?.key);
        if (!groupKey) {
            continue;
        }

        const label = group?.displayName || group?.name || groupKey;
        const friendIds = groupedFavoriteFriendIdsByGroupKey?.[groupKey];
        for (const friendId of friendIds ?? []) {
            appendLabel(labelsByFriendId, friendId, label);
        }
    }

    for (const [groupName, friendIds] of Object.entries(
        localFriendFavorites ?? {}
    )) {
        const label = localized(
            t,
            'view.friends_locations.local_group',
            'Local: {name}',
            {
                name:
                    groupName ||
                    localized(t, 'view.friends_locations.favorite', 'Favorites')
            }
        );
        for (const friendId of friendIds) {
            appendLabel(labelsByFriendId, friendId, label);
        }
    }

    return labelsByFriendId;
}

export function compareFavoriteGroups(
    left: FavoriteGroupSortValue,
    right: FavoriteGroupSortValue,
    order: string[] = []
) {
    const leftIndex = order.indexOf(left.key);
    const rightIndex = order.indexOf(right.key);
    if (leftIndex >= 0 && rightIndex >= 0) {
        return leftIndex - rightIndex;
    }
    if (leftIndex >= 0) {
        return -1;
    }
    if (rightIndex >= 0) {
        return 1;
    }
    return String(left.label || left.key || '').localeCompare(
        String(right.label || right.key || ''),
        undefined,
        { sensitivity: 'base' }
    );
}

export function sortFriendsBySidebarPrefs<TFriend extends FriendLocationFriend>(
    friends: TFriend[],
    sortMethods: readonly string[] | null | undefined,
    sortContext?: FriendSortContext
) {
    const methods = [...(sortMethods ?? [])].filter(isFriendSortMethod);
    if (!methods.length) {
        return friends;
    }

    const sort = getFriendsSortFunction(methods, sortContext);
    return [...friends].sort(sort);
}

export function sortActiveFriendsBySidebarPrefs<
    TFriend extends FriendLocationFriend
>(
    friends: TFriend[],
    sortMethods: readonly string[] | null | undefined,
    sortContext?: FriendSortContext
) {
    return [
        ...sortFriendsBySidebarPrefs(friends, sortMethods, sortContext)
    ].sort(compareByActiveStatus);
}

function resolveFavoriteGroupLabels(
    friend: FriendLocationFriend,
    favoriteGroupLabelsByFriendId: FavoriteGroupLabelsByFriendId,
    favoriteIds: Set<string>,
    t?: TranslationFn | null
) {
    const friendId = normalizeString(isRecord(friend) ? friend.id : '');
    if (!friendId) {
        return [];
    }

    const labels = favoriteGroupLabelsByFriendId.get(friendId) ?? [];
    if (labels.length > 0) {
        return labels;
    }

    return favoriteIds.has(friendId)
        ? [localized(t, 'view.friends_locations.favorite', 'Favorites')]
        : [];
}

function resolveInstanceSectionDescriptor(
    target: FriendLocationTarget,
    summary: ReturnType<typeof summarizeLocation>,
    t?: TranslationFn | null
): FriendsLocationSectionDescriptor {
    const descriptor: FriendsLocationSectionDescriptor = {
        key: 'instance:unknown',
        title: '',
        description: '',
        worldId: '',
        groupId: '',
        rawLocation: ''
    };

    if (target.isOffline) {
        return {
            ...descriptor,
            key: 'instance:offline',
            title: localized(t, 'location.offline', 'Offline')
        };
    }

    if (target.isPrivate) {
        return {
            ...descriptor,
            key: `instance:private:${target.worldId || target.rawLocation || 'private'}`,
            title: localized(t, 'location.private', 'Private'),
            description: '',
            worldId: target.worldId,
            rawLocation: target.rawLocation
        };
    }

    if (target.isTraveling) {
        return {
            ...descriptor,
            key: `instance:traveling:${target.rawLocation || 'traveling'}`,
            title: localized(t, 'location.traveling', 'Traveling'),
            description: summary.meta || '',
            worldId: target.worldId,
            groupId: target.groupId,
            rawLocation: target.rawLocation
        };
    }

    if (target.worldId) {
        return {
            ...descriptor,
            key: `instance:${target.rawLocation || target.worldId}`,
            title:
                summary.label ||
                target.worldId ||
                localized(t, 'view.friend_list.label.world', 'World'),
            description: [summary.meta].filter(Boolean).join(' · '),
            worldId: target.worldId,
            groupId: target.groupId,
            rawLocation: target.rawLocation
        };
    }

    return {
        ...descriptor,
        key: `instance:${summary.label || target.rawLocation || 'unknown'}`,
        title: summary.label || '',
        description: summary.meta || '',
        rawLocation: target.rawLocation
    };
}

export function buildSameInstanceSections<
    TFriend extends FriendLocationFriend
>({
    sameInstanceGroups,
    displayInstanceInfo = true,
    t
}: BuildSameInstanceSectionsInput<TFriend>): FriendsLocationSection<TFriend>[] {
    return sameInstanceGroups
        .map(({ location, friends }) => {
            const descriptor = resolveInstanceSectionDescriptor(
                locationTarget(location),
                summarizeLocation(location, friends[0], t),
                t
            );

            return {
                ...descriptor,
                key: `instance:${location}`,
                rawLocation: location,
                displayInstanceInfo,
                friends
            };
        })
        .filter((section) => section.friends.length > 0);
}

function upsertSection<TFriend extends FriendLocationFriend>(
    sectionMap: Map<string, FriendsLocationSection<TFriend>>,
    descriptor: FriendsLocationSectionDescriptor,
    friend: TFriend
) {
    const existing = sectionMap.get(descriptor.key);
    if (existing) {
        existing.friends.push(friend);
        return;
    }

    sectionMap.set(descriptor.key, {
        ...descriptor,
        friends: [friend]
    });
}

export function buildFriendSections<TFriend extends FriendLocationFriend>({
    friends,
    groupingMode,
    favoriteIds,
    favoriteGroupLabelsByFriendId,
    t
}: BuildFriendSectionsInput<TFriend>): FriendsLocationSection<TFriend>[] {
    if (groupingMode === 'flat') {
        return [
            {
                key: 'flat',
                title: localized(
                    t,
                    'view.friends_locations.all_matching_friends',
                    'All matching friends'
                ),
                description: '',
                friends,
                worldId: '',
                groupId: ''
            }
        ];
    }

    const sectionsByKey = new Map<string, FriendsLocationSection<TFriend>>();

    for (const friend of friends) {
        if (groupingMode === 'favoriteGroup') {
            const labels = resolveFavoriteGroupLabels(
                friend,
                favoriteGroupLabelsByFriendId,
                favoriteIds,
                t
            );
            const label =
                labels.length > 0
                    ? labels.join(' / ')
                    : localized(
                          t,
                          'view.friends_locations.no_favorite_group',
                          'No favorite group'
                      );
            upsertSection(
                sectionsByKey,
                {
                    key: `favorite:${label}`,
                    title: label,
                    description:
                        labels.length > 0
                            ? localized(
                                  t,
                                  'view.friends_locations.favorite_group_segment',
                                  'Favorite group segment'
                              )
                            : localized(
                                  t,
                                  'view.friends_locations.friend_is_not_in_hydrated_favorite_group',
                                  'Friend is not in a hydrated favorite group.'
                              ),
                    worldId: '',
                    groupId: ''
                },
                friend
            );
            continue;
        }

        upsertSection(
            sectionsByKey,
            resolveInstanceSectionDescriptor(
                friendLocationTarget(friend),
                resolveLocationSummary(friend, t),
                t
            ),
            friend
        );
    }

    return Array.from(sectionsByKey.values()).sort((left, right) => {
        if (
            left.key.startsWith('instance:offline') &&
            !right.key.startsWith('instance:offline')
        ) {
            return 1;
        }
        if (
            right.key.startsWith('instance:offline') &&
            !left.key.startsWith('instance:offline')
        ) {
            return -1;
        }
        return left.title.localeCompare(right.title, undefined, {
            sensitivity: 'base'
        });
    });
}
