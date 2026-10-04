import type { FavoriteKind } from '@/domain/favorites/types';
import type { VrchatFavoriteType } from '@/platform/tauri/bindings';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';

type SortableFavoriteItem = {
    id: string;
    title?: string;
    orderIndex?: number;
    customIndex?: number;
    playerCount?: number;
};

export type FavoriteSortValue = 'name' | 'date' | 'players' | 'custom';

const SORT_VALUES_BY_KIND: Record<
    FavoriteKind,
    ReadonlySet<FavoriteSortValue>
> = {
    friend: new Set(['name', 'date', 'custom']),
    world: new Set(['name', 'date', 'players', 'custom']),
    avatar: new Set(['name', 'date', 'custom'])
};
const DEFAULT_SORT_VALUE: FavoriteSortValue = 'date';

export function normalizeFavoriteSortValue(
    kind: FavoriteKind,
    value: unknown
): FavoriteSortValue {
    const normalizedValue = String(value ?? '').trim();
    if (
        normalizedValue === 'name' ||
        normalizedValue === 'date' ||
        normalizedValue === 'players' ||
        normalizedValue === 'custom'
    ) {
        return SORT_VALUES_BY_KIND[kind].has(normalizedValue)
            ? normalizedValue
            : DEFAULT_SORT_VALUE;
    }
    return DEFAULT_SORT_VALUE;
}

export function normalizeFavoriteSearchValue(value: string): string {
    return value.trim().toLowerCase();
}

export function normalizeFavoriteEntityId(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export function sortFavoriteItems<TItem extends SortableFavoriteItem>(
    items: readonly TItem[],
    sortValue: FavoriteSortValue
): TItem[] {
    return [...items].sort((left, right) => {
        if (sortValue === 'players') {
            const playerDelta =
                (right.playerCount || 0) - (left.playerCount || 0);
            if (playerDelta !== 0) {
                return playerDelta;
            }
            return 0;
        }

        if (sortValue === 'custom') {
            const customDelta =
                (left.customIndex ?? -1) - (right.customIndex ?? -1);
            if (customDelta !== 0) {
                return customDelta;
            }
        }

        if (sortValue === 'date' || sortValue === 'custom') {
            const orderDelta =
                (left.orderIndex ?? Number.MAX_SAFE_INTEGER) -
                (right.orderIndex ?? Number.MAX_SAFE_INTEGER);
            if (orderDelta !== 0) {
                return orderDelta;
            }
        }

        const titleDelta = String(left.title || '').localeCompare(
            String(right.title || ''),
            undefined,
            {
                sensitivity: 'base'
            }
        );
        if (titleDelta !== 0) {
            return titleDelta;
        }

        return String(left.id || '').localeCompare(String(right.id || ''));
    });
}

export function resolveFavoriteImage(url: unknown): string {
    return typeof url === 'string' ? convertFileUrlToImageUrl(url, 256) : '';
}

export function shrinkFavoriteImage(url: unknown): string {
    if (typeof url !== 'string') {
        return '';
    }
    return convertFileUrlToImageUrl(url, 128);
}

export function favoriteGroupType(
    kind: FavoriteKind,
    group: { type?: string }
): VrchatFavoriteType {
    if (
        group.type === 'avatar' ||
        group.type === 'world' ||
        group.type === 'vrcPlusWorld' ||
        group.type === 'friend'
    ) {
        return group.type;
    }
    if (kind === 'world') {
        return 'world';
    }
    return kind;
}
