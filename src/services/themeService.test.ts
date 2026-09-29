import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setWindowTheme: vi.fn()
}));

vi.mock(import('@/platform/tauri/webview'), async (importOriginal) => ({
    ...(await importOriginal()),
    setWindowTheme: mocks.setWindowTheme
}));

import { useShellStore } from '@/state/shellStore';

import {
    isAppFontAvailableLocally,
    isFontFamilyInstalled,
    setInstalledFontFamilies
} from './themeService';
import {
    applyThemeMode,
    resolveAppCjkFontPackForLocale,
    supportsConfigurableCjkFontPack
} from './themeService';

function stubThemeEnvironment(prefersDark: () => boolean) {
    const toggleDarkClass = vi.fn();
    const setRootAttribute = vi.fn();

    vi.stubGlobal('window', {
        matchMedia: vi.fn(() => ({
            get matches() {
                return prefersDark();
            }
        }))
    });
    vi.stubGlobal('document', {
        documentElement: {
            classList: {
                toggle: toggleDarkClass
            },
            hasAttribute: vi.fn(() => false),
            setAttribute: setRootAttribute
        }
    });

    return { toggleDarkClass, setRootAttribute };
}

describe('themeService theme mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useShellStore.setState({ themeMode: 'system' });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resolves system mode from the OS preference without touching the native theme', async () => {
        const { toggleDarkClass, setRootAttribute } = stubThemeEnvironment(
            () => true
        );
        useShellStore.setState({ themeMode: 'light' });

        await applyThemeMode('system');

        expect(mocks.setWindowTheme).not.toHaveBeenCalled();
        expect(toggleDarkClass).toHaveBeenCalledWith('dark', true);
        expect(setRootAttribute).toHaveBeenCalledWith('data-theme', 'dark');
        expect(useShellStore.getState().themeMode).toBe('system');
    });

    it('applies explicit themes without touching the native theme', async () => {
        const { toggleDarkClass } = stubThemeEnvironment(() => false);
        useShellStore.setState({ themeMode: 'light' });

        await applyThemeMode('dark');

        expect(mocks.setWindowTheme).not.toHaveBeenCalled();
        expect(useShellStore.getState().themeMode).toBe('dark');
        expect(toggleDarkClass).toHaveBeenLastCalledWith('dark', true);
    });
});

describe('themeService CJK font locale routing', () => {
    it('uses the system CJK font for non-core CJK app locales', () => {
        expect(supportsConfigurableCjkFontPack('en')).toBe(false);
        expect(supportsConfigurableCjkFontPack('fr')).toBe(false);
        expect(supportsConfigurableCjkFontPack('de')).toBe(false);
        expect(resolveAppCjkFontPackForLocale('noto', 'en')).toBe('system');
        expect(resolveAppCjkFontPackForLocale('puhuiti', 'fr')).toBe('system');
    });
});

describe('themeService local-first fonts', () => {
    afterEach(() => {
        setInstalledFontFamilies([]);
    });

    it('treats bundled fonts as local and online fonts as local only when installed', () => {
        expect(isAppFontAvailableLocally('oxproto')).toBe(true);
        expect(isAppFontAvailableLocally('inter')).toBe(false);
        setInstalledFontFamilies(['Inter', 'Noto Sans JP']);
        expect(isAppFontAvailableLocally('inter')).toBe(true);
        expect(isFontFamilyInstalled("'Inter Variable', 'Inter'")).toBe(true);
        expect(isFontFamilyInstalled(["'Noto Sans JP'"])).toBe(true);
        expect(isFontFamilyInstalled("'Nunito Sans'")).toBe(false);
        expect(isAppFontAvailableLocally('unknown-font')).toBe(false);
    });
});
