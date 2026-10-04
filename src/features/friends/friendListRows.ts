import { applyFactDerivedFields } from '@/domain/friends/friendRosterFacts';
import type { FriendStats } from '@/domain/friends/friendStats';
import { presenceSection } from '@/domain/friends/presence';
import type {
    FriendProfileFields,
    FriendRecord,
    FriendRecordInput
} from '@/domain/friends/types';
import type { UserFact } from '@/domain/users/userFacts';
import removeConfusables, { removeWhitespace } from '@/services/confusables';

const FRIEND_LIST_DEFAULT_SEARCH_FILTER_IDS = [
    'displayName',
    'rank',
    'status',
    'note',
    'memo'
];

export type FriendListRow = FriendRecordInput &
    Partial<FriendProfileFields> & {
        $joinCount?: number;
        $lastSeen?: string;
        $mutualCount?: number | string;
        $mutualOptedOut?: boolean;
        $timeSpent?: number;
        friendNumber?: number;
        memo?: string;
        note?: string;
    };

type FriendNumberSource = {
    $friendNumber?: number | string;
    friendNumber?: number | string;
};

type FriendListFilterInput = {
    rosterRows: readonly FriendListRow[];
    favoritesOnly: boolean;
    favoriteFriendIds: ReadonlySet<string>;
    searchQuery: string;
    activeSearchFilterIds: ReadonlySet<string>;
    userMemoById: ReadonlyMap<string, string>;
    userNoteById: ReadonlyMap<string, string>;
};

export function normalizeFriendListId(value: string | null | undefined) {
    return (value ?? '').trim();
}

export function friendNumberForSort(friend: FriendNumberSource) {
    return (
        Number.parseInt(
            String(friend?.$friendNumber ?? friend?.friendNumber ?? 0),
            10
        ) || 0
    );
}

export function buildFriendListRow(
    rosterFriend: FriendRecord,
    fact: UserFact | null | undefined,
    stats: FriendStats | undefined,
    index: number
): FriendListRow {
    const friend: FriendListRow = {
        ...applyFactDerivedFields(rosterFriend, fact),
        $joinCount: stats?.joinCount,
        $lastSeen: stats?.lastSeen,
        $timeSpent: stats?.timeSpent,
        $mutualCount: stats?.mutualCount,
        $mutualOptedOut: stats?.mutualOptedOut
    };
    if (friendNumberForSort(friend) > 0) {
        return friend;
    }
    return {
        ...friend,
        friendNumber: index + 1,
        $friendNumber: index + 1
    };
}

const FRIEND_LIST_DEFAULT_SEARCH_FILTERS: ReadonlySet<string> = new Set(
    FRIEND_LIST_DEFAULT_SEARCH_FILTER_IDS
);

type PreparedFriendListSearch = {
    cleanedQuery: string;
    filters: ReadonlySet<string>;
    loweredQuery: string;
    uppercaseQuery: string;
};

// The query does not change while filtering a roster, so its normalized forms
// and the fallback filter set are resolved once instead of once per friend.
function prepareFriendListSearch(
    searchQuery: string,
    activeSearchFilters: ReadonlySet<string>
): PreparedFriendListSearch | null {
    const query = searchQuery ? searchQuery.trim() : '';
    if (!query) {
        return null;
    }
    const loweredQuery = query.toLowerCase();
    return {
        cleanedQuery: removeWhitespace(loweredQuery),
        filters: activeSearchFilters.size
            ? activeSearchFilters
            : FRIEND_LIST_DEFAULT_SEARCH_FILTERS,
        loweredQuery,
        uppercaseQuery: query.toUpperCase()
    };
}

function matchesPreparedFriendListSearch(
    friend: FriendListRow,
    search: PreparedFriendListSearch,
    userMemoById: ReadonlyMap<string, string>,
    userNoteById: ReadonlyMap<string, string>
): boolean {
    const { cleanedQuery, filters, loweredQuery, uppercaseQuery } = search;

    if (filters.has('displayName')) {
        const displayName = String(friend?.displayName || '');
        // removeConfusables is comparatively expensive for non-ASCII names, so
        // it only runs when the cheaper whitespace-stripped match misses.
        if (
            removeWhitespace(displayName).toLowerCase().includes(cleanedQuery)
        ) {
            return true;
        }
        if (
            removeConfusables(displayName).toLowerCase().includes(cleanedQuery)
        ) {
            return true;
        }
    }

    if (
        filters.has('username') &&
        String(friend?.username || '')
            .toLowerCase()
            .includes(loweredQuery)
    ) {
        return true;
    }

    if (
        filters.has('rank') &&
        String(friend?.$trustLevel || '')
            .toUpperCase()
            .includes(uppercaseQuery)
    ) {
        return true;
    }

    if (
        filters.has('status') &&
        `${friend?.statusDescription || ''} ${friend?.status || ''} ${friend?.$presence ? presenceSection(friend.$presence) : ''}`
            .toLowerCase()
            .includes(loweredQuery)
    ) {
        return true;
    }

    if (
        filters.has('note') &&
        String(
            userNoteById.get(normalizeFriendListId(friend?.id)) ||
                friend?.note ||
                ''
        )
            .toLowerCase()
            .includes(loweredQuery)
    ) {
        return true;
    }

    if (
        filters.has('memo') &&
        String(
            userMemoById.get(normalizeFriendListId(friend?.id)) ||
                friend?.memo ||
                friend?.$memo ||
                ''
        )
            .toLowerCase()
            .includes(loweredQuery)
    ) {
        return true;
    }

    return false;
}

export function matchesFriendListSearch(
    friend: FriendListRow,
    searchQuery: string,
    activeSearchFilters: ReadonlySet<string>,
    userMemoById: ReadonlyMap<string, string>,
    userNoteById: ReadonlyMap<string, string>
): boolean {
    const search = prepareFriendListSearch(searchQuery, activeSearchFilters);
    if (!search) {
        return true;
    }
    return matchesPreparedFriendListSearch(
        friend,
        search,
        userMemoById,
        userNoteById
    );
}

export function filterFriendListRows({
    rosterRows,
    favoritesOnly,
    favoriteFriendIds,
    searchQuery,
    activeSearchFilterIds,
    userMemoById,
    userNoteById
}: FriendListFilterInput): FriendListRow[] {
    const search = prepareFriendListSearch(searchQuery, activeSearchFilterIds);
    return rosterRows.filter((friend) => {
        if (
            favoritesOnly &&
            !favoriteFriendIds.has(normalizeFriendListId(friend?.id))
        ) {
            return false;
        }
        if (!search) {
            return true;
        }
        return matchesPreparedFriendListSearch(
            friend,
            search,
            userMemoById,
            userNoteById
        );
    });
}
