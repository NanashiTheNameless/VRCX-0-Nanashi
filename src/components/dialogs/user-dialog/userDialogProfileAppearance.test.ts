import { describe, expect, it } from 'vitest';

import userProfileRepository from '@/repositories/userProfileRepository';

import {
    applyUserDialogProfileAppearanceOverrides,
    mergeUserDialogProfileAppearance,
    normalizeProfileAppearanceColor,
    preserveUserDialogProfileAppearance,
    resolveProfileDecorationAssetUrls,
    resolveProfileGradientScrimAlpha,
    resolveUserDialogBannerColor,
    resolveUserDialogBannerUrl
} from './userDialogProfileAppearance';

describe('applyUserDialogProfileAppearanceOverrides', () => {
    it('keeps an optimistic decoration over a stale canonical appearance', () => {
        const oldItem = { id: 'invt_old' };
        const newItem = { id: 'inv_new', templateId: 'invt_new' };

        expect(
            applyUserDialogProfileAppearanceOverrides(
                { iconFrame: oldItem },
                {
                    iconFrame: {
                        action: 'equip',
                        item: newItem,
                        templateId: 'invt_new'
                    }
                }
            ).iconFrame
        ).toBe(newItem);
    });

    it('uses the canonical template after it confirms the optimistic item', () => {
        const optimisticItem = { id: 'inv_new', templateId: 'invt_new' };
        const canonicalItem = { id: 'invt_new' };

        expect(
            applyUserDialogProfileAppearanceOverrides(
                { iconFrame: canonicalItem },
                {
                    iconFrame: {
                        action: 'equip',
                        item: optimisticItem,
                        templateId: 'invt_new'
                    }
                }
            ).iconFrame
        ).toBe(canonicalItem);
    });

    it('hides a stale canonical decoration during optimistic unequip', () => {
        expect(
            applyUserDialogProfileAppearanceOverrides(
                { profileEffect: { id: 'invt_old' } },
                { profileEffect: { action: 'unequip' } }
            ).profileEffect
        ).toBeUndefined();
    });
});

describe('mergeUserDialogProfileAppearance', () => {
    it('merges only appearance fields and preserves explicit empty values', () => {
        const user = {
            id: 'usr_target',
            displayName: 'Ordinary user',
            status: 'active',
            location: 'wrld_live:instance',
            iconFrame: 'invt_old'
        };

        expect(
            mergeUserDialogProfileAppearance(
                user,
                {
                    id: 'usr_target',
                    displayName: 'Profile endpoint name',
                    status: 'offline',
                    location: 'offline',
                    iconFrame: '',
                    profileEffect: 'invt_profile',
                    bannerColor: '2cc968'
                },
                'usr_target'
            )
        ).toEqual({
            ...user,
            iconFrame: '',
            profileEffect: 'invt_profile',
            bannerColor: '2cc968'
        });
    });

    it('does not clear fields omitted by the profile endpoint', () => {
        const user = {
            id: 'usr_target',
            iconFrame: 'invt_frame',
            profileEffect: 'invt_profile'
        };

        expect(
            mergeUserDialogProfileAppearance(
                user,
                {
                    id: 'usr_target',
                    iconFrame: ''
                },
                'usr_target'
            )
        ).toEqual({
            id: 'usr_target',
            iconFrame: '',
            profileEffect: 'invt_profile'
        });
    });

    it('merges profile-owned text fields that the user endpoint no longer returns', () => {
        const user = {
            id: 'usr_target',
            displayName: 'Ordinary user',
            tags: ['system_trust_basic']
        };
        const badges = [{ badgeId: 'bdg_1', badgeName: 'Supporter' }];

        expect(
            mergeUserDialogProfileAppearance(
                user,
                {
                    id: 'usr_target',
                    ageVerificationStatus: '18+',
                    ageVerified: true,
                    bio: 'hello',
                    bioLinks: ['https://example.test'],
                    pronouns: 'they/them',
                    badges,
                    userIcon: 'https://example.test/custom-icon.png',
                    iconUrl:
                        'https://api.vrchat.cloud/api/1/image/file_icon/1/256',
                    trustTags: ['system_trust_veteran']
                },
                'usr_target'
            )
        ).toEqual({
            ...user,
            ageVerificationStatus: '18+',
            ageVerified: true,
            bio: 'hello',
            bioLinks: ['https://example.test'],
            pronouns: 'they/them',
            badges,
            userIcon: 'https://example.test/custom-icon.png',
            iconUrl: 'https://api.vrchat.cloud/api/1/image/file_icon/1/256'
        });
    });

    it('ignores a profile response for another target', () => {
        const user = {
            id: 'usr_target',
            iconFrame: 'invt_frame'
        };

        expect(
            mergeUserDialogProfileAppearance(
                user,
                {
                    id: 'usr_other',
                    iconFrame: 'invt_other'
                },
                'usr_target'
            )
        ).toBe(user);
    });
});

