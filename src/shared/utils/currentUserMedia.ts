import type { UserProfileEntity } from '@/domain/entities/user';
import { normalizeVrchatEndpointDomain } from '@/shared/vrchatEndpoint';

export type ProfileMediaField = 'banner' | 'userIcon';

export const PROFILE_MEDIA_URL_FIELD = {
    banner: 'bannerCustomUrl',
    userIcon: 'userIcon'
} as const satisfies Record<ProfileMediaField, keyof UserProfileEntity>;

export function profileMediaFileUrl(endpoint: string, fileId: string): string {
    return fileId
        ? `${normalizeVrchatEndpointDomain(endpoint)}/file/${fileId}/1`
        : '';
}

export type ProfileMediaUpdate =
    | { userIcon: string }
    | { bannerType: 'customImage'; bannerCustomUrl: string }
    | { bannerType: 'avatarBanner' }
    | { bannerType: 'color'; bannerColor: string };

export function profileMediaUpdate(
    field: ProfileMediaField,
    fileUrl: string
): ProfileMediaUpdate {
    if (field === 'userIcon') {
        return { userIcon: fileUrl };
    }
    return fileUrl
        ? { bannerType: 'customImage', bannerCustomUrl: fileUrl }
        : { bannerType: 'avatarBanner' };
}

export function normalizeProfileBannerColor(value: string): string | null {
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
    if (!match) return null;
    const hex = match[1].toLowerCase();
    return `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}`;
}

export function profileBannerColorUpdate(hexColor: string): ProfileMediaUpdate {
    const normalized = normalizeProfileBannerColor(hexColor);
    if (!normalized) throw new Error('Enter a valid RGB hex color.');
    return {
        bannerType: 'color',
        bannerColor: normalized.slice(1)
    };
}

export function isProfileMediaFileUsableWithoutVrcPlus(
    field: ProfileMediaField,
    file: { tags?: string[] }
): boolean {
    return field === 'userIcon' && file.tags?.includes('cameraIcon') === true;
}

export function mergeCurrentUserMediaFields<
    TUser extends Pick<
        UserProfileEntity,
        'iconUrl' | 'bannerUrl' | 'bannerType' | 'bannerColor' | 'iconType'
    >
>(user: TUser, profile: UserProfileEntity) {
    return {
        ...user,
        userIcon: profile.userIcon || '',
        bannerCustomUrl: profile.bannerCustomUrl || '',
        iconUrl: profile.iconUrl ?? user.iconUrl,
        bannerUrl: profile.bannerUrl ?? user.bannerUrl,
        bannerType: profile.bannerType ?? user.bannerType,
        bannerColor: profile.bannerColor ?? user.bannerColor,
        iconType: profile.iconType ?? user.iconType
    };
}
