import type { ProfileHistoryField } from '@/platform/tauri/bindings';

export type ProfileHistoryChoiceProperty = 'recording' | 'sync';

export type ProfileHistoryFieldInfo = {
    field: ProfileHistoryField;
    /** Translation key under `view.settings.social.profile_history`. */
    key: string;
    /** Part of the Settings ids `social.profile-history.<slug>-recording|sync`. */
    slug: string;
};

export const PROFILE_HISTORY_FIELDS: readonly ProfileHistoryFieldInfo[] = [
    { field: 'status', key: 'status', slug: 'status' },
    { field: 'bio', key: 'bio', slug: 'bio' },
    { field: 'pronouns', key: 'pronouns', slug: 'pronouns' },
    { field: 'displayName', key: 'display_name', slug: 'display-name' },
    { field: 'bioLinks', key: 'bio_links', slug: 'bio-links' },
    {
        field: 'profilePictures',
        key: 'profile_pictures',
        slug: 'profile-pictures'
    },
    {
        field: 'profileDecorations',
        key: 'profile_decorations',
        slug: 'profile-decorations'
    },
    { field: 'badges', key: 'badges', slug: 'badges' },
    { field: 'tags', key: 'tags', slug: 'tags' },
    {
        field: 'ageVerification',
        key: 'age_verification',
        slug: 'age-verification'
    },
    { field: 'avatarCloning', key: 'avatar_cloning', slug: 'avatar-cloning' }
];

export function profileHistorySettingId(
    info: ProfileHistoryFieldInfo,
    property: ProfileHistoryChoiceProperty
): string {
    return `social.profile-history.${info.slug}-${property}`;
}

export function profileHistoryFieldKey(field: ProfileHistoryField): string {
    return (
        PROFILE_HISTORY_FIELDS.find((info) => info.field === field)?.key ??
        field
    );
}
