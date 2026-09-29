// @vitest-environment jsdom

import {
    act,
    cleanup,
    render,
    screen,
    waitFor,
    within
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    previewStableReleaseCheck: vi.fn(),
    getPreviewStableReleaseUpdateMode: vi.fn(),
    appAppUpdateCheckRun: vi.fn(),
    appAppUpdateReleaseGet: vi.fn(),
    appAppUpdateReleasesList: vi.fn(),
    toNormalizedReleaseFromSnapshot: vi.fn(),
    confirmInstall: vi.fn(),
    restartApplication: vi.fn(),
    setStringConfigPreference: vi.fn(),
    toastAdd: vi.fn(),
    updateCheckDisabled: false
}));

vi.mock('react-i18next', () => {
    const t = (key: string, values?: Record<string, unknown>) =>
        values ? `${key}:${JSON.stringify(values)}` : key;
    return { useTranslation: () => ({ t }) };
});

vi.mock('@/services/updateService', () => ({
    getPreviewStableReleaseUpdateMode: mocks.getPreviewStableReleaseUpdateMode,
    confirmInstall: mocks.confirmInstall,
    formatReleaseDisplayVersion: (value: unknown) => String(value || ''),
    toNormalizedReleaseFromSnapshot: mocks.toNormalizedReleaseFromSnapshot
}));

vi.mock('@/shared/buildLabel', () => ({
    getBuildTimeMs: () => null,
    isUpdateCheckDisabledBuild: () => mocks.updateCheckDisabled
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appAppUpdateCheckRun: mocks.appAppUpdateCheckRun,
        appAppUpdateReleaseGet: mocks.appAppUpdateReleaseGet,
        appAppUpdateReleasesList: mocks.appAppUpdateReleasesList
    }
}));

vi.mock('@/services/entityMediaService', () => ({
    openExternalLink: vi.fn()
}));

vi.mock('@/services/shellIntegrationService', () => ({
    restartApplication: mocks.restartApplication
}));

vi.mock('@/services/preferencesService', () => ({
    setStringConfigPreference: mocks.setStringConfigPreference
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd }
}));

vi.mock('@/ui/shadcn/button', async () => {
    const React = await import('react');

    return {
        Button: ({ children, ...props }: React.ComponentProps<'button'>) =>
            React.createElement('button', props, children)
    };
});

vi.mock('@/ui/shadcn/badge', async () => {
    const React = await import('react');

    return {
        Badge: ({ children }: React.PropsWithChildren) =>
            React.createElement('span', null, children)
    };
});

vi.mock('@/ui/shadcn/dialog', async () => {
    const React = await import('react');

    return {
        Dialog: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        DialogContent: ({ children }: React.PropsWithChildren) =>
            React.createElement('section', null, children),
        DialogDescription: ({ children }: React.PropsWithChildren) =>
            React.createElement('p', null, children),
        DialogFooter: ({ children }: React.PropsWithChildren) =>
            React.createElement('footer', null, children),
        DialogHeader: ({ children }: React.PropsWithChildren) =>
            React.createElement('header', null, children),
        DialogTitle: ({ children }: React.PropsWithChildren) =>
            React.createElement('h1', null, children)
    };
});

vi.mock('@/ui/shadcn/alert-dialog', async () => {
    const React = await import('react');
    const Close = React.createContext<() => void>(() => {});
    const el =
        (tag: string) =>
        ({ children }: React.PropsWithChildren) =>
            React.createElement(tag, null, children);

    return {
        AlertDialog: ({
            open,
            onOpenChange,
            children
        }: React.PropsWithChildren<{
            open: boolean;
            onOpenChange: (open: boolean) => void;
        }>) =>
            open
                ? React.createElement(
                      Close.Provider,
                      { value: () => onOpenChange(false) },
                      React.createElement(
                          'div',
                          { role: 'alertdialog' },
                          children
                      )
                  )
                : null,
        AlertDialogContent: el('section'),
        AlertDialogHeader: el('header'),
        AlertDialogFooter: el('footer'),
        AlertDialogTitle: el('h2'),
        AlertDialogDescription: el('p'),
        AlertDialogCancel: ({ children }: React.PropsWithChildren) => {
            const close = React.useContext(Close);
            return React.createElement(
                'button',
                { type: 'button', onClick: close },
                children
            );
        },
        AlertDialogAction: ({
            children,
            onClick
        }: React.PropsWithChildren<{ onClick?: () => void }>) =>
            React.createElement('button', { type: 'button', onClick }, children)
    };
});

