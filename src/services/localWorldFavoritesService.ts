import type { FavoriteGroupMap } from '@/domain/favorites/types';
import { commands } from '@/platform/tauri/bindings';

export interface LocalWorldFavoritesSnapshot {
    favoritesByGroup: FavoriteGroupMap;
    groupNames: string[];
}

function normalize(value: string | null | undefined): string {
    return (value ?? '').trim();
}

export async function loadLocalWorldFavoritesSnapshot(): Promise<LocalWorldFavoritesSnapshot> {
    const snapshot = await commands.appFavoriteLocalSnapshot('world');
    const favoritesByGroup: FavoriteGroupMap = {};
    const groupNames: string[] = [];
    function ensureGroup(groupName: string): string[] {
        if (!favoritesByGroup[groupName]) {
            favoritesByGroup[groupName] = [];
            groupNames.push(groupName);
        }
        return favoritesByGroup[groupName];
    }

    for (const groupName of snapshot.groupNames) {
        const normalizedGroupName = normalize(groupName);
        if (normalizedGroupName) {
            ensureGroup(normalizedGroupName);
        }
    }

    for (const row of snapshot.favorites) {
        const worldId = normalize(row.worldId);
        if (!worldId) {
            continue;
        }
        const ids = ensureGroup(normalize(row.groupName) || 'Favorites');
        if (!ids.includes(worldId)) {
            ids.unshift(worldId);
        }
    }

    if (groupNames.length === 0) {
        ensureGroup('Favorites');
    }

    return {
        favoritesByGroup,
        groupNames
    };
}
