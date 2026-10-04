import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalFavoriteSnapshot } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    appFavoriteLocalSnapshot: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFavoriteLocalSnapshot: mocks.appFavoriteLocalSnapshot
    }
}));

const EMPTY_SNAPSHOT: LocalFavoriteSnapshot = {
    favorites: [],
    groupNames: []
};

describe('favoriteLocalRefreshService', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        useFavoriteStore.getState().resetFavorites();

        mocks.appFavoriteLocalSnapshot.mockResolvedValue(EMPTY_SNAPSHOT);
    });

    it('leaves local world favorites out of the frontend store refresh path', async () => {
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        await refreshLocalFavoritesForKinds(['world']);

        expect(mocks.appFavoriteLocalSnapshot).not.toHaveBeenCalled();
    });

    it('deduplicates repeated kinds and refreshes each requested kind once', async () => {
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        await refreshLocalFavoritesForKinds(['avatar', 'avatar', 'friend']);

        expect(mocks.appFavoriteLocalSnapshot).toHaveBeenCalledTimes(2);
        expect(mocks.appFavoriteLocalSnapshot).toHaveBeenCalledWith('avatar');
        expect(mocks.appFavoriteLocalSnapshot).toHaveBeenCalledWith('friend');
    });

    it('keeps the backend group order and lists the newest favorites first', async () => {
        mocks.appFavoriteLocalSnapshot.mockResolvedValueOnce({
            favorites: [
                { createdAt: '2026-01-01', avatarId: 'avtr_1', groupName: 'B' },
                { createdAt: '2026-01-02', avatarId: 'avtr_2', groupName: 'B' }
            ],
            groupNames: ['B', 'A']
        } satisfies LocalFavoriteSnapshot);
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        await refreshLocalFavoritesForKinds(['avatar']);

        const state = useFavoriteStore.getState();
        expect(state.localAvatarFavoriteGroups).toEqual(['B', 'A']);
        expect(state.localAvatarFavorites).toEqual({
            B: ['avtr_2', 'avtr_1']
        });
    });

    it('keeps the newest result when same-kind refreshes finish out of order', async () => {
        let resolveFirst: (snapshot: LocalFavoriteSnapshot) => void = () =>
            undefined;
        mocks.appFavoriteLocalSnapshot
            .mockImplementationOnce(
                () =>
                    new Promise<LocalFavoriteSnapshot>((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValueOnce({
                favorites: [
                    {
                        createdAt: '2026-01-02',
                        avatarId: 'avtr_new',
                        groupName: 'New'
                    }
                ],
                groupNames: ['New']
            } satisfies LocalFavoriteSnapshot);
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');

        const first = refreshLocalFavoritesForKinds(['avatar']);
        await refreshLocalFavoritesForKinds(['avatar']);
        resolveFirst({
            favorites: [
                {
                    createdAt: '2026-01-01',
                    avatarId: 'avtr_old',
                    groupName: 'Old'
                }
            ],
            groupNames: ['Old']
        });
        await first;

        expect(useFavoriteStore.getState().localAvatarFavorites).toEqual({
            New: ['avtr_new']
        });
    });

    it('drops a completed read after the favorite owner changes', async () => {
        let resolveSnapshot: (snapshot: LocalFavoriteSnapshot) => void = () =>
            undefined;
        mocks.appFavoriteLocalSnapshot.mockImplementationOnce(
            () =>
                new Promise<LocalFavoriteSnapshot>((resolve) => {
                    resolveSnapshot = resolve;
                })
        );
        const { useFavoriteStore } = await import('@/state/favoriteStore');
        const { refreshLocalFavoritesForKinds } =
            await import('./favoriteLocalRefreshService');
        useFavoriteStore.getState().setFavoritesLoading('usr_old');

        const refresh = refreshLocalFavoritesForKinds(['friend']);
        useFavoriteStore.getState().setFavoritesLoading('usr_new');
        resolveSnapshot({
            favorites: [
                {
                    createdAt: '2026-01-01',
                    userId: 'usr_friend',
                    groupName: 'Friends'
                }
            ],
            groupNames: ['Friends']
        });
        await refresh;

        const state = useFavoriteStore.getState();
        expect(state.currentUserId).toBe('usr_new');
        expect(state.localFriendFavorites).toEqual({});
    });
});
