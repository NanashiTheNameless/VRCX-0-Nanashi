import { normalizeString } from '@/shared/utils/string';

import type { FavoriteGroupMap } from './types';

const LOCAL_GROUP_PREFIX = 'local:';

export function resolveSelectedFavoriteGroupKeys(
    configured: readonly string[] | null | undefined,
    allGroupKeys: readonly string[]
): string[] {
    const existing = (configured ?? []).filter(
        (key) => key && allGroupKeys.includes(key)
    );
    return existing.length ? existing : [...allGroupKeys];
}

export function collectFavoriteGroupFriendIds(
    groupKeys: Iterable<string>,
    remoteIdsByGroupKey:
        | Readonly<Record<string, readonly string[]>>
        | null
        | undefined,
    localFriendFavorites: FavoriteGroupMap | null | undefined
): Set<string> {
    const ids = new Set<string>();
    for (const groupKey of groupKeys) {
        const groupIds = groupKey.startsWith(LOCAL_GROUP_PREFIX)
            ? localFriendFavorites?.[groupKey.slice(LOCAL_GROUP_PREFIX.length)]
            : remoteIdsByGroupKey?.[groupKey];
        for (const id of groupIds ?? []) {
            const normalized = normalizeString(id);
            if (normalized) {
                ids.add(normalized);
            }
        }
    }
    return ids;
}
