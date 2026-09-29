// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    queryFeedLatest: vi.fn(),
    queryFeedPage: vi.fn(),
    runtime: { auth: { currentUserId: 'usr_self' } },
    session: { isFavoritesLoaded: true },
    favorites: {
        remoteFavoritesById: {} as Record<string, FavoriteRecord>,
        localFriendFavorites: {} as FavoriteGroupMap
    },
    preferences: {
        feedHiddenUsers: [] as string[],
        feedPersistenceDisabled: false,
        tableLimits: { maxTableSize: 100 }
    }
}));

vi.mock('@/repositories/feedRepository', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/repositories/feedRepository')>()),
    default: {
        queryFeedLatest: mocks.queryFeedLatest,
        queryFeedPage: mocks.queryFeedPage
    }
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: <T>(selector: (state: typeof mocks.runtime) => T): T =>
        selector(mocks.runtime)
}));

vi.mock('@/state/sessionStore', () => ({
    useSessionStore: <T>(selector: (state: typeof mocks.session) => T): T =>
        selector(mocks.session)
}));

vi.mock('@/state/favoriteStore', () => ({
    useFavoriteStore: <T>(selector: (state: typeof mocks.favorites) => T): T =>
        selector(mocks.favorites)
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: Object.assign(
        <T>(selector: (state: typeof mocks.preferences) => T): T =>
            selector(mocks.preferences),
        { getState: () => mocks.preferences }
    )
}));

import type { FeedRow } from '@/components/feed/feedTypes';
import type {
    FavoriteGroupMap,
    FavoriteRecord
} from '@/domain/favorites/types';
import type { FeedReadModelResult } from '@/domain/feed/readModel';
import { useFeedLiveStore } from '@/state/feedLiveStore';

import type { FeedColumnConfig } from '../feedColumnsState';
import {
    createDeferred,
    flush,
    pushLiveEntry
} from '../feedLiveMergeTestUtils';
import {
    resolveFeedColumnInitialLiveSequence,
    useFeedColumnRows
} from './useFeedColumnRows';

function createColumn(id: string): FeedColumnConfig {
    return {
        id,
        title: id,
        width: 320,
        friendScope: { kind: 'all' },
        feedTypes: []
    };
}

describe('feed column rows', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.preferences.feedPersistenceDisabled = false;
        useFeedLiveStore.getState().resetFeedLive();
        mocks.queryFeedLatest.mockResolvedValue({ rows: [], maxSequence: 0 });
        mocks.queryFeedPage.mockResolvedValue([]);
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('normalizes the initial Rust sequence watermark', () => {
        expect(resolveFeedColumnInitialLiveSequence(7)).toBe(7);
        expect(resolveFeedColumnInitialLiveSequence(-1)).toBe(0);
        expect(resolveFeedColumnInitialLiveSequence(Number.NaN)).toBe(0);
        expect(
            resolveFeedColumnInitialLiveSequence(Number.POSITIVE_INFINITY)
        ).toBe(0);
    });

    it('bounds the latest snapshot to one column page', async () => {
        const column = createColumn('first');
        renderHook(() => useFeedColumnRows(column));
        await flush();

        expect(mocks.queryFeedLatest).toHaveBeenCalledWith(
            expect.objectContaining({ maxRows: 80 })
        );
    });

    it('applies realtime entries locally after the latest snapshot', async () => {
        mocks.queryFeedLatest.mockResolvedValue({
            rows: [{ userId: 'usr_base' }],
            maxSequence: 0
        });
        const column = createColumn('first');
        const { result } = renderHook(() => useFeedColumnRows(column));
        await flush();

        pushLiveEntry('live');
        await flush();

        expect(result.current.rows.map((row) => row.userId)).toEqual([
            'usr_live',
            'usr_base'
        ]);
        expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(1);
    });

    it('uses the Rust cache snapshot and disables older paging without persistence', async () => {
        mocks.preferences.feedPersistenceDisabled = true;
        mocks.queryFeedLatest.mockResolvedValue({
            rows: [{ userId: 'usr_cached' }],
            maxSequence: 0,
            persistedCursor: {
                createdAt: '2026-08-10T00:00:00Z',
                sourceRank: 50,
                rowId: 42
            },
            persistedHasMore: true
        });
        const column = createColumn('disabled');
        const { result } = renderHook(() => useFeedColumnRows(column));
        await flush();

        expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(1);
        expect(result.current.rows.map((row) => row.userId)).toEqual([
            'usr_cached'
        ]);
        expect(result.current.hasMore).toBe(false);
        act(() => result.current.loadOlder());
        await flush();
        expect(mocks.queryFeedPage).not.toHaveBeenCalled();
    });

    it('pages from the persisted cursor when live rows fill the latest result', async () => {
        const persistedCursor = {
            createdAt: '2026-08-10T00:00:00Z',
            sourceRank: 50,
            rowId: 42
        };
        mocks.queryFeedLatest.mockResolvedValue({
            rows: Array.from({ length: 80 }, (_, index) => ({
                userId: `usr_live_${index}`
            })),
            maxSequence: 80,
            persistedCursor,
            persistedHasMore: true
        });
        const column = createColumn('live-page');
        const { result } = renderHook(() => useFeedColumnRows(column));
        await flush();

        expect(result.current.hasMore).toBe(true);
        act(() => result.current.loadOlder());
        await flush();

        expect(mocks.queryFeedPage).toHaveBeenCalledWith(
            expect.objectContaining({ cursor: persistedCursor })
        );
    });

    it('discards a stale snapshot after the column changes', async () => {
        const stale = createDeferred<FeedReadModelResult<FeedRow>>();
        const fresh = createDeferred<FeedReadModelResult<FeedRow>>();
        mocks.queryFeedLatest
            .mockReturnValueOnce(stale.promise)
            .mockReturnValueOnce(fresh.promise);
        const { result, rerender } = renderHook(
            (column: FeedColumnConfig) => useFeedColumnRows(column),
            { initialProps: createColumn('first') }
        );

        rerender(createColumn('second'));
        stale.resolve({ rows: [{ userId: 'usr_stale' }], maxSequence: 0 });
        fresh.resolve({ rows: [{ userId: 'usr_fresh' }], maxSequence: 0 });
        await flush();

        expect(result.current.rows).toEqual([{ userId: 'usr_fresh' }]);
    });
});