vi.mock('@/ui/shadcn/field', async () => {
    const React = await import('react');

    return {
        Field: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        FieldDescription: ({ children }: React.PropsWithChildren) =>
            React.createElement('p', null, children),
        FieldGroup: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        FieldLabel: ({ children }: React.PropsWithChildren) =>
            React.createElement('label', null, children)
    };
});

vi.mock('@/ui/shadcn/select', async () => {
    const React = await import('react');
    const SelectContext = React.createContext<(value: string) => void>(
        () => {}
    );

    return {
        Select: ({
            children,
            onValueChange
        }: React.PropsWithChildren<{
            value: string;
            onValueChange: (value: string) => void;
        }>) =>
            React.createElement(
                SelectContext.Provider,
                { value: onValueChange },
                React.createElement('div', null, children)
            ),
        SelectContent: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        SelectGroup: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        SelectItem: ({
            children,
            value
        }: React.PropsWithChildren<{ value: string }>) => {
            const onValueChange = React.useContext(SelectContext);
            return React.createElement(
                'button',
                { type: 'button', onClick: () => onValueChange(value) },
                children
            );
        },
        SelectTrigger: ({ children }: React.PropsWithChildren) =>
            React.createElement('div', null, children),
        SelectValue: () => null
    };
});

import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { UpdaterDialog } from './UpdaterDialog';

