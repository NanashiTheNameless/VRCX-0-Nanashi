import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    checkVRChatCache: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        assetBundleCheckVrchatCache: mocks.checkVRChatCache
    }
}));

import { commands } from '@/platform/tauri/bindings';

import { defaultAvatarSideData } from './avatarAssets';
import { readAvatarCacheInfo } from './avatarCacheAdapter';

describe('avatarCacheAdapter', () => {
    beforeEach(() => {
        vi.mocked(commands.assetBundleCheckVrchatCache).mockReset();
    });

    it('reads avatar cache info using resolved bundle args', async () => {
        vi.mocked(commands.assetBundleCheckVrchatCache).mockResolvedValue({
            Item1: 2097152,
            Item2: true,
            Item3: 'C:/cache/avatar'
        });

        await expect(
            readAvatarCacheInfo(
                {
                    unityPackages: [
                        {
                            platform: 'standalonewindows',
                            variant: 'security',
                            unitySortNumber: '20220306000',
                            assetUrl:
                                'https://api.vrchat.cloud/api/1/file/file_cache/4/file?v=8'
                        }
                    ]
                },
                '2022.3.6f1'
            )
        ).resolves.toEqual({
            inCache: true,
            cacheSize: '2.00 MB',
            cacheLocked: true,
            cachePath: 'C:/cache/avatar'
        });
        expect(commands.assetBundleCheckVrchatCache).toHaveBeenCalledWith(
            'file_cache',
            4,
            'security',
            8
        );
    });

    it('returns empty cache info without checking cache when no bundle args can be resolved', async () => {
        await expect(
            readAvatarCacheInfo({ assetUrl: '' }, '')
        ).resolves.toEqual(defaultAvatarSideData().cache);
        expect(commands.assetBundleCheckVrchatCache).not.toHaveBeenCalled();
    });

    it('reads cache info with unfiltered bundle args when the SDK version is unavailable', async () => {
        vi.mocked(commands.assetBundleCheckVrchatCache).mockResolvedValue({
            Item1: 1048576,
            Item2: false,
            Item3: 'C:/cache/fallback'
        });

        await expect(
            readAvatarCacheInfo(
                {
                    unityPackages: [
                        {
                            platform: 'standalonewindows',
                            variant: 'standard',
                            unitySortNumber: '20220307000',
                            assetUrl:
                                'https://api.vrchat.cloud/api/1/file/file_config-fallback/6/file'
                        }
                    ]
                },
                ''
            )
        ).resolves.toEqual({
            inCache: true,
            cacheSize: '1.00 MB',
            cacheLocked: false,
            cachePath: 'C:/cache/fallback'
        });
        expect(commands.assetBundleCheckVrchatCache).toHaveBeenCalledWith(
            'file_config-fallback',
            6,
            'security',
            0
        );
    });
});
