// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    clearCommunityThemeOverrideCss: vi.fn(),
    deleteInstalledCommunityTheme: vi.fn(),
    confirm: vi.fn()
}));

vi.mock('@/services/communityThemeService', () => ({
    clearCommunityThemeOverrideCss: mocks.clearCommunityThemeOverrideCss,
    deleteInstalledCommunityTheme: mocks.deleteInstalledCommunityTheme,
    disableCommunityThemeOverrideCss: vi.fn(),
    disableInstalledCommunityTheme: vi.fn(),
    enableInstalledCommunityTheme: vi.fn(),
    getCommunityThemeOverrideCssSnapshot: () => 'body { color: red; }',
    installCommunityTheme: vi.fn(),
    loadCatalog: () => Promise.resolve(),
    loadCommunityThemeStats: () => Promise.resolve({}),
    loadLocalCommunityThemePreview: vi.fn(),
    reportCommunityThemeInstall: vi.fn(),
    saveCommunityThemeOverrideCss: vi.fn(),
    startLocalCommunityThemePreviewWatch: vi.fn(),
    stopLocalCommunityThemePreview: vi.fn(),
    stopLocalCommunityThemePreviewWatch: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn() }
}));

vi.mock('./useThemesRuntimeState', () => ({
    useThemesRuntimeState: () => ({
        themeMode: 'dark',
        themeColor: 'default',
        backgroundImageEnabled: false,
        backgroundImageMode: 'off',
        backgroundImageCustomSource: null,
        catalog: [],
        enabled: false,
        installedTheme: null,
        installedThemes: [],
        localPreview: null,
        localPreviewWatch: { enabled: false, folderPath: '', error: '' },
        overrideCssLength: 20,
        loading: false,
        error: ''
    })
}));

import { useModalStore } from '@/state/modalStore';

import { useThemesController } from './useThemesController';

describe('useThemesController destructive actions', () => {
    beforeEach(() => {
        mocks.clearCommunityThemeOverrideCss.mockResolvedValue(undefined);
        mocks.deleteInstalledCommunityTheme.mockResolvedValue(undefined);
        useModalStore.setState({ confirm: mocks.confirm });
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('keeps the theme and custom CSS when confirmation is cancelled', async () => {
        mocks.confirm.mockResolvedValue({ ok: false });
        const { result } = renderHook(() => useThemesController());

        await act(async () => {
            await result.current.deleteTheme('theme-a');
            await result.current.clearOverride();
        });

        expect(mocks.confirm).toHaveBeenCalledTimes(2);
        expect(mocks.deleteInstalledCommunityTheme).not.toHaveBeenCalled();
        expect(mocks.clearCommunityThemeOverrideCss).not.toHaveBeenCalled();
        expect(result.current.overrideDraft).toBe('body { color: red; }');
    });

    it('deletes the theme and clears custom CSS after confirmation', async () => {
        mocks.confirm.mockResolvedValue({ ok: true });
        const { result } = renderHook(() => useThemesController());

        await act(async () => {
            await result.current.deleteTheme('theme-a');
            await result.current.clearOverride();
        });

        expect(mocks.deleteInstalledCommunityTheme).toHaveBeenCalledWith(
            'theme-a'
        );
        expect(mocks.clearCommunityThemeOverrideCss).toHaveBeenCalled();
        expect(result.current.overrideDraft).toBe('');
    });
});