describe('UpdaterDialog', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updateCheckDisabled = false;
        mocks.confirmInstall.mockResolvedValue({});
        mocks.setStringConfigPreference.mockImplementation(
            async (key: string, value: string) => {
                usePreferencesStore
                    .getState()
                    .patchPreferences({ [key]: value });
            }
        );
        usePreferencesStore
            .getState()
            .patchPreferences({ autoUpdateVRCX: 'Auto Install' });
        vi.stubGlobal('VERSION', '2.6.0');
        useRuntimeStore.getState().resetRuntimeState();
        useRuntimeStore.getState().setHostCapabilities({
            ...useRuntimeStore.getState().hostCapabilities,
            platform: 'windows',
            arch: 'x86_64',
            linuxPackageKind: 'unknown'
        });
        mocks.getPreviewStableReleaseUpdateMode.mockReturnValue({
            enabled: false,
            check: mocks.previewStableReleaseCheck
        });
        mocks.appAppUpdateCheckRun.mockResolvedValue({
            hasAvailableUpdate: false,
            checkedAt: '',
            detail: '',
            error: null,
            release: null,
            shouldNotify: false
        });
        mocks.appAppUpdateReleaseGet.mockResolvedValue(null);
        mocks.appAppUpdateReleasesList.mockResolvedValue([]);
        mocks.toNormalizedReleaseFromSnapshot.mockReturnValue(null);
    });

    it('uses the release page action for preview checks even when a Tauri update is installable', async () => {
        mocks.getPreviewStableReleaseUpdateMode.mockReturnValue({
            enabled: true,
            check: mocks.previewStableReleaseCheck
        });
        mocks.toNormalizedReleaseFromSnapshot.mockReturnValue({
            canonicalVersion: '2.7.0',
            displayVersion: '2.7.0',
            updaterType: 'tauri'
        });
        mocks.appAppUpdateCheckRun.mockResolvedValue({
            hasAvailableUpdate: true,
            error: null,
            release: {}
        });

        render(<UpdaterDialog open onOpenChange={vi.fn()} />);

        const updateButton = screen.getByRole<HTMLButtonElement>('button', {
            name: 'nav_menu.update'
        });
        await waitFor(() => {
            expect(updateButton.disabled).toBe(false);
        });
        expect(
            screen.queryByText('dialog.system.action.install_and_restart')
        ).toBeNull();
    });

    it('uses the install action for a stable Tauri update', async () => {
        mocks.toNormalizedReleaseFromSnapshot.mockReturnValue({
            canonicalVersion: '2.7.0',
            displayVersion: '2.7.0',
            updaterType: 'tauri'
        });
        mocks.appAppUpdateCheckRun.mockResolvedValue({
            hasAvailableUpdate: true,
            error: null,
            release: {}
        });

        render(<UpdaterDialog open onOpenChange={vi.fn()} />);

        expect(
            await screen.findByText('dialog.system.action.install_and_restart')
        ).toBeTruthy();
    });

    it('uses the release page action for a stable manual update', async () => {
        mocks.toNormalizedReleaseFromSnapshot.mockReturnValue({
            canonicalVersion: '2.7.0',
            displayVersion: '2.7.0',
            updaterType: 'manual'
        });
        mocks.appAppUpdateCheckRun.mockResolvedValue({
            hasAvailableUpdate: true,
            error: null,
            release: {}
        });

        render(<UpdaterDialog open onOpenChange={vi.fn()} />);

        const updateButton = screen.getByRole('button', {
            name: 'nav_menu.update'
        }) as HTMLButtonElement;
        await waitFor(() => {
            expect(updateButton.disabled).toBe(false);
        });
        expect(
            screen.queryByText('dialog.system.action.install_and_restart')
        ).toBeNull();
    });

    it('shows the checked version as up to date when no newer release exists', async () => {
        mocks.toNormalizedReleaseFromSnapshot.mockReturnValue({
            canonicalVersion: '2.6.0',
            displayVersion: '2.6.0',
            updaterType: 'tauri'
        });
        mocks.appAppUpdateCheckRun.mockResolvedValue({
            hasAvailableUpdate: false,
            error: null,
            release: {}
        });

        render(<UpdaterDialog open onOpenChange={vi.fn()} />);

        expect(
            await screen.findByText('dialog.vrcx_updater.latest_version')
        ).toBeTruthy();
        expect(
            screen.getByText('message.vrcx_updater.current_version')
        ).toBeTruthy();
        expect(screen.getByText('2.6.0')).toBeTruthy();
        expect(screen.queryByText('2.6.0 -> 2.6.0')).toBeNull();
    });

    it('blocks installation during a matching background download and enables it when ready', async () => {
        const release = {
            displayName: 'VRCX-0 2.7.0',
            tagName: 'v2.7.0',
            htmlUrl: 'https://example.test/releases/v2.7.0',
            publishedAt: '2026-07-18T00:00:00Z',
            body: '',
            canonicalVersion: '2.7.0',
            displayVersion: '2.7.0',
            manifestUrl: 'https://example.test/latest.json',
            target: 'windows-x86_64-stable',
            updaterType: 'tauri'
        };
        mocks.toNormalizedReleaseFromSnapshot.mockReturnValue(release);
        mocks.appAppUpdateCheckRun.mockResolvedValue({
            hasAvailableUpdate: true,
            checkedAt: '2026-07-18T00:00:00.000Z',
            detail: 'Update available.',
            error: null,
            release,
            shouldNotify: false
        });
        useRuntimeStore.getState().setUpdateLoopState({
            autoDownloadState: 'downloading',
            downloadedVersion: '2.7.0',
            downloadProgress: 42
        });

        render(<UpdaterDialog open onOpenChange={vi.fn()} />);

        await waitFor(() => {
            expect(screen.getByText('42%')).toBeTruthy();
        });

        const installButton = screen.getByRole<HTMLButtonElement>('button', {
            name: 'dialog.system.action.install_and_restart'
        });
        expect(installButton.disabled).toBe(true);
        act(() => installButton.click());
        expect(mocks.confirmInstall).not.toHaveBeenCalled();

        act(() => {
            useRuntimeStore.getState().setUpdateLoopState({
                downloadedVersion: '2.8.0'
            });
        });
        expect(screen.queryByText('42%')).toBeNull();
        await waitFor(() => expect(installButton.disabled).toBe(false));

        act(() => {
            useRuntimeStore.getState().setUpdateLoopState({
                autoDownloadState: 'downloaded',
                downloadedVersion: '2.7.0',
                downloadProgress: 100
            });
        });
        await waitFor(() => expect(installButton.disabled).toBe(false));
        await act(async () => installButton.click());
        expect(mocks.confirmInstall).toHaveBeenCalledExactlyOnceWith('2.7.0');
    });

    it('shows the disabled build state without running an update check', async () => {
        mocks.updateCheckDisabled = true;

        render(<UpdaterDialog open onOpenChange={vi.fn()} />);

        expect(
            screen.getByText(
                'view.settings.general.application.update_check_disabled_build_description'
            )
        ).toBeTruthy();
        expect(
            screen.getByText(
                'view.settings.general.application.check_for_updates_and_update'
            )
        ).toBeTruthy();
        expect(
            screen.getByText(
                'view.settings.general.application.update_check_disabled'
            )
        ).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
        expect(mocks.appAppUpdateCheckRun).not.toHaveBeenCalled();
    });
});
