import { commands } from '@/platform/tauri/bindings';
import { compareUnityVersion } from '@/shared/utils/avatar';
import {
    extractFileId,
    extractFileVersion,
    extractVariantVersion
} from '@/shared/utils/fileUtils';
import { isRecord } from '@/shared/utils/record';

type UnityPackage = Record<string, unknown> & {
    assetUrl?: string;
    platform?: string;
    unitySortNumber?: string | number;
    variant?: string;
};

type WorldRecord = Record<string, unknown> & {
    assetUrl?: string;
    unityPackages?: unknown;
};

type WorldAssetBundleArgs = {
    fileId: string;
    fileVersion: number;
    variant: string;
    variantVersion: number;
};

type WorldCacheInfo = {
    inCache: boolean;
    cacheSize: string;
    cacheLocked: boolean;
    cachePath: string;
};

export function defaultWorldCacheInfo(): WorldCacheInfo {
    return {
        inCache: false,
        cacheSize: '',
        cacheLocked: false,
        cachePath: ''
    };
}

function isWorldCacheCandidatePackage(
    unityPackage: unknown,
    sdkUnityVersion: string = ''
): unityPackage is UnityPackage {
    if (!isRecord(unityPackage)) {
        return false;
    }
    const source = unityPackage;
    if (source.platform !== 'standalonewindows') {
        return false;
    }
    if (
        source.variant &&
        source.variant !== 'standard' &&
        source.variant !== 'security'
    ) {
        return false;
    }
    if (
        sdkUnityVersion &&
        source.unitySortNumber &&
        !compareUnityVersion(
            String(source.unitySortNumber),
            String(sdkUnityVersion)
        )
    ) {
        return false;
    }
    return true;
}

export function resolveWorldAssetBundleArgs(
    world: WorldRecord | null | undefined,
    sdkUnityVersion: string = ''
): WorldAssetBundleArgs | null {
    const unityPackages = Array.isArray(world?.unityPackages)
        ? world.unityPackages
        : [];
    let selectedPackage = null;
    for (let index = unityPackages.length - 1; index >= 0; index -= 1) {
        const unityPackage = unityPackages[index];
        if (isWorldCacheCandidatePackage(unityPackage, sdkUnityVersion)) {
            selectedPackage = unityPackage;
            break;
        }
    }
    if (!selectedPackage && sdkUnityVersion) {
        return resolveWorldAssetBundleArgs(world, '');
    }
    const assetUrl = String(selectedPackage?.assetUrl || world?.assetUrl || '');
    const fileId = extractFileId(assetUrl);
    const fileVersion = Number.parseInt(extractFileVersion(assetUrl), 10);
    const variant =
        !selectedPackage?.variant || selectedPackage.variant === 'standard'
            ? 'security'
            : selectedPackage.variant;
    const variantVersion =
        Number.parseInt(extractVariantVersion(assetUrl), 10) || 0;
    if (!fileId || !Number.isFinite(fileVersion)) {
        return null;
    }
    return {
        fileId,
        fileVersion,
        variant,
        variantVersion
    };
}

export async function readWorldCacheInfo(
    world: WorldRecord | null | undefined,
    sdkUnityVersion: string
): Promise<WorldCacheInfo> {
    const args = resolveWorldAssetBundleArgs(world, sdkUnityVersion);
    if (!args) {
        return defaultWorldCacheInfo();
    }
    const cacheInfo = await commands.assetBundleCheckVrchatCache(
        args.fileId,
        args.fileVersion,
        args.variant,
        args.variantVersion
    );
    const size = cacheInfo.Item1;
    const cacheLocked = cacheInfo.Item2;
    const cachePath = cacheInfo.Item3;
    return {
        inCache: size > 0,
        cacheSize: size > 0 ? `${(size / 1048576).toFixed(2)} MB` : '',
        cacheLocked,
        cachePath
    };
}
