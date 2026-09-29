// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getAllMutualFriends: vi.fn(),
    getSnapshot: vi.fn()
}));

vi.mock('@/repositories/userProfileRepository', () => ({
    default: { getAllMutualFriends: mocks.getAllMutualFriends }
}));
vi.mock('@/repositories/mutualGraphPersistenceRepository', () => ({
    default: { getSnapshot: mocks.getSnapshot }
}));
vi.mock('@/services/themeService', () => ({
    useResolvedThemeMode: () => 'dark'
}));

import { clearEntityQueryCache } from '@/lib/entityQueryCache';
import { queryClient } from '@/lib/queryClient';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRoomMutualScanStore } from '@/state/roomMutualScanStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { PlayerListRow } from './playerListTypes';
import { usePlayerListMutuals } from './usePlayerListMutuals';

const LOCATION = 'wrld_room:1';
const FETCHED_AT = '2026-09-01T00:00:00.000Z';

function Wrapper({ children }: PropsWithChildren) {
    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}

function row(
    userId: string,
    { isFriend = false, isCurrentUser = false } = {}
): PlayerListRow {
    return {
        userId,
        displayName: userId,
        isFriend,
        isCurrentUser
    } as PlayerListRow;
}

const ROWS = [
    row('usr_self', { isCurrentUser: true }),
    row('usr_f1', { isFriend: true }),
    row('usr_s1'),
    row('usr_s2'),
    row('usr_s3')
];

function mutualRows(...ids: string[]) {
    return {
        rows: ids.map((id) => ({ id, displayName: id })),
        persisted: false
    };
}

function renderMutuals(rows: readonly PlayerListRow[] = ROWS) {
    return renderHook(() => usePlayerListMutuals(LOCATION, rows), {
        wrapper: Wrapper
    });
}

beforeEach(() => {
    useRuntimeStore.getState().resetRuntimeState();
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: 'usr_self',
        currentUserEndpoint: '',
        currentUserWebsocket: '',
        currentUserSnapshot: { id: 'usr_self' }
    });
    useFriendRosterStore.getState().setRosterSnapshot({
        currentUserId: 'usr_self',
        friendsById: {
            usr_f1: { id: 'usr_f1', displayName: 'F1', stateBucket: 'offline' },
            usr_f2: { id: 'usr_f2', displayName: 'F2', stateBucket: 'offline' },
            usr_f3: { id: 'usr_f3', displayName: 'F3', stateBucket: 'offline' }
        }
    });
    mocks.getSnapshot.mockResolvedValue({
        snapshot: new Map([
            ['usr_f1', ['usr_f2', 'usr_f3']],
            ['usr_f2', ['usr_f1', 'usr_f3']],
            ['usr_f3', ['usr_f1', 'usr_f2']]
        ]),
        meta: new Map(
            ['usr_f1', 'usr_f2', 'usr_f3'].map((id) => [
                id,
                { lastFetchedAt: FETCHED_AT, optedOut: false, totalCount: 2 }
            ])
        )
    });
});

afterEach(async () => {
    cleanup();
    await clearEntityQueryCache();
    mocks.getAllMutualFriends.mockReset();
    mocks.getSnapshot.mockReset();
    useFriendRosterStore.getState().resetRoster();
    useRoomMutualScanStore.getState().setRunning(false);
});

