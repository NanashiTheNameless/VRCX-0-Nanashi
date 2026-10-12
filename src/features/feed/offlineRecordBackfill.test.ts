// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import { handleFeedLoggerSyncEvent } from '@/services/offlineRecordService';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';
import { useRuntimeStore } from '@/state/runtimeStore';

const mocks = vi.hoisted(() => ({
    queryFeedLatest: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));

vi.mock('@/repositories/feedRepository', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/repositories/feedRepository')>()),
    default: {
        queryFeedLatest: mocks.queryFeedLatest,
        queryFeedPage: vi.fn().mockResolvedValue([]),
        queryFeed: vi.fn().mockResolvedValue([])
    }
}));

vi.mock('@/repositories/friendLogRepository', () => ({
    default: { getFriendLogCurrent: vi.fn().mockResolvedValue([]) }
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: { getAllUserStats: vi.fn().mockResolvedValue([]) }
}));

import { useFeedRows } from './useFeedRows';

const FEED_VIEW: Parameters<typeof useFeedRows>[0] = {
    activeFilters: [],
    dateFrom: '',
    dateTo: '',
    deferredSearchQuery: '',
    favoritesOnly: false,
    scopedUserIds: [],
    preferencesReady: true
};

async function openFeed() {
    renderHook(() => useFeedRows(FEED_VIEW));
    await waitFor(() => expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
    useOfflineRecordStore.setState({
        health: null,
        syncProgress: null,
        backfillRevision: 0
    });
    useRuntimeStore.setState((state) => ({
        auth: { ...state.auth, currentUserId: 'usr_self' }
    }));
    mocks.queryFeedLatest.mockResolvedValue({ rows: [], maxSequence: 0 });
    vi.mocked(commands.appFeedLoggerStatus).mockResolvedValue({
        state: 'notConfigured'
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Feed after the recorder fills in entries', () => {
    it('reloads when entries were written', async () => {
        await openFeed();

        act(() => {
            handleFeedLoggerSyncEvent({ state: 'pulling', frames: 2000 });
            handleFeedLoggerSyncEvent({
                state: 'finished',
                inserted: 12,
                skipped: 0
            });
        });

        await waitFor(() =>
            expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(2)
        );
    });

    it('stays as it is when nothing new was written', async () => {
        await openFeed();

        act(() => {
            handleFeedLoggerSyncEvent({ state: 'writing', frames: 5 });
            handleFeedLoggerSyncEvent({
                state: 'finished',
                inserted: 0,
                skipped: 0
            });
        });
        await act(
            () => new Promise<void>((resolve) => setTimeout(resolve, 20))
        );

        expect(mocks.queryFeedLatest).toHaveBeenCalledTimes(1);
    });
});
