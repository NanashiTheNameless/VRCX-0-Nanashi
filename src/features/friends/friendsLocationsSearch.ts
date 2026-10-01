import { normalizeString } from '@/shared/utils/string';

import {
    resolveLocationSummary,
    friendLocationTarget
} from './friendsLocationsRows';

export function matchesFriendLocationSearch(
    friend: Record<string, unknown> | null | undefined,
    searchQuery: string,
    favoriteIds: ReadonlySet<string>
): boolean {
    if (!searchQuery) {
        return true;
    }

    const location = resolveLocationSummary(friend);
    const target = friendLocationTarget(friend);
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
        return true;
    }

    return (
        String(friend?.displayName || '')
            .toLowerCase()
            .includes(query) ||
        String(friend?.username || '')
            .toLowerCase()
            .includes(query) ||
        String(friend?.statusDescription || '')
            .toLowerCase()
            .includes(query) ||
        target.worldId.toLowerCase().includes(query) ||
        target.rawLocation.toLowerCase().includes(query) ||
        String(location.label || '')
            .toLowerCase()
            .includes(query) ||
        String(location.meta || '')
            .toLowerCase()
            .includes(query) ||
        (query === 'favorite' && favoriteIds.has(normalizeString(friend?.id)))
    );
}
