// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommunityThemeInstallMetadata } from '@/domain/themes/types';
import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    toastAdd: vi.fn<(options: AppToastOptions) => void>(),
    toastClose: vi.fn<(id: string) => void>(),
    updateInstalledCommunityTheme: vi.fn(),
    t: (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${JSON.stringify(values)}` : key
}));

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: mocks.t })
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd, close: mocks.toastClose }
}));

vi.mock('@/services/communityThemeService', () => ({
    updateInstalledCommunityTheme: mocks.updateInstalledCommunityTheme
}));

import { useCommunityThemeStore } from '@/state/communityThemeStore';

import { CommunityThemeUpdateToastHost } from './CommunityThemeUpdateToastHost';

type ToastActionClickEvent = Parameters<
    NonNullable<NonNullable<AppToastOptions['actionProps']>['onClick']>
>[0];

function installedTheme(themeId: string): CommunityThemeInstallMetadata {
    return {
        themeId,
        themeName: `${themeId} name`,
        version: '1.0.0',
        sourceUrl: '',
        sha256: '',
        installedAt: '',
        updatedAt: '',
        darkMode: true,
        accentMode: false
    };
}

describe('CommunityThemeUpdateToastHost', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useCommunityThemeStore.setState({
            enabled: false,
            installedTheme: null,
            installedThemes: [],
            updates: []
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('offers a one-click update for the active theme only', () => {
        const active = installedTheme('theme-a');
        mocks.updateInstalledCommunityTheme.mockResolvedValue({
            ...active,
            version: '1.1.0'
        });
        useCommunityThemeStore.setState({
            enabled: true,
            installedTheme: active,
            installedThemes: [active, installedTheme('theme-b')],
            updates: [
                {
                    themeId: 'theme-b',
                    installedVersion: '1.0.0',
                    latestVersion: '2.0.0'
                },
                {
                    themeId: 'theme-a',
                    installedVersion: '1.0.0',
                    latestVersion: '1.1.0'
                }
            ]
        });

        render(<CommunityThemeUpdateToastHost />);

        expect(mocks.toastAdd).toHaveBeenCalledOnce();
        const options = mocks.toastAdd.mock.calls[0][0];
        expect(options).toMatchObject({
            id: 'community-theme-update',
            title: 'view.community_themes.toast.update_available:{"name":"theme-a name"}',
            description: '1.0.0 → 1.1.0',
            timeout: 0,
            position: 'bottom-right'
        });
        options.actionProps?.onClick?.(
            new MouseEvent('click') as unknown as ToastActionClickEvent
        );
        expect(
            mocks.updateInstalledCommunityTheme
        ).toHaveBeenCalledExactlyOnceWith('theme-a');
    });

    it('stays quiet when only inactive installed themes have updates', () => {
        const active = installedTheme('theme-a');
        useCommunityThemeStore.setState({
            enabled: true,
            installedTheme: active,
            installedThemes: [active, installedTheme('theme-b')],
            updates: [
                {
                    themeId: 'theme-b',
                    installedVersion: '1.0.0',
                    latestVersion: '2.0.0'
                }
            ]
        });

        render(<CommunityThemeUpdateToastHost />);

        expect(mocks.toastAdd).not.toHaveBeenCalled();
    });
});
