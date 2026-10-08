import {
    FEED_FILTER_TYPES,
    isFeedFilterType,
    type FeedFilterType
} from '@/repositories/feedRepository';
import { isRecord } from '@/shared/utils/record';
import { normalizeString } from '@/shared/utils/string';

export type FeedViewMode = 'table' | 'columns';

export type FeedColumnFavoriteGroupSelection = 'all' | string[];

export type FeedColumnFriendScope =
    | {
          kind: 'all';
          excludedFavoriteGroupKeys?: FeedColumnFavoriteGroupSelection;
      }
    | {
          kind: 'favorites';
          groupKeys: FeedColumnFavoriteGroupSelection;
          excludedFavoriteGroupKeys?: FeedColumnFavoriteGroupSelection;
      };

export type FeedColumnConfig = {
    id: string;
    title: string;
    width: number;
    friendScope: FeedColumnFriendScope;
    feedTypes: FeedFilterType[];
};

export const MIN_FEED_COLUMN_WIDTH = 240;
export const MAX_FEED_COLUMN_WIDTH = 960;
const DEFAULT_COLUMN_WIDTH = 320;
export const MAX_FEED_COLUMNS = 8;

const ALL_FEED_TYPES = [...FEED_FILTER_TYPES];
const FAVORITE_EXCLUDED_PRESET_IDS = new Set([
    'location',
    'profile',
    'presence'
]);

export const FEED_COLUMNS_DEFAULT_CONFIG: FeedColumnConfig[] = [
    {
        id: 'fav',
        title: 'Favorites',
        width: DEFAULT_COLUMN_WIDTH,
        friendScope: { kind: 'favorites', groupKeys: 'all' },
        feedTypes: ALL_FEED_TYPES
    },
    {
        id: 'location',
        title: 'Location',
        width: DEFAULT_COLUMN_WIDTH,
        friendScope: { kind: 'all', excludedFavoriteGroupKeys: 'all' },
        feedTypes: ['GPS']
    },
    {
        id: 'profile',
        title: 'Profile',
        width: DEFAULT_COLUMN_WIDTH,
        friendScope: { kind: 'all', excludedFavoriteGroupKeys: 'all' },
        feedTypes: ['Status', 'Avatar', 'Bio']
    },
    {
        id: 'presence',
        title: 'Presence',
        width: DEFAULT_COLUMN_WIDTH,
        friendScope: { kind: 'all', excludedFavoriteGroupKeys: 'all' },
        feedTypes: ['Online', 'Offline']
    }
];

