import type { LoadStatus } from '@/domain/shared/types';
import type { ReleaseStatusFilter } from '@/platform/tauri/bindings';
import type { AvatarProfileRecord } from '@/repositories/avatarProfileRepository';

export type MyAvatarsLoadStatus = LoadStatus;

export type MyAvatarsViewMode = 'grid' | 'table';

export type MyAvatarsGridDensity = 'standard' | 'compact' | 'dense';

export type MyAvatarsReleaseStatusFilter = Exclude<
    ReleaseStatusFilter,
    'hidden'
>;

export type MyAvatarsPlatformFilter = 'all' | 'pc' | 'android' | 'ios';

export type MyAvatarsSource = 'own' | 'licensed';

export type MyAvatarsAuthTarget = {
    currentUserId: string;
    currentEndpoint: string;
};

export type MyAvatarTag = {
    tag: string;
    color?: string | null;
};

type MyAvatarUnityPackage = Record<string, unknown>;

export type MyAvatarRow = Partial<AvatarProfileRecord> & {
    id?: string;
    name?: string;
    releaseStatus?: string;
    thumbnailImageUrl?: string;
    imageUrl?: string;
    unityPackages?: MyAvatarUnityPackage[];
    version?: number;
    updated_at?: string;
    created_at?: string;
    $tags?: MyAvatarTag[];
    $timeSpent?: number;
    $licensed?: boolean;
    [key: string]: unknown;
};

export type MyAvatarAction =
    | 'details'
    | 'wear'
    | 'manageTags'
    | 'editDetails'
    | 'makePrivate'
    | 'makePublic'
    | 'changeContentTags'
    | 'changeImage'
    | 'createImpostor';

export type MyAvatarActionHandler = (
    action: MyAvatarAction,
    avatar: MyAvatarRow
) => void | Promise<void>;

export type MyAvatarImageCropRequest = {
    file: File;
    avatar: MyAvatarRow;
    authTarget: MyAvatarsAuthTarget;
};

export type MyAvatarsGridDensityConfig = {
    value: MyAvatarsGridDensity;
    gridGap: number;
    gridMinWidth: number;
    overlayPaddingX: number;
    overlayPaddingY: number;
    overlayPaddingTop: number;
    overlayNameOnlyPaddingTop: number;
    overlayGap: number;
    nameFontSize: number;
    nameLineHeight: number;
    tagFontSize: number;
    maxVisibleTags: number;
};

export type MyAvatarsGridRow = {
    key: string;
    top: number;
    height: number;
    cellHeight: number;
    avatars: MyAvatarRow[];
};
