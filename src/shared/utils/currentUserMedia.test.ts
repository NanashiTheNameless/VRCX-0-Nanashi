import { describe, expect, test } from 'vitest';

import {
    isProfileMediaFileUsableWithoutVrcPlus,
    profileBannerColorUpdate
} from './currentUserMedia';

describe('profileBannerColorUpdate', () => {
    test('sends the color without the hash prefix', () => {
        expect(profileBannerColorUpdate('#89A454')).toEqual({
            bannerType: 'color',
            bannerColor: '89a454'
        });
    });
});

describe('isProfileMediaFileUsableWithoutVrcPlus', () => {
    test('keeps only in-game camera icons usable without VRC+', () => {
        expect(
            isProfileMediaFileUsableWithoutVrcPlus('userIcon', {
                tags: ['cameraIcon', 'icon']
            })
        ).toBe(true);
        expect(
            isProfileMediaFileUsableWithoutVrcPlus('userIcon', {
                tags: ['icon', 'customIcon']
            })
        ).toBe(false);
        expect(
            isProfileMediaFileUsableWithoutVrcPlus('banner', {
                tags: ['gallery']
            })
        ).toBe(false);
    });
});
