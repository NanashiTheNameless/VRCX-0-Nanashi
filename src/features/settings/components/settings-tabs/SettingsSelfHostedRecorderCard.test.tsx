// @vitest-environment jsdom

import {
    act,
    cleanup,
    fireEvent,
    render,
    screen
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedLoggerProbe } from '@/platform/tauri/bindings';
import { handleFeedLoggerHealthEvent } from '@/services/offlineRecordService';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { connectedRecorder } from '@/test/offlineRecordFixtures';

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));

import { SettingsSelfHostedRecorderCard } from './SettingsSelfHostedRecorderCard';

function recorderReports(probe: FeedLoggerProbe) {
    act(() => handleFeedLoggerHealthEvent(probe));
}

function dialogOpen() {
    return useRuntimeStore.getState().systemHosts.offlineRecordOpen;
}

beforeEach(() => {
    useOfflineRecordStore.setState({
        health: null,
        syncProgress: null,
        backfillRevision: 0
    });
    useRuntimeStore.setState((state) => ({
        auth: { ...state.auth, currentUserId: 'usr_self' },
        systemHosts: { ...state.systemHosts, offlineRecordOpen: false }
    }));
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Sync Options card for the self-hosted recorder', () => {
    it('offers setup and opens the recorder dialog when nothing is connected', () => {
        render(<SettingsSelfHostedRecorderCard historySyncEnabled={false} />);
        recorderReports({ state: 'notConfigured' });

        expect(
            screen.getByText('view.settings.history_sync.recorder_not_set_up')
        ).toBeTruthy();
        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.settings.history_sync.recorder_set_up'
            })
        );

        expect(dialogOpen()).toBe(true);
    });

    it('refuses setup while history sync is on', () => {
        render(<SettingsSelfHostedRecorderCard historySyncEnabled />);

        const button = screen.getByRole('button', {
            name: 'view.settings.history_sync.recorder_set_up'
        });
        expect(button.hasAttribute('disabled')).toBe(true);
        expect(
            screen.getByText('view.settings.history_sync.recorder_blocked')
        ).toBeTruthy();
        fireEvent.click(button);

        expect(dialogOpen()).toBe(false);
    });

    it('shows how many entries wait to be filled in while recording', () => {
        render(<SettingsSelfHostedRecorderCard historySyncEnabled={false} />);
        recorderReports(connectedRecorder({ unsyncedFrames: 42 }));

        expect(screen.getByText('offline_record.status_unsynced')).toBeTruthy();
        expect(
            screen.getByRole('button', {
                name: 'view.settings.history_sync.recorder_manage'
            })
        ).toBeTruthy();
    });

    it('shows the problem when the recorder is unreachable', () => {
        render(<SettingsSelfHostedRecorderCard historySyncEnabled={false} />);
        recorderReports({ state: 'unreachable', message: 'timeout' });

        expect(
            screen.getByText('offline_record.health.unreachable')
        ).toBeTruthy();
    });

    it('keeps a connected recorder manageable even if history sync reads as on', () => {
        render(<SettingsSelfHostedRecorderCard historySyncEnabled />);
        recorderReports(connectedRecorder({ unsyncedFrames: 0 }));

        fireEvent.click(
            screen.getByRole('button', {
                name: 'view.settings.history_sync.recorder_manage'
            })
        );

        expect(dialogOpen()).toBe(true);
    });
});
