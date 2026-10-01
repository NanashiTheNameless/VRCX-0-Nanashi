import type { FriendRecord } from '@/domain/friends/types';
import { isSameInstanceLocation } from '@/domain/instances/instanceRoster';

import {
    resolveFriendGroupName,
    resolveFriendWorldName,
    friendLocationTarget
} from './friendsLocationsRows';

export type FriendsLocationsViewMode = 'people' | 'worlds';

export const DEFAULT_FRIENDS_LOCATIONS_VIEW_MODE: FriendsLocationsViewMode =
    'people';

export function sanitizeFriendsLocationsViewMode(
    value: unknown
): FriendsLocationsViewMode {
    return value === 'worlds' ? 'worlds' : DEFAULT_FRIENDS_LOCATIONS_VIEW_MODE;
}

export type FriendsLocationsWorldInstance = {
    location: string;
    groupId: string;
    groupName: string;
    isCurrent: boolean;
    friends: FriendRecord[];
};

export type FriendsLocationsWorldGroup = {
    worldId: string;
    nameHint: string;
    friendCount: number;
    instances: FriendsLocationsWorldInstance[];
};

export function buildFriendWorldGroups(
    friends: readonly FriendRecord[],
    currentLocation: string,
    localLocationOf: (friendId: string) => string
): FriendsLocationsWorldGroup[] {
    const groupsByWorldId = new Map<string, FriendsLocationsWorldGroup>();
    const instancesByLocation = new Map<
        string,
        FriendsLocationsWorldInstance
    >();

    for (const friend of friends) {
        const target = friendLocationTarget(friend, localLocationOf(friend.id));
        if (!target.worldId || target.isOffline || target.isPrivate) {
            continue;
        }
        const location = target.rawLocation || target.worldId;
        let group = groupsByWorldId.get(target.worldId);
        if (!group) {
            group = {
                worldId: target.worldId,
                nameHint: '',
                friendCount: 0,
                instances: []
            };
            groupsByWorldId.set(target.worldId, group);
        }
        if (!group.nameHint) {
            group.nameHint = resolveFriendWorldName(friend);
        }
        group.friendCount += 1;

        const instanceKey = `${target.worldId}|${location}`;
        let instance = instancesByLocation.get(instanceKey);
        if (!instance) {
            instance = {
                location,
                groupId: target.groupId,
                groupName: resolveFriendGroupName(friend),
                isCurrent: isSameInstanceLocation(location, currentLocation),
                friends: []
            };
            instancesByLocation.set(instanceKey, instance);
            group.instances.push(instance);
        }
        if (!instance.groupName) {
            instance.groupName = resolveFriendGroupName(friend);
        }
        instance.friends.push(friend);
    }

    const groups = Array.from(groupsByWorldId.values());
    for (const group of groups) {
        group.instances.sort((left, right) => {
            if (left.isCurrent !== right.isCurrent) {
                return left.isCurrent ? -1 : 1;
            }
            if (left.friends.length !== right.friends.length) {
                return right.friends.length - left.friends.length;
            }
            return left.location.localeCompare(right.location);
        });
    }
    return groups.sort((left, right) => {
        const leftCurrent = left.instances[0]?.isCurrent ?? false;
        const rightCurrent = right.instances[0]?.isCurrent ?? false;
        if (leftCurrent !== rightCurrent) {
            return leftCurrent ? -1 : 1;
        }
        if (left.friendCount !== right.friendCount) {
            return right.friendCount - left.friendCount;
        }
        if (left.instances.length !== right.instances.length) {
            return right.instances.length - left.instances.length;
        }
        return (left.nameHint || left.worldId).localeCompare(
            right.nameHint || right.worldId,
            undefined,
            { sensitivity: 'base' }
        );
    });
}