function createColumnId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `col_${crypto.randomUUID()}`;
    }
    return `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function clampFeedColumnWidth(width: number): number {
    return Math.min(
        MAX_FEED_COLUMN_WIDTH,
        Math.max(MIN_FEED_COLUMN_WIDTH, Math.round(width))
    );
}

function sanitizeWidth(value: unknown): number {
    const width = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(width)) {
        return DEFAULT_COLUMN_WIDTH;
    }
    return clampFeedColumnWidth(width);
}

function sanitizeFeedTypes(value: unknown): FeedFilterType[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter(isFeedFilterType)
        .filter((type, index, source) => source.indexOf(type) === index);
}

function feedTypesEqual(left: FeedFilterType[], right: FeedFilterType[]) {
    return (
        left.length === right.length &&
        left.every((type, index) => type === right[index])
    );
}

function sanitizeFavoriteGroupSelection(
    value: unknown
): FeedColumnFavoriteGroupSelection | undefined {
    if (value === 'all') {
        return 'all';
    }
    if (!Array.isArray(value)) {
        return undefined;
    }
    const groupKeys = Array.from(
        new Set(value.map(normalizeString).filter(Boolean))
    );
    return groupKeys.length ? groupKeys : undefined;
}

function applyExcludedFavoriteGroups<T extends FeedColumnFriendScope>(
    scope: T,
    excludedFavoriteGroupKeys: FeedColumnFavoriteGroupSelection | undefined
): T {
    if (!excludedFavoriteGroupKeys) {
        return scope;
    }
    return {
        ...scope,
        excludedFavoriteGroupKeys
    };
}

function sanitizeFriendScope(value: unknown): FeedColumnFriendScope {
    if (!isRecord(value)) {
        return { kind: 'all' };
    }
    const excludedFavoriteGroupKeys = sanitizeFavoriteGroupSelection(
        value.excludedFavoriteGroupKeys
    );
    if (value.kind !== 'favorites') {
        return applyExcludedFavoriteGroups(
            { kind: 'all' },
            excludedFavoriteGroupKeys
        );
    }
    if (value.groupKeys === 'all') {
        return applyExcludedFavoriteGroups(
            { kind: 'favorites', groupKeys: 'all' },
            excludedFavoriteGroupKeys
        );
    }
    if (!Array.isArray(value.groupKeys)) {
        return applyExcludedFavoriteGroups(
            { kind: 'favorites', groupKeys: 'all' },
            excludedFavoriteGroupKeys
        );
    }
    const groupKeys = Array.from(
        new Set(value.groupKeys.map(normalizeString).filter(Boolean))
    );
    return {
        kind: 'favorites',
        groupKeys,
        ...(excludedFavoriteGroupKeys ? { excludedFavoriteGroupKeys } : {})
    };
}

export function sanitizeFeedViewMode(value: unknown): FeedViewMode {
    return value === 'columns' ? 'columns' : 'table';
}

export function sanitizeFeedColumnConfig(
    value: unknown
): FeedColumnConfig | null {
    if (!isRecord(value)) {
        return null;
    }
    const feedTypes = sanitizeFeedTypes(value.feedTypes);
    if (!feedTypes.length) {
        return null;
    }
    const id = normalizeString(value.id) || createColumnId();
    const title = normalizeString(value.title);
    if (!title) {
        return null;
    }
    return applyPresetScopeDefaults({
        id,
        title: id === 'fav' && title === 'Fav' ? 'Favorites' : title,
        width: sanitizeWidth(value.width),
        friendScope: sanitizeFriendScope(value.friendScope),
        feedTypes
    });
}

function applyPresetScopeDefaults(column: FeedColumnConfig): FeedColumnConfig {
    if (
        !FAVORITE_EXCLUDED_PRESET_IDS.has(column.id) ||
        column.friendScope.kind !== 'all' ||
        column.friendScope.excludedFavoriteGroupKeys
    ) {
        return column;
    }

    const preset = FEED_COLUMNS_DEFAULT_CONFIG.find(
        (defaultColumn) => defaultColumn.id === column.id
    );
    if (!preset || !feedTypesEqual(column.feedTypes, preset.feedTypes)) {
        return column;
    }

    return {
        ...column,
        friendScope: copyFeedColumnFriendScope(preset.friendScope)
    };
}

export function sanitizeFeedColumnsConfig(value: unknown): FeedColumnConfig[] {
    const columns = (Array.isArray(value) ? value : [])
        .map(sanitizeFeedColumnConfig)
        .filter((column): column is FeedColumnConfig => column !== null)
        .slice(0, MAX_FEED_COLUMNS);
    return columns.length ? columns : createFeedColumnsPresetConfig();
}

export function createFeedColumnsPresetConfig(): FeedColumnConfig[] {
    return FEED_COLUMNS_DEFAULT_CONFIG.map((column) => ({
        ...column,
        feedTypes: [...column.feedTypes],
        friendScope: copyFeedColumnFriendScope(column.friendScope)
    }));
}

function copyFavoriteGroupSelection(
    selection: FeedColumnFavoriteGroupSelection | undefined
) {
    return Array.isArray(selection) ? [...selection] : selection;
}

export function copyFeedColumnExclusion(
    sourceScope: FeedColumnFriendScope,
    targetScope: FeedColumnFriendScope
): FeedColumnFriendScope {
    const excludedFavoriteGroupKeys = copyFavoriteGroupSelection(
        sourceScope.excludedFavoriteGroupKeys
    );
    return excludedFavoriteGroupKeys
        ? {
              ...targetScope,
              excludedFavoriteGroupKeys
          }
        : targetScope;
}

function copyFeedColumnFriendScope(
    scope: FeedColumnFriendScope
): FeedColumnFriendScope {
    if (scope.kind === 'favorites') {
        return {
            kind: 'favorites',
            groupKeys: copyFavoriteGroupSelection(scope.groupKeys) || 'all',
            ...(scope.excludedFavoriteGroupKeys
                ? {
                      excludedFavoriteGroupKeys: copyFavoriteGroupSelection(
                          scope.excludedFavoriteGroupKeys
                      )
                  }
                : {})
        };
    }
    return {
        kind: 'all',
        ...(scope.excludedFavoriteGroupKeys
            ? {
                  excludedFavoriteGroupKeys: copyFavoriteGroupSelection(
                      scope.excludedFavoriteGroupKeys
                  )
              }
            : {})
    };
}

export function createFeedColumnConfig(
    patch: Partial<FeedColumnConfig> = {}
): FeedColumnConfig {
    return {
        id: patch.id || createColumnId(),
        title: patch.title || 'New Column',
        width: sanitizeWidth(patch.width),
        friendScope: patch.friendScope || { kind: 'all' },
        feedTypes: sanitizeFeedTypes(patch.feedTypes).length
            ? sanitizeFeedTypes(patch.feedTypes)
            : ALL_FEED_TYPES
    };
}
