import { presenceOf } from '@/domain/friends/presence';

import {
    compareByLastActive,
    compareByLastSeen,
    compareByLocation,
    compareByLocationAt,
    compareByPrivate,
    compareByStatus,
    type ComparableRecord
} from './compare';
import { sortStatus, userStatusFromValue } from './friendStatus';

type FriendSortMethod =
    | 'Sort Alphabetically'
    | 'Sort Private to Bottom'
    | 'Sort by Status'
    | 'Sort by Last Active'
    | 'Sort by Last Seen'
    | 'Sort by Time in Instance'
    | 'Sort by Location'
    | 'None';

type FriendSortItem = ComparableRecord;
type FriendComparator = (a: FriendSortItem, b: FriendSortItem) => number;
type FriendSortContext = {
    staySinceMs?: (friendId: string) => number | null | undefined;
    lastSeen?: (friendId: string) => string | undefined;
};

function getFriendsSortFunction(
    sortMethods: FriendSortMethod[],
    { staySinceMs, lastSeen }: FriendSortContext = {}
): FriendComparator {
    const friendId = (item: FriendSortItem) => String(item.id ?? '');
    const friendName = (item: FriendSortItem) =>
        String(item.name || item.displayName || item.username || item.id || '');
    const stayStart = (item: FriendSortItem) =>
        staySinceMs?.(friendId(item)) ?? undefined;
    const sorts: FriendComparator[] = [];
    for (const sortMethod of sortMethods) {
        switch (sortMethod) {
            case 'Sort Alphabetically':
                sorts.push((a, b) =>
                    friendName(a).localeCompare(friendName(b))
                );
                break;
            case 'Sort Private to Bottom':
                sorts.push(compareByPrivate);
                break;
            case 'Sort by Status':
                sorts.push(compareByStatus);
                break;
            case 'Sort by Last Active':
                sorts.push(compareByLastActive);
                break;
            case 'Sort by Last Seen':
                sorts.push((a, b) =>
                    compareByLastSeen(
                        lastSeen?.(friendId(a)),
                        lastSeen?.(friendId(b))
                    )
                );
                break;
            case 'Sort by Time in Instance':
                sorts.push((a: FriendSortItem, b: FriendSortItem) => {
                    const aKind = presenceOf(a)?.kind;
                    const bKind = presenceOf(b)?.kind;
                    const aPending = aKind === 'pendingOffline';
                    if (aPending !== (bKind === 'pendingOffline')) {
                        return aPending ? 1 : -1;
                    }
                    if (aKind !== 'online' || bKind !== 'online') {
                        return 0;
                    }

                    return compareByLocationAt(
                        b,
                        a,
                        stayStart(b),
                        stayStart(a)
                    );
                });
                break;
            case 'Sort by Location':
                sorts.push(compareByLocation);
                break;
            case 'None':
                sorts.push(() => 0);
                break;
        }
    }

    return (a: FriendSortItem, b: FriendSortItem) => {
        let res = 0;
        for (const sort of sorts) {
            res = sort(a, b);
            if (res !== 0) {
                return res;
            }
        }
        return res;
    };
}

function activeStatusRank(item: FriendSortItem) {
    const status = userStatusFromValue(item.status);
    return status === 'join me' || status === 'ask me' || status === 'busy'
        ? status
        : 'active';
}

function compareByActiveStatus(a: FriendSortItem, b: FriendSortItem) {
    return sortStatus(activeStatusRank(a), activeStatusRank(b));
}

export { compareByActiveStatus, getFriendsSortFunction, sortStatus };
export type { FriendSortContext, FriendSortItem, FriendSortMethod };
