import type { FavoriteKind } from '@/domain/favorites/types';

export type FavoriteSearchMode = 'name' | 'tag';
export type FavoriteSource = 'remote' | 'local' | 'history';

export type FavoriteSeedData = Record<string, unknown> & {
    displayName?: string;
    groupName?: string;
    id?: string;
    releaseStatus?: string;
    status?: string | null;
    worldName?: string;
};

export type FavoriteGroupView = {
    key: string;
    source: FavoriteSource;
    label: string;
    name?: string;
    type?: string;
    count?: number;
    capacity?: number;
    visibility?: string;
};

export type FavoriteItem = {
    key: string;
    id: string;
    kind: FavoriteKind;
    source: FavoriteSource;
    groupKey?: string;
    groupLabel?: string;
    title?: string;
    subtitle?: string;
    authorName?: string;
    description?: string;
    detailText?: string;
    imageSmallUrl?: string;
    imageUrl?: string;
    seedData?: FavoriteSeedData | null;
    isUnavailable?: boolean;
    isPrivate?: boolean;
    isDeleted?: boolean;
    isLoadingDetail?: boolean;
    location?: string;
    orderIndex?: number;
    customIndex?: number;
    playerCount?: number;
    statusLabel?: string;
    statusVariant?: string;
    tags?: string[];
    titleColor?: string;
    travelingToLocation?: string;
};
