// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    commands,
    type ResolvedFriendLogName
} from '@/platform/tauri/bindings';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useUserFactsStore } from '@/state/userFactsStore';

import type { FriendLogRow } from './friendLogRows';
import { useFriendLogResolvedNames } from './useFriendLogResolvedNames';

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFriendLogNamesResolve: vi.fn(),
        appFriendLogNamesCancel: vi.fn()
    }
}));

function row(userId: string): FriendLogRow {
    return {
        rowId: 1,
        created_at: 1788220800,
        type: 'Friend',
        userId,
        displayName: '',
        friendNumber: 0
    };
}

beforeEach(() => {
    vi.resetAllMocks();
    useFriendRosterStore.getState().resetRoster();
    useUserFactsStore.getState().resetUserFacts();
    useRuntimeStore.setState((state) => ({
        auth: {
            ...state.auth,
            currentUserId: 'usr_owner',
            currentUserEndpoint: 'default'
        }
    }));
    vi.mocked(commands.appFriendLogNamesCancel).mockResolvedValue(true);
    vi.mocked(commands.appFriendLogNamesResolve).mockImplementation(
        async ({ userIds = [] }) =>
            userIds.map((userId) => ({ userId, displayName: `Name ${userId}` }))
    );
});
afterEach(cleanup);

describe('Friend History name window', () => {
    it('evicts resolved names and lookup markers when their last row leaves the window', async () => {
        const first = row('usr_first');
        const second = row('usr_second');
        const { result, rerender } = renderHook(
            ({ rows }: { rows: FriendLogRow[] }) =>
                useFriendLogResolvedNames('usr_owner', rows),
            { initialProps: { rows: [first] } }
        );
        await waitFor(() =>
            expect(result.current(first)).toBe('Name usr_first')
        );
        rerender({ rows: [second] });
        await waitFor(() =>
            expect(result.current(second)).toBe('Name usr_second')
        );
        expect(result.current(first)).toBe('Unknown');
        rerender({ rows: [first] });
        await waitFor(() =>
            expect(result.current(first)).toBe('Name usr_first')
        );
        expect(
            vi
                .mocked(commands.appFriendLogNamesResolve)
                .mock.calls.filter(([input]) =>
                    input.userIds?.includes('usr_first')
                )
        ).toHaveLength(2);
        expect(result.current(second)).toBe('Unknown');
    });

    it('retains a shared user while another row for that user remains', async () => {
        const first = row('usr_shared');
        const second = { ...first, rowId: 2 };
        const { result, rerender } = renderHook(
            ({ rows }: { rows: FriendLogRow[] }) =>
                useFriendLogResolvedNames('usr_owner', rows),
            { initialProps: { rows: [first, second] } }
        );
        await waitFor(() =>
            expect(result.current(first)).toBe('Name usr_shared')
        );
        rerender({ rows: [second] });
        expect(result.current(second)).toBe('Name usr_shared');
        expect(commands.appFriendLogNamesResolve).toHaveBeenCalledTimes(1);
    });

    it('does not restore evicted names from a late lookup response', async () => {
        let resolveOld: (names: ResolvedFriendLogName[]) => void = () => {};
        vi.mocked(commands.appFriendLogNamesResolve).mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveOld = resolve;
                })
        );
        const first = row('usr_first');
        const second = row('usr_second');
        const { result, rerender } = renderHook(
            ({ rows }: { rows: FriendLogRow[] }) =>
                useFriendLogResolvedNames('usr_owner', rows),
            { initialProps: { rows: [first] } }
        );
        rerender({ rows: [second] });
        await waitFor(() =>
            expect(result.current(second)).toBe('Name usr_second')
        );
        await act(async () =>
            resolveOld([{ userId: 'usr_first', displayName: 'Late name' }])
        );
        expect(result.current(first)).toBe('Unknown');
        expect(commands.appFriendLogNamesCancel).toHaveBeenCalled();
    });

    it('continues to the next lookup batch when the first batch has no resolvable names', async () => {
        const rows = Array.from({ length: 101 }, (_, index) =>
            row(`usr_${index}`)
        );
        vi.mocked(commands.appFriendLogNamesResolve).mockResolvedValueOnce([]);
        const { result } = renderHook(() =>
            useFriendLogResolvedNames('usr_owner', rows)
        );
        await waitFor(() =>
            expect(result.current(rows[100])).toBe('Name usr_100')
        );
        expect(commands.appFriendLogNamesResolve).toHaveBeenCalledTimes(2);
        expect(
            vi.mocked(commands.appFriendLogNamesResolve).mock.calls[0][0]
                .userIds
        ).toHaveLength(100);
    });
});
