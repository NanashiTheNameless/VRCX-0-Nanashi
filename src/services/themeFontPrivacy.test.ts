// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
    registerLanguageCode,
    unregisterLanguageCode
} from '@/localization/locales';

import { applyAppFontPreferences } from './themeService';

afterEach(() => {
    document.head
        .querySelectorAll(
            'style[data-vrcx-app-font], style[data-vrcx-cjk-font]'
        )
        .forEach((style) => style.remove());
    unregisterLanguageCode('ja');
});

describe('font network requests', () => {
    it('keeps a newly installed CJK translation offline with default font preferences', () => {
        registerLanguageCode('ja');
        const result = applyAppFontPreferences({ locale: 'ja' });
        expect(result.cjkFontPack).toBe('system');
        expect(document.head.innerHTML).not.toContain('https://');
    });

    it('honors an explicitly selected online font and removes its import when switched back', () => {
        applyAppFontPreferences({ fontFamily: 'inter' });
        expect(document.head.innerHTML).toContain('fonts.googleapis.com');
        applyAppFontPreferences();
        expect(document.head.innerHTML).not.toContain('fonts.googleapis.com');
    });
});