describe('preserveUserDialogProfileAppearance', () => {
    it('keeps profile fields after normalizing a partial user response', () => {
        const previous = {
            id: 'usr_target',
            bio: 'Existing bio',
            bioLinks: ['https://example.test'],
            pronouns: 'they/them',
            badges: [{ badgeId: 'bdg_target' }],
            iconUrl: 'https://example.test/icon.png'
        };
        const user = userProfileRepository.normalize({
            id: 'usr_target',
            status: 'busy'
        });

        expect(
            preserveUserDialogProfileAppearance(user, previous)
        ).toMatchObject({
            ...previous,
            status: 'busy'
        });
        expect(
            preserveUserDialogProfileAppearance(
                userProfileRepository.normalize({
                    ...previous,
                    bio: '',
                    bioLinks: [],
                    pronouns: '',
                    badges: [],
                    iconUrl: ''
                }),
                previous
            )
        ).toMatchObject({
            bio: '',
            bioLinks: [],
            pronouns: '',
            badges: [],
            iconUrl: ''
        });
    });

    it('keeps profile-only background fields after an ordinary user update', () => {
        expect(
            preserveUserDialogProfileAppearance(
                {
                    id: 'usr_target',
                    displayName: 'Updated user',
                    bio: 'Updated bio'
                },
                {
                    id: 'usr_target',
                    displayName: 'Target',
                    backgroundType: 'texture',
                    backgroundTextureId: 'grid',
                    bannerType: 'customImage',
                    bannerCustomUrl: 'https://example.test/banner.png'
                }
            )
        ).toEqual({
            id: 'usr_target',
            displayName: 'Updated user',
            bio: 'Updated bio',
            backgroundType: 'texture',
            backgroundTextureId: 'grid',
            bannerType: 'customImage',
            bannerCustomUrl: 'https://example.test/banner.png'
        });
    });

    it('keeps explicit appearance values from the update response', () => {
        expect(
            preserveUserDialogProfileAppearance(
                {
                    id: 'usr_target',
                    iconUrl: ''
                },
                {
                    id: 'usr_target',
                    iconUrl: 'https://example.test/old-icon.png',
                    profileEffect: 'invt_profile'
                }
            )
        ).toEqual({
            id: 'usr_target',
            iconUrl: '',
            profileEffect: 'invt_profile'
        });
    });
});

