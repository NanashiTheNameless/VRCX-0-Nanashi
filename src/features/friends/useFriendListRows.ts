import { useEffect, useMemo, useRef, useState } from 'react';

import { buildFavoriteIdSet } from '@/domain/favorites/favoriteIdSet';
import type { FriendStats } from '@/domain/friends/friendStats';
import type { FriendRecord } from '@/domain/friends/types';
import type { UserFact } from '@/domain/users/userFacts';
import {
    useFriendStatsById,
    useFriendStatsHydration
} from '@/lib/useFriendStats';
import { useKnownUserFacts } from '@/lib/useKnownUser';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    buildFriendListRow,
    filterFriendListRows,
    type FriendListRow,
    normalizeFriendListId as normalizeId
} from './friendListRows';

type FriendListRowCacheEntry = {
    fact: UserFact | null | undefined;
    friend: FriendRecord;
    index: number;
    row: FriendListRow;
    stats: FriendStats | undefined;
};

export function useFriendListRows({
    activeSearchFilterIds,
    favoritesOnly,
    searchQuery
}: {
    activeSearchFilterIds: Set<string>;
    favoritesOnly: boolean;
    searchQuery: string;
}) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const isFavoritesLoaded = useSessionStore(
        (state) => state.isFavoritesLoaded
    );
    const friendLoadStatus = useFriendRosterStore((state) => state.loadStatus);
    const friendDetail = useFriendRosterStore((state) => state.detail);
    const orderedFriendIds = useFriendRosterStore(
        (state) => state.orderedFriendIds
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const [userMemoById, setUserMemoById] = useState(
        () => new Map<string, string>()
    );
    const [userNoteById, setUserNoteById] = useState(
        () => new Map<string, string>()
    );
    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );
    const factsById = useKnownUserFacts(orderedFriendIds);
    useFriendStatsHydration(true);
    const statsById = useFriendStatsById();
    // The roster map is replaced on every presence flush while unchanged entries
    // keep their identity, so rows are reused whenever their inputs are
    // reference-equal. Without this the row memo in FriendListTable can never hit
    // and every visible row re-renders on each flush.
    const rowCacheRef = useRef(new Map<string, FriendListRowCacheEntry>());
    const rosterRows = useMemo<FriendListRow[]>(() => {
        const previousCache = rowCacheRef.current;
        const nextCache = new Map<string, FriendListRowCacheEntry>();
        const rows: FriendListRow[] = [];
        for (const [index, friendId] of orderedFriendIds.entries()) {
            const rosterFriend = friendsById[friendId];
            if (!rosterFriend) {
                continue;
            }
            const fact = factsById[friendId];
            const stats = statsById[friendId];
            const cached = previousCache.get(friendId);
            const row =
                cached &&
                cached.friend === rosterFriend &&
                cached.fact === fact &&
                cached.stats === stats &&
                cached.index === index
                    ? cached.row
                    : buildFriendListRow(rosterFriend, fact, stats, index);
            nextCache.set(friendId, {
                fact,
                friend: rosterFriend,
                index,
                row,
                stats
            });
            rows.push(row);
        }
        rowCacheRef.current = nextCache;
        return rows;
    }, [factsById, friendsById, orderedFriendIds, statsById]);
    const filteredRows = useMemo(() => {
        return filterFriendListRows({
            rosterRows,
            favoritesOnly,
            favoriteFriendIds,
            searchQuery,
            activeSearchFilterIds,
            userMemoById,
            userNoteById
        });
    }, [
        activeSearchFilterIds,
        favoriteFriendIds,
        favoritesOnly,
        rosterRows,
        searchQuery,
        userMemoById,
        userNoteById
    ]);

    useEffect(() => {
        let active = true;
        Promise.all([
            memoPersistenceRepository.getAllUserMemos(),
            memoPersistenceRepository.getAllUserNotes(currentUserId)
        ])
            .then(([memoRows, noteRows]) => {
                if (!active) {
                    return;
                }
                const nextMemos = new Map<string, string>();
                for (const row of memoRows) {
                    const userId = normalizeId(row.userId);
                    if (userId) {
                        nextMemos.set(userId, row.memo);
                    }
                }
                const nextNotes = new Map<string, string>();
                for (const row of noteRows) {
                    const userId = normalizeId(row.userId);
                    if (userId) {
                        nextNotes.set(userId, row.note);
                    }
                }
                setUserMemoById(nextMemos);
                setUserNoteById(nextNotes);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [currentUserId]);

    return {
        currentUserId,
        currentUserSnapshot,
        filteredRows,
        friendDetail,
        friendLoadStatus,
        friendsById,
        isFavoritesLoaded,
        rosterRows
    };
}
