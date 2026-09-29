import type {
    QueryOrder,
    ReleaseStatusFilter,
    WorldSearchSort
} from '@/platform/tauri/bindings';

type UserDialogSelectOption<TValue extends string> = {
    name: string;
    value: TValue;
};

export const userDialogWorldSortingOptions = [
    { name: 'dialog.user.worlds.sorting.name', value: 'name' },
    { name: 'dialog.user.worlds.sorting.updated', value: 'updated' },
    { name: 'dialog.user.worlds.sorting.created', value: 'created' },
    { name: 'dialog.user.worlds.sorting.favorites', value: 'favorites' },
    { name: 'dialog.user.worlds.sorting.popularity', value: 'popularity' }
] as const satisfies readonly UserDialogSelectOption<WorldSearchSort>[];

export type UserDialogWorldSort =
    (typeof userDialogWorldSortingOptions)[number]['value'];

export const userDialogWorldOrderOptions = [
    { name: 'dialog.user.worlds.order.descending', value: 'descending' },
    { name: 'dialog.user.worlds.order.ascending', value: 'ascending' }
] as const satisfies readonly UserDialogSelectOption<QueryOrder>[];

export type UserDialogWorldOrder =
    (typeof userDialogWorldOrderOptions)[number]['value'];

export const userDialogGroupSortingOptions = [
    { name: 'dialog.user.groups.sorting.alphabetical', value: 'alphabetical' },
    { name: 'dialog.user.groups.sorting.members', value: 'members' },
    { name: 'dialog.user.groups.sorting.in_game', value: 'inGame' }
] as const;

export type UserDialogGroupSort =
    (typeof userDialogGroupSortingOptions)[number]['value'];

export const userDialogMutualFriendSortingOptions = [
    {
        name: 'dialog.user.mutual_friends.sorting.alphabetical',
        value: 'alphabetical'
    },
    {
        name: 'dialog.user.mutual_friends.sorting.last_active',
        value: 'lastActive'
    },
    {
        name: 'dialog.user.mutual_friends.sorting.friend_order',
        value: 'friendOrder'
    }
] as const;

export type UserDialogMutualFriendSort =
    (typeof userDialogMutualFriendSortingOptions)[number]['value'];

export type UserDialogMutualView = 'list' | 'graph';

const MUTUAL_VIEW_STORAGE_KEY = 'VRCX_UserDialogMutualView';

export function readUserDialogMutualView(): UserDialogMutualView {
    try {
        return localStorage.getItem(MUTUAL_VIEW_STORAGE_KEY) === 'graph'
            ? 'graph'
            : 'list';
    } catch {
        return 'list';
    }
}

export function writeUserDialogMutualView(view: UserDialogMutualView) {
    try {
        localStorage.setItem(MUTUAL_VIEW_STORAGE_KEY, view);
    } catch {
        // localStorage may be unavailable; the view falls back to the list.
    }
}

export const userDialogAvatarSortingOptions = [
    { name: 'dialog.user.avatars.sort_by_name', value: 'name' },
    { name: 'dialog.user.avatars.sort_by_update', value: 'update' },
    { name: 'dialog.user.avatars.sort_by_uploaded', value: 'createdAt' }
] as const;

export type UserDialogAvatarSort =
    (typeof userDialogAvatarSortingOptions)[number]['value'];

export function isUserDialogAvatarSort(
    value: string
): value is UserDialogAvatarSort {
    return userDialogAvatarSortingOptions.some(
        (option) => option.value === value
    );
}

export const userDialogAvatarReleaseStatusOptions = [
    { name: 'dialog.user.avatars.all', value: 'all' },
    { name: 'dialog.user.avatars.public', value: 'public' },
    { name: 'dialog.user.avatars.private', value: 'private' }
] as const satisfies readonly UserDialogSelectOption<ReleaseStatusFilter>[];

export type UserDialogAvatarReleaseStatus =
    (typeof userDialogAvatarReleaseStatusOptions)[number]['value'];
