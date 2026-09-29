// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSnapshot: vi.fn() }));

vi.mock('@/repositories/mutualGraphPersistenceRepository', () => ({
    default: { getSnapshot: mocks.getSnapshot }
}));
vi.mock('@/services/themeService', () => ({
    useResolvedThemeMode: () => 'dark'
}));

import { clearEntityQueryCache } from '@/lib/entityQueryCache';
import { queryClient } from '@/lib/queryClient';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useMutualFriendGraphContext } from './useMutualFriendGraphContext';
import { useMutualFriendsExclusionStore } from './useMutualFriendsExclusionStore';

const FRIEND_IDS = ['usr_a', 'usr_b', 'usr_c', 'usr_d'];

function Wrapper({ children }: PropsWithChildren) {
    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}

function snapshotWithFetched(fetchedIds: string[]) {
    return {
        snapshot: new Map([
            ['usr_a', ['usr_b', 'usr_c']],
            ['usr_b', ['usr_a', 'usr_c']]
        ]),
        meta: new Map(
            fetchedIds.map((id) => [
                id,
                {
                    lastFetchedAt: '2026-09-01T00:00:00.000Z',
                    optedOut: false,
                    totalCount: 2
                }
            ])
        )
    };
}

function renderContext(options?: { withCommunities?: boolean }) {
    return renderHook(() => useMutualFriendGraphContext(true, options), {
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
        friendsById: Object.fromEntries(
            FRIEND_IDS.map((id) => [
                id,
                { id, displayName: id, stateBucket: 'offline' }
            ])
        )
    });
});

afterEach(async () => {
    cleanup();
    await clearEntityQueryCache();
    mocks.getSnapshot.mockReset();
    useFriendRosterStore.getState().resetRoster();
    useMutualFriendsExclusionStore.getState().setExcludedFriendIds([]);
});

describe('useMutualFriendGraphContext', () => {
    it('asks to build the friend graph until at least half of the friends were fetched', async () => {
        mocks.getSnapshot.mockResolvedValue(snapshotWithFetched(['usr_a']));
        const partly = renderContext();
        await waitFor(() =>
            expect(partly.result.current.needsGraphBuild).toBe(true)
        );
        partly.unmount();
        await clearEntityQueryCache();

        mocks.getSnapshot.mockResolvedValue(
            snapshotWithFetched(['usr_a', 'usr_b'])
        );
        const built = renderContext();
        await waitFor(() =>
            expect(built.result.current.links.length).toBeGreaterThan(0)
        );
        expect(built.result.current.needsGraphBuild).toBe(false);
    });

    it('does not ask to build the graph while it is being fetched', async () => {
        mocks.getSnapshot.mockResolvedValue(snapshotWithFetched([]));
        useRuntimeStore.setState((state) => ({
            mutualGraph: {
                ...state.mutualGraph,
                ownerUserId: 'usr_self',
                status: 'running'
            }
        }));
        const view = renderContext();

        await waitFor(() =>
            expect(view.result.current.links.length).toBeGreaterThan(0)
        );
        expect(view.result.current.isGraphFetching).toBe(true);
        expect(view.result.current.needsGraphBuild).toBe(false);
    });

    it('groups the whole friend graph into circles only when asked', async () => {
        mocks.getSnapshot.mockResolvedValue(
            snapshotWithFetched(['usr_a', 'usr_b'])
        );
        const plain = renderContext();
        const grouped = renderContext({ withCommunities: true });

        await waitFor(() =>
            expect(grouped.result.current.communities.length).toBeGreaterThan(0)
        );
        expect(plain.result.current.links.length).toBeGreaterThan(0);
        expect(plain.result.current.communities).toEqual([]);
        expect(grouped.result.current.communityIndexById.get('usr_a')).toBe(
            grouped.result.current.communityIndexById.get('usr_c')
        );
    });

    it('drops a friend as soon as it is hidden from the mutual friends graph', async () => {
        mocks.getSnapshot.mockResolvedValue(
            snapshotWithFetched(['usr_a', 'usr_b'])
        );
        const view = renderContext();
        await waitFor(() =>
            expect(view.result.current.nodeById.has('usr_c')).toBe(true)
        );

        act(() => {
            useMutualFriendsExclusionStore
                .getState()
                .setExcludedFriendIds(['usr_c']);
        });

        expect(view.result.current.nodeById.has('usr_c')).toBe(false);
        expect(view.result.current.nodeById.has('usr_a')).toBe(true);
    });
});
