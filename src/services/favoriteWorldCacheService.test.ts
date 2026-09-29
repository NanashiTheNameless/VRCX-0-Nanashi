import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';
import { useFavoriteStore } from '@/state/favoriteStore';

import {
    cacheFavoriteWorldDetails,
    cacheWorldDetails
} from './favoriteWorldCacheService';

const mocks = vi.hoisted(() => ({
    getWorldFavorites: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFavoriteCacheSnapshot: vi.fn()
    }
}));

vi.mock('@/repositories/favoritePersistenceRepository', () => ({
    default: {
        getWorldFavorites: mocks.getWorldFavorites
    }
}));

describe('favoriteWorldCacheService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(commands.appFavoriteCacheSnapshot).mockResolvedValue(true);
        mocks.getWorldFavorites.mockResolvedValue([]);
        useFavoriteStore.getState().resetFavorites();
    });

    it('forwards the existing payload to the Rust cache policy', async () => {
        const world = {
            id: ' wrld_cache ',
            name: 'Cached World',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/thumb.png',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-02T00:00:00.000Z',
            version: 7
        };

        await expect(cacheWorldDetails(world)).resolves.toBe(true);

        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledWith({
            kind: 'world',
            entity: world,
            fallbackEntityId: ''
        });
    });

    it('uses the caller world id when a detail payload is missing id', async () => {
        await expect(
            cacheWorldDetails(
                {
                    name: 'Fallback World',
                    releaseStatus: 'public',
                    thumbnailImageUrl: 'https://example.test/fallback.png'
                },
                'wrld_fallback'
            )
        ).resolves.toBe(true);

        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledWith({
            kind: 'world',
            entity: {
                name: 'Fallback World',
                releaseStatus: 'public',
                thumbnailImageUrl: 'https://example.test/fallback.png'
            },
            fallbackEntityId: 'wrld_fallback'
        });
    });

    it('refreshes DB cache automatically for local favorite worlds', async () => {
        const world = {
            id: 'wrld_cached',
            name: 'Cached Local World',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/local.png'
        };

        await expect(cacheFavoriteWorldDetails(world)).resolves.toBe(false);
        expect(commands.appFavoriteCacheSnapshot).not.toHaveBeenCalled();

        mocks.getWorldFavorites.mockResolvedValue([
            {
                created_at: '2026-08-11T00:00:00Z',
                groupName: 'Keep',
                worldId: 'wrld_cached'
            }
        ]);

        await expect(cacheFavoriteWorldDetails(world)).resolves.toBe(true);
        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledTimes(1);
        expect(mocks.getWorldFavorites).toHaveBeenCalledTimes(2);
    });

    it('refreshes DB cache automatically for remote favorite worlds', async () => {
        const world = {
            id: 'wrld_remote_cached',
            name: 'Cached Remote World',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/remote.png'
        };

        useFavoriteStore.setState({
            favoriteWorldIds: ['wrld_remote_cached']
        });

        await expect(cacheFavoriteWorldDetails(world)).resolves.toBe(true);
        expect(mocks.getWorldFavorites).not.toHaveBeenCalled();
        expect(commands.appFavoriteCacheSnapshot).toHaveBeenCalledWith({
            kind: 'world',
            entity: world,
            fallbackEntityId: ''
        });
    });

    it('bumps the world details revision only when the DB cache was written', async () => {
        const world = {
            id: 'wrld_revision',
            name: 'Revision World',
            releaseStatus: 'public',
            thumbnailImageUrl: 'https://example.test/revision.png'
        };
        const before = useFavoriteRevisionStore.getState().worldDetailsRevision;

        await expect(cacheWorldDetails(world)).resolves.toBe(true);
        expect(useFavoriteRevisionStore.getState().worldDetailsRevision).toBe(
            before + 1
        );

        vi.mocked(commands.appFavoriteCacheSnapshot).mockResolvedValue(false);
        await expect(cacheWorldDetails(world)).resolves.toBe(false);
        expect(useFavoriteRevisionStore.getState().worldDetailsRevision).toBe(
            before + 1
        );
    });
});
