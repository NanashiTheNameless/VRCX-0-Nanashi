// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useFriendStatsStore } from '@/state/friendStatsStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';

import { useFriendListRows } from './useFriendListRows';

vi.mock('@/repositories/memoPersistenceRepository', () => ({
    default: {
        getAllUserMemos: vi.fn().mockResolvedValue([]),
        getAllUserNotes: vi.fn().mockResolvedValue([])
    }
}));

const FILTERS = {
    activeSearchFilterIds: new Set<string>(),
    favoritesOnly: false,
    searchQuery: ''
};

function renderRows() {
    return renderHook(() => useFriendListRows(FILTERS)).result;
}

beforeEach(() => {
    useFriendRosterStore.getState().resetRoster();
    useFriendStatsStore.getState().reset();
    useUserFactsStore.getState().resetUserFacts();
    useRuntimeStore.setState((state) => ({
        auth: {
            ...state.auth,
            currentUserId: 'usr_owner',
            currentUserEndpoint: 'default'
        }
    }));
});

afterEach(() => {
    cleanup();
});

describe('useFriendListRows', () => {
    it('keeps unchanged friend rows identical when a presence flush replaces the roster map', () => {
        useFriendRosterStore.getState().applyFriendPatches([
            { userId: 'usr_a', patch: { displayName: 'Alice' } },
            { userId: 'usr_b', patch: { displayName: 'Bob' } },
            { userId: 'usr_c', patch: { displayName: 'Carol' } }
        ]);

        const result = renderRows();
        const firstRows = result.current.rosterRows;
        expect(firstRows.map((row) => row.displayName)).toEqual([
            'Alice',
            'Bob',
            'Carol'
        ]);

        // A presence flush rebuilds friendsById but keeps untouched entries
        // reference-identical, so only the patched friend should get a new row.
        act(() => {
            useFriendRosterStore
                .getState()
                .applyFriendPatches([
                    { userId: 'usr_b', patch: { status: 'active' } }
                ]);
        });

        const secondRows = result.current.rosterRows;
        expect(secondRows).not.toBe(firstRows);
        expect(secondRows[0]).toBe(firstRows[0]);
        expect(secondRows[2]).toBe(firstRows[2]);
        expect(secondRows[1]).not.toBe(firstRows[1]);
        expect(secondRows[1].status).toBe('active');
    });

    it('rebuilds only the row whose stats changed', () => {
        useFriendRosterStore.getState().applyFriendPatches([
            { userId: 'usr_a', patch: { displayName: 'Alice' } },
            { userId: 'usr_b', patch: { displayName: 'Bob' } }
        ]);
        useFriendStatsStore.getState().replaceStats('usr_owner', {
            usr_a: { joinCount: 1, mutualCount: 0, mutualOptedOut: false },
            usr_b: { joinCount: 2, mutualCount: 0, mutualOptedOut: false }
        });

        const result = renderRows();
        const firstRows = result.current.rosterRows;

        act(() => {
            useFriendStatsStore.getState().applyMutualStats('usr_owner', {
                usr_b: { mutualCount: 4, mutualOptedOut: false }
            });
        });

        const secondRows = result.current.rosterRows;
        expect(secondRows[0]).toBe(firstRows[0]);
        expect(secondRows[1]).not.toBe(firstRows[1]);
        expect(secondRows[1].$mutualCount).toBe(4);
        expect(secondRows[0].$mutualCount).toBe(0);
    });

    it('preserves a real friend number and falls back to the roster index only when absent', () => {
        useFriendRosterStore.getState().applyFriendPatches([
            { userId: 'usr_a', patch: { displayName: 'Alice' } },
            {
                userId: 'usr_b',
                patch: { displayName: 'Bob', friendNumber: 77 }
            }
        ]);

        const result = renderRows();
        const numbers = result.current.rosterRows.map(
            (row) => row.friendNumber
        );

        expect(numbers).toContain(77);
        expect(result.current.rosterRows).toHaveLength(2);
    });
});
