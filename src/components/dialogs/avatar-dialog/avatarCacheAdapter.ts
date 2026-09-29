import { commands } from '@/platform/tauri/bindings';

import { defaultAvatarSideData, resolveAssetBundleArgs } from './avatarAssets';

export async function readAvatarCacheInfo(
    avatar: unknown,
    sdkUnityVersion: string
) {
    const args = resolveAssetBundleArgs(avatar, sdkUnityVersion);
    if (!args) {
        return defaultAvatarSideData().cache;
    }
    const cacheInfo = await commands.assetBundleCheckVrchatCache(
        args.fileId,
        args.fileVersion,
        args.variant,
        args.variantVersion
    );
    const size = Number(cacheInfo?.Item1 ?? 0);
    const cacheLocked = Boolean(cacheInfo?.Item2);
    const cachePath = String(cacheInfo?.Item3 ?? '');
    return {
        inCache: size > 0,
        cacheSize: size > 0 ? `${(size / 1048576).toFixed(2)} MB` : '',
        cacheLocked,
        cachePath
    };
}
