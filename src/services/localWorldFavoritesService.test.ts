import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appFavoriteLocalSnapshot: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFavoriteLocalSnapshot: mocks.appFavoriteLocalSnapshot
    }
}));

import { loadLocalWorldFavoritesSnapshot } from './localWorldFavoritesService';

describe('localWorldFavoritesService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.appFavoriteLocalSnapshot.mockResolvedValue({
            favorites: [],
            groupNames: []
        });
    });

    it('builds a fresh grouped snapshot from Rust-backed persistence reads', async () => {
        mocks.appFavoriteLocalSnapshot.mockResolvedValue({
            groupNames: ['Empty', 'Worlds'],
            favorites: [
                {
                    createdAt: '2026-08-11T00:00:00Z',
                    worldId: 'wrld_1',
                    avatarId: null,
                    userId: null,
                    groupName: 'Worlds'
                },
                {
                    createdAt: '2026-08-11T00:00:01Z',
                    worldId: 'wrld_2',
                    avatarId: null,
                    userId: null,
                    groupName: 'Worlds'
                },
                {
                    createdAt: '2026-08-11T00:00:02Z',
                    worldId: 'wrld_1',
                    avatarId: null,
                    userId: null,
                    groupName: 'Worlds'
                }
            ]
        });

        await expect(loadLocalWorldFavoritesSnapshot()).resolves.toEqual({
            favoritesByGroup: {
                Empty: [],
                Worlds: ['wrld_2', 'wrld_1']
            },
            groupNames: ['Empty', 'Worlds']
        });
        expect(mocks.appFavoriteLocalSnapshot).toHaveBeenCalledWith('world');
    });

    it('defaults to an empty Favorites group when no groups or favorites exist', async () => {
        await expect(loadLocalWorldFavoritesSnapshot()).resolves.toEqual({
            favoritesByGroup: { Favorites: [] },
            groupNames: ['Favorites']
        });
    });
});