describe('profile appearance assets', () => {
    const item = {
        id: 'invt_profile',
        metadata: {
            assets: [
                {
                    type: 'introAnimation',
                    url: 'https://example.test/intro.webp'
                },
                {
                    type: 'base',
                    url: 'https://example.test/base.webp'
                },
                {
                    type: 'mainAnimation',
                    url: 'https://example.test/main.webp'
                }
            ]
        }
    };

    it('uses the looping animation normally and the base asset for reduced motion', () => {
        expect(resolveProfileDecorationAssetUrls(item)).toEqual({
            animatedUrl: 'https://example.test/main.webp',
            staticUrl: 'https://example.test/base.webp'
        });
    });

    it('does not use intro animations or inventory thumbnails as a persistent effect', () => {
        expect(
            resolveProfileDecorationAssetUrls({
                id: 'invt_intro_only',
                imageUrl: 'https://example.test/thumbnail.png',
                metadata: {
                    assets: [
                        {
                            type: 'introAnimation',
                            url: 'https://example.test/intro.webp'
                        }
                    ]
                }
            })
        ).toEqual({
            animatedUrl: '',
            staticUrl: ''
        });
    });

    it('accepts six-digit colors without inventing styles from ids', () => {
        expect(normalizeProfileAppearanceColor('2CC968')).toBe('#2cc968');
        expect(normalizeProfileAppearanceColor('theme_default')).toBe('');
        expect(normalizeProfileAppearanceColor('')).toBe('');
    });

    it('ignores retained image urls for color banners', () => {
        expect(
            resolveUserDialogBannerUrl({
                bannerType: 'color',
                bannerUrl: 'https://example.test/old-banner.png',
                bannerCustomUrl: 'https://example.test/old-custom.png'
            })
        ).toBe('');
    });

    it('shows the avatar image for avatar banners instead of a retained custom image', () => {
        expect(
            resolveUserDialogBannerUrl({
                bannerType: 'avatarBanner',
                bannerCustomUrl: 'https://example.test/old-custom.png',
                currentAvatarImageUrl: 'https://example.test/avatar.png'
            })
        ).toBe('https://example.test/avatar.png');
    });

    it('paints color banners from the stored hex color', () => {
        expect(
            resolveUserDialogBannerColor({
                bannerType: 'color',
                bannerColor: 'a9d96a'
            })
        ).toBe('#a9d96a');
        expect(
            resolveUserDialogBannerColor({
                bannerType: 'avatarBanner',
                bannerColor: 'a9d96a'
            })
        ).toBe('');
    });

    it('prefers the resolved banner url for image banners', () => {
        expect(
            resolveUserDialogBannerUrl({
                bannerType: 'customImage',
                bannerUrl: 'https://example.test/banner.png',
                bannerCustomUrl: 'https://example.test/custom.png'
            })
        ).toBe('https://example.test/banner.png');
    });

    it('returns no profile banner when image urls are empty', () => {
        expect(
            resolveUserDialogBannerUrl({
                bannerType: 'customImage',
                bannerUrl: '',
                bannerCustomUrl: ''
            })
        ).toBe('');
    });
});

describe('profile gradient contrast', () => {
    it('weights channels by sRGB luminance instead of averaging them', () => {
        expect(
            resolveProfileGradientScrimAlpha('#00ff00', '#0000ff', true)
        ).toBeCloseTo(0.5075, 3);
    });

    it('leaves dark gradients untouched on a dark theme', () => {
        expect(
            resolveProfileGradientScrimAlpha('#101020', '#2b1b4d', true)
        ).toBe(0);
    });

    it('scrims bright gradients on a dark theme', () => {
        expect(
            resolveProfileGradientScrimAlpha('#ffffff', '#fffbe6', true)
        ).toBeCloseTo(0.55, 5);
    });

    it('scrims a mixed gradient using its worst stop', () => {
        expect(
            resolveProfileGradientScrimAlpha('#0b0b12', '#ffffff', true)
        ).toBeCloseTo(0.55, 5);
    });

    it('flips which end is risky when the theme is light', () => {
        expect(
            resolveProfileGradientScrimAlpha('#ffffff', '#fffbe6', false)
        ).toBe(0);
        expect(
            resolveProfileGradientScrimAlpha('#000000', '#101020', false)
        ).toBeCloseTo(0.55, 5);
    });

    it('ignores stops that failed colour normalization', () => {
        expect(
            resolveProfileGradientScrimAlpha('', '#ffffff', true)
        ).toBeCloseTo(0.55, 5);
        expect(resolveProfileGradientScrimAlpha('', '', true)).toBe(0);
    });
});
