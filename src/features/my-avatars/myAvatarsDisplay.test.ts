import { describe, expect, it } from 'vitest';

import { TAG_COLORS } from '@/shared/constants/tags';

import {
    getMyAvatarPlatformInfo,
    resolveMyAvatarActionDisabled,
    resolveMyAvatarPerformanceLabel,
    resolveMyAvatarTagBadgeStyle
} from './myAvatarsDisplay';

describe('myAvatarsDisplay', () => {
    it('summarizes avatar platform performance from supported unity packages', () => {
        const platformInfo = getMyAvatarPlatformInfo({
            unityPackages: [
                {
                    platform: 'standalonewindows',
                    performanceRating: 'Excellent'
                },
                {
                    platform: 'android',
                    performanceRating: 'Poor'
                },
                {
                    platform: 'ios',
                    performanceRating: 'Medium'
                }
            ]
        });

        expect(platformInfo.pc.performanceRating).toBe('Excellent');
        expect(platformInfo.android.performanceRating).toBe('Poor');
        expect(platformInfo.ios.performanceRating).toBe('Medium');
    });

    it('shows a dash for missing performance ratings', () => {
        expect(resolveMyAvatarPerformanceLabel('Good')).toBe('Good');
        expect(resolveMyAvatarPerformanceLabel('')).toBe('-');
        expect(resolveMyAvatarPerformanceLabel(null)).toBe('-');
    });

    it('disables avatar actions while updating or when the avatar has no id', () => {
        expect(resolveMyAvatarActionDisabled({ id: 'avtr_1' }, false)).toBe(
            false
        );
        expect(resolveMyAvatarActionDisabled({ id: 'avtr_1' }, true)).toBe(
            true
        );
        expect(resolveMyAvatarActionDisabled({}, false)).toBe(true);
    });

    it('derives badge text from custom colors and gives tags without one a stable non-default palette color', () => {
        const customStyle = resolveMyAvatarTagBadgeStyle({
            tag: 'favorite',
            color: 'rgb(10 20 30 / 0.6)'
        });

        expect(customStyle.backgroundColor).toBe('rgb(10 20 30 / 0.6)');
        expect(customStyle.color).toContain('rgb(10 20 30');
        expect(customStyle.color).not.toContain('/ 0.6');

        const fallbackStyle = resolveMyAvatarTagBadgeStyle({
            tag: 'content_gore'
        });

        expect(resolveMyAvatarTagBadgeStyle({ tag: 'content_gore' })).toEqual(
            fallbackStyle
        );
        expect(
            TAG_COLORS.slice(1).some(
                (color) =>
                    color.bg === fallbackStyle.backgroundColor &&
                    color.text === fallbackStyle.color
            )
        ).toBe(true);
    });
});
