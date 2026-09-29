// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    queryGameLog: vi.fn(),
    queryLatestSessions: vi.fn()
}));

vi.mock('@/lib/useThrottledValue', () => ({
    useThrottledValue: (value: number) => value
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        queryGameLog: mocks.queryGameLog,
        queryLatestSessions: mocks.queryLatestSessions
    }
}));

vi.mock('@/state/favoriteStore', () => ({
    useFavoriteStore: (
        selector: (state: {
            favoriteFriendIds: string[];
            localFriendFavorites: string[];
        }) => unknown
    ) =>
        selector({
            favoriteFriendIds: [],
            localFriendFavorites: []
        })
}));

vi.mock('@/state/preferencesStore', () => ({
    usePreferencesStore: (
        selector: (state: { gameLogDisabled: boolean }) => unknown
    ) => selector({ gameLogDisabled: false })
}));

vi.mock('@/state/runtimeStore', () => ({
    useRuntimeStore: (
        selector: (state: {
            auth: { currentUserId: string };
            runtimeEvents: { addGameLogEvent: { count: number } };
        }) => unknown
    ) =>
        selector({
            auth: { currentUserId: 'usr_self' },
            runtimeEvents: { addGameLogEvent: { count: 0 } }
        })
}));

vi.mock('@/state/sessionStore', () => ({
    useSessionStore: (
        selector: (state: { isFavoritesLoaded: boolean }) => unknown
    ) => selector({ isFavoritesLoaded: true })
}));

import { useGameLogRows } from './useGameLogRows';

describe('useGameLogRows', () => {
    afterEach(cleanup);

    beforeEach(() => {
        mocks.queryGameLog.mockReset();
        mocks.queryGameLog.mockResolvedValue([]);
        mocks.queryLatestSessions.mockReset();
        mocks.queryLatestSessions.mockResolvedValue([]);
    });

    it('loads the complete configured table result instead of one page', async () => {
        renderHook(() =>
            useGameLogRows({
                deferredSearchQuery: '',
                favoritesOnly: false,
                filters: [],
                preferencesReady: true,
                refreshToken: 0,
                sessionDateFrom: '',
                sessionDateTo: '',
                sessionLimit: 25,
                viewMode: 'table'
            })
        );

        await waitFor(() => expect(mocks.queryGameLog).toHaveBeenCalled());

        expect(mocks.queryGameLog).toHaveBeenCalledWith({
            currentUserId: 'usr_self',
            search: '',
            filters: [],
            favoriteUserIds: [],
            dateFrom: '',
            dateTo: '',
            limit: undefined
        });
    });
});