describe('usePlayerListMutuals', () => {
    it('queries only the strangers in the room and summarizes the circle they share', async () => {
        mocks.getAllMutualFriends.mockImplementation(
            async ({ userId }: { userId: string }) =>
                ({
                    usr_s1: mutualRows('usr_f1', 'usr_f2'),
                    usr_s2: mutualRows('usr_f2', 'usr_f3'),
                    usr_s3: mutualRows()
                })[userId]
        );
        const view = renderMutuals();
        await waitFor(() =>
            expect(view.result.current.scan.canStart).toBe(true)
        );

        act(() => view.result.current.scan.start());
        expect(useRoomMutualScanStore.getState().running).toBe(true);

        await waitFor(() =>
            expect(view.result.current.scan.summary).not.toBeNull()
        );
        expect(
            mocks.getAllMutualFriends.mock.calls.map(([input]) => input.userId)
        ).toEqual(['usr_s1', 'usr_s2', 'usr_s3']);
        expect(useRoomMutualScanStore.getState().running).toBe(false);
        expect(view.result.current.scan.summary?.matchedCount).toBe(2);
        expect(
            view.result.current.scan.summary?.circles.map(
                (circle) => circle.size
            )
        ).toEqual([3]);
        expect(view.result.current.scan.needsGraphBuild).toBe(false);

        const mutualsOf = (userId: string) =>
            view.result.current.rows.find((entry) => entry.userId === userId)
                ?.mutuals;
        expect(mutualsOf('usr_self')).toBeNull();
        expect(mutualsOf('usr_s1')).toMatchObject({
            status: 'ready',
            count: 2
        });
        expect(mutualsOf('usr_s3')).toMatchObject({
            status: 'ready',
            count: 0
        });
        expect(mutualsOf('usr_f1')).toMatchObject({
            status: 'ready',
            count: 2
        });
        expect(view.result.current.scan.canStart).toBe(false);
    });

    it('releases the room scan when it is stopped or the page goes away', async () => {
        mocks.getAllMutualFriends.mockReturnValue(new Promise(() => {}));
        const view = renderMutuals();
        await waitFor(() =>
            expect(view.result.current.scan.canStart).toBe(true)
        );

        act(() => view.result.current.scan.start());
        await waitFor(() =>
            expect(view.result.current.scan.progress).toEqual({
                done: 0,
                total: 3
            })
        );

        act(() => view.result.current.scan.stop());
        expect(view.result.current.scan.progress).toBeNull();
        expect(useRoomMutualScanStore.getState().running).toBe(false);

        act(() => view.result.current.scan.start());
        expect(useRoomMutualScanStore.getState().running).toBe(true);
        view.unmount();
        expect(useRoomMutualScanStore.getState().running).toBe(false);
    });

    it('offers to build the friend graph after a scan when it was never fetched', async () => {
        mocks.getSnapshot.mockResolvedValue({
            snapshot: new Map(),
            meta: new Map()
        });
        mocks.getAllMutualFriends.mockResolvedValue(mutualRows('usr_f1'));
        const view = renderMutuals([row('usr_s1')]);
        await waitFor(() =>
            expect(view.result.current.scan.canStart).toBe(true)
        );
        expect(view.result.current.scan.needsGraphBuild).toBe(false);

        act(() => view.result.current.scan.start());

        await waitFor(() =>
            expect(view.result.current.scan.needsGraphBuild).toBe(true)
        );
    });

    it('drops an unfinished query and its results view when moving to another room', async () => {
        mocks.getAllMutualFriends.mockReturnValue(new Promise(() => {}));
        const view = renderHook(
            ({ location }) => usePlayerListMutuals(location, [row('usr_s1')]),
            { initialProps: { location: LOCATION }, wrapper: Wrapper }
        );
        await waitFor(() =>
            expect(view.result.current.scan.canStart).toBe(true)
        );
        act(() => view.result.current.scan.start());
        expect(useRoomMutualScanStore.getState().running).toBe(true);

        view.rerender({ location: 'wrld_other:2' });

        expect(useRoomMutualScanStore.getState().running).toBe(false);
        expect(view.result.current.scan.progress).toBeNull();
        expect(view.result.current.scan.visible).toBe(false);
        expect(view.result.current.scan.completed).toBe(false);
    });

    it('lets finished results be hidden, shown again and re-queried for newcomers', async () => {
        mocks.getAllMutualFriends.mockResolvedValue(mutualRows('usr_f1'));
        const view = renderHook(
            ({ rows }) => usePlayerListMutuals(LOCATION, rows),
            { initialProps: { rows: [row('usr_s1')] }, wrapper: Wrapper }
        );
        await waitFor(() =>
            expect(view.result.current.scan.canStart).toBe(true)
        );
        expect(view.result.current.scan.visible).toBe(false);

        act(() => view.result.current.scan.start());
        expect(view.result.current.scan.visible).toBe(true);
        await waitFor(() =>
            expect(view.result.current.scan.completed).toBe(true)
        );
        expect(view.result.current.scan.hasPending).toBe(false);

        act(() => view.result.current.scan.hide());
        expect(view.result.current.scan.visible).toBe(false);
        expect(view.result.current.scan.summary).toBeNull();

        act(() => view.result.current.scan.show());
        expect(view.result.current.scan.visible).toBe(true);
        expect(view.result.current.scan.summary?.matchedCount).toBe(1);

        view.rerender({ rows: [row('usr_s1'), row('usr_s2')] });
        expect(view.result.current.scan.hasPending).toBe(true);
        expect(view.result.current.scan.canStart).toBe(true);
    });

    it('does not keep offering a re-query for players whose mutuals are unavailable', async () => {
        mocks.getAllMutualFriends.mockRejectedValue(new Error('403'));
        const view = renderMutuals([row('usr_s1')]);
        await waitFor(() =>
            expect(view.result.current.scan.canStart).toBe(true)
        );

        act(() => view.result.current.scan.start());

        await waitFor(() =>
            expect(view.result.current.scan.completed).toBe(true)
        );
        expect(view.result.current.scan.hasPending).toBe(false);
        expect(
            view.result.current.rows.find((entry) => entry.userId === 'usr_s1')
                ?.mutuals
        ).toEqual({ status: 'unavailable' });
    });

    it('keeps the scan unavailable while the friend graph is being fetched', async () => {
        useRuntimeStore.setState((state) => ({
            mutualGraph: {
                ...state.mutualGraph,
                ownerUserId: 'usr_self',
                status: 'running'
            }
        }));
        const view = renderMutuals();

        expect(view.result.current.scan.canStart).toBe(false);
        expect(view.result.current.scan.isGraphFetching).toBe(true);
        act(() => view.result.current.scan.start());
        expect(mocks.getAllMutualFriends).not.toHaveBeenCalled();
    });
});
