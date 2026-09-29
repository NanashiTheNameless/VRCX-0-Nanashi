// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppToastOptions } from '@/services/toastService';

const mocks = vi.hoisted(() => ({
    toastAdd: vi.fn<(options: AppToastOptions) => void>(),
    toastClose: vi.fn<(id: string) => void>(),
    openOrInstall: vi.fn<(options: { toastId: string }) => Promise<void>>(),
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

vi.mock('@/services/updateInstallService', async (importOriginal) => ({
    ...(await importOriginal<
        typeof import('@/services/updateInstallService')
    >()),
    openOrInstallLatestAvailableUpdate: mocks.openOrInstall
}));

import { useRuntimeStore } from '@/state/runtimeStore';

import { UpdateAvailableToastHost } from './UpdateAvailableToastHost';

type UpdateLoopRelease = NonNullable<
    ReturnType<
        typeof useRuntimeStore.getState
    >['updateLoop']['latestUpdaterRelease']
>;

function updateRelease(
    overrides: Partial<UpdateLoopRelease> = {}
): UpdateLoopRelease {
    return {
        displayName: 'VRCX-0 2.7.0',
        tagName: 'v2.7.0',
        htmlUrl:
            'https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/v2.7.0',
        publishedAt: '2026-08-20T00:00:00.000Z',
        body: '',
        canonicalVersion: '2.7.0',
        displayVersion: '2.7.0',
        channel: 'stable',
        manifestUrl: '',
        target: '',
        updaterType: 'manual',
        currentVersion: '2.6.0',
        latestVersion: 'v2.7.0',
        title: 'VRCX-0 2.7.0',
        ...overrides
    };
}

type ToastActionClickEvent = Parameters<
    NonNullable<NonNullable<AppToastOptions['actionProps']>['onClick']>
>[0];

function lastToast(): AppToastOptions {
    const call = mocks.toastAdd.mock.calls.at(-1);
    if (!call) {
        throw new Error('No toast was shown');
    }
    return call[0];
}

describe('UpdateAvailableToastHost', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.openOrInstall.mockResolvedValue(undefined);
        useRuntimeStore.getState().resetRuntimeState();
    });

    afterEach(() => {
        cleanup();
        useRuntimeStore.getState().resetRuntimeState();
    });

    it('shows the available update version without its v prefix and opens the update from the action', () => {
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: true,
            latestUpdaterRelease: updateRelease()
        });

        render(<UpdateAvailableToastHost />);

        const options = lastToast();
        expect(options).toMatchObject({
            type: 'info',
            title: 'service.background_maintenance.label.vrcx_update_available',
            id: 'vrcx-update-available',
            description: '2.7.0',
            timeout: 0,
            position: 'bottom-right'
        });
        options.actionProps?.onClick?.(
            new MouseEvent('click') as unknown as ToastActionClickEvent
        );
        expect(mocks.openOrInstall).toHaveBeenCalledExactlyOnceWith({
            toastId: 'vrcx-update-available'
        });
    });

    it('shows the ready toast once the latest Tauri update has been downloaded', () => {
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: true,
            autoDownloadUiVisible: true,
            latestUpdaterRelease: updateRelease({ updaterType: 'tauri' }),
            autoDownloadState: 'downloaded',
            downloadedVersion: '2.7.0'
        });

        render(<UpdateAvailableToastHost />);

        expect(mocks.toastAdd).toHaveBeenCalledOnce();
        expect(lastToast()).toMatchObject({
            type: 'success',
            title: 'dialog.vrcx_updater.ready_for_update:{"value":"2.7.0"}',
            id: 'vrcx-update-available',
            description: undefined
        });
    });

    it('keeps the available toast when the downloaded version is not the latest release', () => {
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: true,
            autoDownloadUiVisible: true,
            latestUpdaterRelease: updateRelease({ updaterType: 'tauri' }),
            autoDownloadState: 'downloaded',
            downloadedVersion: '2.6.5'
        });

        render(<UpdateAvailableToastHost />);

        expect(lastToast()).toMatchObject({
            type: 'info',
            description: '2.7.0'
        });
    });

    it('replaces the available toast with the ready toast when the download finishes', () => {
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: true,
            autoDownloadUiVisible: true,
            latestUpdaterRelease: updateRelease({ updaterType: 'tauri' }),
            autoDownloadState: 'downloading',
            downloadedVersion: '2.7.0'
        });

        render(<UpdateAvailableToastHost />);
        expect(lastToast()).toMatchObject({ type: 'info' });

        act(() => {
            useRuntimeStore
                .getState()
                .setUpdateLoopState({ autoDownloadState: 'downloaded' });
        });

        expect(lastToast()).toMatchObject({
            type: 'success',
            id: 'vrcx-update-available'
        });
    });

    it('closes the update toast while the Tauri download UI is hidden and when the update disappears', () => {
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: true,
            autoDownloadUiVisible: false,
            latestUpdaterRelease: updateRelease({ updaterType: 'tauri' })
        });

        render(<UpdateAvailableToastHost />);
        expect(mocks.toastAdd).not.toHaveBeenCalled();
        expect(mocks.toastClose).toHaveBeenCalledWith('vrcx-update-available');

        act(() => {
            useRuntimeStore
                .getState()
                .setUpdateLoopState({ autoDownloadUiVisible: true });
        });
        expect(mocks.toastAdd).toHaveBeenCalledOnce();

        mocks.toastClose.mockClear();
        act(() => {
            useRuntimeStore
                .getState()
                .setUpdateLoopState({ hasAvailableUpdate: false });
        });
        expect(mocks.toastClose).toHaveBeenCalledExactlyOnceWith(
            'vrcx-update-available'
        );
        expect(mocks.toastAdd).toHaveBeenCalledOnce();
    });
});
