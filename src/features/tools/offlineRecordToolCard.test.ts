// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands, type FeedLoggerProbe } from '@/platform/tauri/bindings';
import { handleFeedLoggerHealthEvent } from '@/services/offlineRecordService';
import { useModalStore } from '@/state/modalStore';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { connectedRecorder } from '@/test/offlineRecordFixtures';

const mocks = vi.hoisted(() => ({
    confirm: vi.fn(),
    getProfileBackupSettings: vi.fn(),
    setProfileBackupSettings: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('@/repositories/configRepository', () => ({
    default: {
        applyServerEntry: vi.fn(),
        getString: vi.fn().mockResolvedValue('Off')
    }
}));

vi.mock('@/services/appLauncherSnapshotService', () => ({
    getCurrentAppLauncherSnapshot: vi.fn().mockResolvedValue(null),
    setAppLauncherEntryEnabled: vi.fn()
}));

vi.mock('@/services/profileBackupService', () => ({
    getProfileBackupSettings: mocks.getProfileBackupSettings,
    setProfileBackupSettings: mocks.setProfileBackupSettings
}));

import { useToolStatusSummaries } from './useToolStatusSummaries';

function recorderReports(probe: FeedLoggerProbe) {
    act(() => handleFeedLoggerHealthEvent(probe));
}

function recorderCard(result: {
    current: ReturnType<typeof useToolStatusSummaries>;
}) {
    return result.current.get('offline-record');
}

beforeEach(() => {
    useOfflineRecordStore.setState({
        health: null,
        syncProgress: null,
        backfillRevision: 0
    });
    useRuntimeStore.setState((state) => ({
        auth: { ...state.auth, currentUserId: 'usr_self' }
    }));
    useModalStore.setState({ confirm: mocks.confirm });
    vi.mocked(commands.appPresenceAutomationRulesGet).mockResolvedValue([]);
    vi.mocked(commands.appLlmEndpointList).mockResolvedValue([]);
    mocks.getProfileBackupSettings.mockResolvedValue({
        autoEnabled: true,
        autoIntervalDays: 7,
        autoRetainExtra: 2,
        autoTargetDir: 'D:/Backups',
        lastAutoAt: null
    });
    mocks.setProfileBackupSettings.mockImplementation((settings) =>
        Promise.resolve(settings)
    );
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Tools card for the self-hosted recorder', () => {
    it('shows nothing until a recorder is set up', () => {
        const { result } = renderHook(() => useToolStatusSummaries());

        recorderReports({ state: 'notConfigured' });

        expect(recorderCard(result)).toBeUndefined();
    });

    it('shows "recording · N to fill in" while recording with entries waiting', () => {
        const { result } = renderHook(() => useToolStatusSummaries());

        recorderReports(connectedRecorder({ unsyncedFrames: 42 }));

        expect(recorderCard(result)).toEqual({
            label: 'offline_record.status_unsynced',
            tone: 'active'
        });
    });

    it('shows plain "recording" once nothing is waiting to be filled in', () => {
        const { result } = renderHook(() => useToolStatusSummaries());

        recorderReports(connectedRecorder({ unsyncedFrames: 0 }));

        expect(recorderCard(result)).toEqual({
            label: 'offline_record.health.recording',
            tone: 'active'
        });
    });

    it.each([
        {
            problem: 'unreachable',
            probe: { state: 'unreachable', message: 'timeout' },
            message: 'offline_record.health.unreachable'
        },
        {
            problem: 'reconnecting',
            probe: connectedRecorder({
                session: { state: 'reconnecting' },
                unsyncedFrames: 42
            }),
            message: 'offline_record.health.reconnecting'
        },
        {
            problem: 'logged into another account',
            probe: connectedRecorder({ accountId: 'usr_other' }),
            message: 'offline_record.health.account_mismatch'
        },
        {
            problem: 'waiting for a two-factor code',
            probe: connectedRecorder({
                session: { state: 'awaitingTwoFactor', methods: ['totp'] }
            }),
            message: 'offline_record.health.two_factor'
        }
    ] satisfies { problem: string; probe: FeedLoggerProbe; message: string }[])(
        'shows the problem in warning colour when the recorder is $problem',
        ({ probe, message }) => {
            const { result } = renderHook(() => useToolStatusSummaries());

            recorderReports(probe);

            expect(recorderCard(result)).toEqual({
                label: message,
                tone: 'warning'
            });
        }
    );
});

describe('turning automatic backups off from the Tools card', () => {
    async function backupToggle() {
        const { result } = renderHook(() => useToolStatusSummaries());
        await waitFor(() =>
            expect(result.current.get('profile-backup')?.toggle).toBeDefined()
        );
        return result.current.get('profile-backup')!.toggle!;
    }

    beforeEach(() => {
        vi.mocked(commands.appFeedLoggerSettingsGet).mockResolvedValue({
            address: 'http://127.0.0.1:8787',
            savedCredentialsAvailable: false
        });
        vi.mocked(commands.appFeedLoggerSync).mockResolvedValue({
            result: 'notConfigured'
        });
        vi.mocked(commands.appFeedLoggerUnpair).mockResolvedValue(null);
        vi.mocked(commands.appFeedLoggerSettingsClear).mockResolvedValue(null);
    });

    it('keeps backups and the recorder when the user cancels', async () => {
        mocks.confirm.mockResolvedValue({ ok: false });
        const toggle = await backupToggle();

        await toggle.setEnabled(false);

        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(mocks.setProfileBackupSettings).not.toHaveBeenCalled();
        expect(commands.appFeedLoggerSettingsClear).not.toHaveBeenCalled();
    });

    it('disconnects the recorder before backups turn off when the user confirms', async () => {
        mocks.confirm.mockResolvedValue({ ok: true });
        const toggle = await backupToggle();

        await toggle.setEnabled(false);

        expect(mocks.setProfileBackupSettings).toHaveBeenCalledWith(
            expect.objectContaining({ autoEnabled: false })
        );
        expect(
            vi.mocked(commands.appFeedLoggerSettingsClear).mock
                .invocationCallOrder[0]
        ).toBeLessThan(
            mocks.setProfileBackupSettings.mock.invocationCallOrder[0]
        );
    });

    it('keeps backups on when the recorder settings cannot be read', async () => {
        vi.mocked(commands.appFeedLoggerSettingsGet).mockRejectedValue(
            new Error('database is locked')
        );
        const toggle = await backupToggle();

        await toggle.setEnabled(false);

        expect(mocks.confirm).not.toHaveBeenCalled();
        expect(mocks.setProfileBackupSettings).not.toHaveBeenCalled();
    });

    it('keeps backups on when the recorder settings cannot be removed', async () => {
        mocks.confirm.mockResolvedValue({ ok: true });
        vi.mocked(commands.appFeedLoggerSettingsClear).mockRejectedValue(
            new Error('database is locked')
        );
        const toggle = await backupToggle();

        await toggle.setEnabled(false);

        expect(commands.appFeedLoggerUnpair).toHaveBeenCalledTimes(1);
        expect(mocks.setProfileBackupSettings).not.toHaveBeenCalled();
    });

    it('keeps backups and the recorder when filling in fails and the user does not continue', async () => {
        vi.mocked(commands.appFeedLoggerSync).mockRejectedValue(
            new Error('unreachable')
        );
        mocks.confirm
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false });
        const toggle = await backupToggle();

        await toggle.setEnabled(false);

        expect(mocks.confirm).toHaveBeenLastCalledWith(
            expect.objectContaining({
                title: "Couldn't fill in from the recorder"
            })
        );
        expect(commands.appFeedLoggerUnpair).not.toHaveBeenCalled();
        expect(commands.appFeedLoggerSettingsClear).not.toHaveBeenCalled();
        expect(mocks.setProfileBackupSettings).not.toHaveBeenCalled();
    });

    it('turns everything off when the user continues after the recorder fails to log out', async () => {
        vi.mocked(commands.appFeedLoggerUnpair).mockRejectedValue(
            new Error('unreachable')
        );
        mocks.confirm.mockResolvedValue({ ok: true });
        const toggle = await backupToggle();

        await toggle.setEnabled(false);

        expect(mocks.confirm).toHaveBeenLastCalledWith(
            expect.objectContaining({
                title: "Couldn't log the recorder out"
            })
        );
        expect(commands.appFeedLoggerSettingsClear).toHaveBeenCalledTimes(1);
        expect(mocks.setProfileBackupSettings).toHaveBeenCalledWith(
            expect.objectContaining({ autoEnabled: false })
        );
    });

    it('ignores a second switch-off while the first one is still asking', async () => {
        let answer: (value: { ok: boolean }) => void = () => {};
        mocks.confirm.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        const toggle = await backupToggle();

        const first = toggle.setEnabled(false);
        await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
        await toggle.setEnabled(false);
        answer({ ok: false });
        await first;

        expect(mocks.confirm).toHaveBeenCalledTimes(1);
        expect(mocks.setProfileBackupSettings).not.toHaveBeenCalled();
    });
});
