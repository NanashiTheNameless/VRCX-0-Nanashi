// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getFileAnalysisForUnityPackages: vi.fn(),
    getPreviousInstancesByWorldId: vi.fn(),
    getUserGroups: vi.fn(),
    getWorldMemo: vi.fn(),
    getWorldProfile: vi.fn(),
    hasWorldPersistentData: vi.fn(),
    persistFavoriteWorldDetails: vi.fn(),
    readWorldCacheInfo: vi.fn()
}));

vi.mock('@/lib/fileAnalysis', () => ({
    getFileAnalysisForUnityPackages: mocks.getFileAnalysisForUnityPackages
}));
vi.mock('@/lib/worldAssetBundle', () => ({
    defaultWorldCacheInfo: () => ({
        cacheLocked: false,
        cachePath: '',
        cacheSize: '',
        inCache: false
    }),
    readWorldCacheInfo: mocks.readWorldCacheInfo
}));
vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        getPreviousInstancesByWorldId: mocks.getPreviousInstancesByWorldId
    }
}));
vi.mock('@/repositories/groupProfileRepository', () => ({
    default: { getUserGroups: mocks.getUserGroups }
}));
vi.mock('@/repositories/memoPersistenceRepository', () => ({
    default: { getWorldMemo: mocks.getWorldMemo }
}));
vi.mock('@/repositories/worldProfileRepository', () => ({
    default: {
        normalize: (world: Record<string, unknown>) => ({ ...world }),
        getWorldProfile: mocks.getWorldProfile,
        hasWorldPersistentData: mocks.hasWorldPersistentData
    }
}));
vi.mock('@/services/favoriteWorldCacheService', () => ({
    persistFavoriteWorldDetails: mocks.persistFavoriteWorldDetails
}));

import { useVrchatConfigStore } from '@/state/vrchatConfigStore';

import { useWorldDialogData } from './useWorldDialogData';

describe('useWorldDialogData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useVrchatConfigStore.getState().setSnapshot({
            sdkUnityVersion: '2022.3.22f1'
        });
    });

    it('uses the session config version for world cache inspection', async () => {
        const world = {
            id: 'wrld_test',
            updatedAt: '2026-08-11T00:00:00.000Z',
            version: 3,
            unityPackages: []
        };
        mocks.getFileAnalysisForUnityPackages.mockResolvedValue({});
        mocks.getPreviousInstancesByWorldId.mockResolvedValue([]);
        mocks.getUserGroups.mockResolvedValue([]);
        mocks.getWorldMemo.mockResolvedValue(null);
        mocks.getWorldProfile.mockResolvedValue(world);
        mocks.hasWorldPersistentData.mockResolvedValue(false);
        mocks.readWorldCacheInfo.mockResolvedValue({});

        renderHook(() =>
            useWorldDialogData({
                normalizedWorldId: world.id,
                profileWorldId: world.id,
                seedData: world,
                currentEndpoint: 'https://api.example.test',
                currentUserId: 'usr_self',
                isCurrentWorldTarget: () => true,
                memoRevisionRef: { current: 0 }
            })
        );

        await waitFor(() => {
            expect(mocks.readWorldCacheInfo).toHaveBeenCalledWith(
                expect.objectContaining({ id: world.id }),
                '2022.3.22f1'
            );
        });
        expect(mocks.getFileAnalysisForUnityPackages).toHaveBeenCalledWith({
            unityPackages: world.unityPackages,
            sdkUnityVersion: '2022.3.22f1',
            endpoint: 'https://api.example.test'
        });
    });

    it('loads current-user groups only when the new-instance flow requests them', async () => {
        const world = {
            id: 'wrld_test',
            unityPackages: []
        };
        mocks.getFileAnalysisForUnityPackages.mockResolvedValue({});
        mocks.getPreviousInstancesByWorldId.mockResolvedValue([]);
        mocks.getUserGroups.mockResolvedValue([
            { id: 'grp_two', name: 'Two' },
            { id: 'grp_one', name: 'One' }
        ]);
        mocks.getWorldMemo.mockResolvedValue(null);
        mocks.getWorldProfile.mockResolvedValue(world);
        mocks.hasWorldPersistentData.mockResolvedValue(false);
        mocks.readWorldCacheInfo.mockResolvedValue({});

        const { result } = renderHook(() =>
            useWorldDialogData({
                normalizedWorldId: world.id,
                profileWorldId: world.id,
                seedData: world,
                currentEndpoint: 'https://api.example.test',
                currentUserId: 'usr_self',
                isCurrentWorldTarget: () => true,
                memoRevisionRef: { current: 0 }
            })
        );

        expect(mocks.getUserGroups).not.toHaveBeenCalled();

        await act(async () => {
            await result.current.loadNewInstanceGroups();
        });

        expect(mocks.getUserGroups).toHaveBeenCalledOnce();
        expect(result.current.newInstanceGroups).toEqual([
            { id: 'grp_one', name: 'One' },
            { id: 'grp_two', name: 'Two' }
        ]);
    });
});
