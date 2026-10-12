// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commands } from '@/platform/tauri/bindings';
import { useModalStore } from '@/state/modalStore';
import { useProfileBackupStore } from '@/state/profileBackupStore';

const mocks = vi.hoisted(() => ({
    confirm: vi.fn(),
    getProfileBackupSettings: vi.fn(),
    setProfileBackupSettings: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('@/services/i18nService', () => ({
    default: { t: (key: string) => key }
}));

vi.mock('@/services/profileBackupService', () => ({
    discardPendingProfileBackup: vi.fn(),
    dismissProfileBackupError: vi.fn(),
    getProfileBackupSettings: mocks.getProfileBackupSettings,
    retryProfileBackupDelivery: vi.fn(),
    runManualProfileBackup: vi.fn(),
    setProfileBackupSettings: mocks.setProfileBackupSettings
}));

vi.mock('@/services/profileRestoreSelectionService', () => ({
    selectProfileBackupToRestore: vi.fn()
}));

vi.mock('@/services/shellIntegrationService', () => ({
    openFolderSelectorDialog: vi.fn(),
    saveFileSelectorDialog: vi.fn()
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: vi.fn(), close: vi.fn() }
}));

vi.mock('@/lib/useProfileRestoreRollback', () => ({
    useProfileRestoreRollback: () => ({
        rollbackState: null,
        cleanupRunning: false,
        refreshRollbackState: () => Promise.resolve(null),
        confirmAndClearRollback: vi.fn()
    })
}));

vi.mock('@/ui/shadcn/dialog', () => ({
    Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) =>
        open ? <div>{children}</div> : null,
    DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
    DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
    DialogHeader: ({ children }: PropsWithChildren) => (
        <header>{children}</header>
    ),
    DialogTitle: ({ children }: PropsWithChildren) => <h1>{children}</h1>
}));

import { ProfileBackupDialog } from './ProfileBackupDialog';

function recorderSetUp(address: string | null) {
    vi.mocked(commands.appFeedLoggerSettingsGet).mockResolvedValue({
        address,
        savedCredentialsAvailable: false
    });
}

async function switchAutomaticBackupsOff() {
    render(<ProfileBackupDialog open onOpenChange={vi.fn()} />);
    const toggle = await screen.findByRole('switch');
    await waitFor(() =>
        expect(toggle.getAttribute('aria-checked')).toBe('true')
    );
    fireEvent.click(toggle);
}

function callOrder(command: { mock: { invocationCallOrder: number[] } }) {
    return command.mock.invocationCallOrder[0];
}

beforeEach(() => {
    useProfileBackupStore.getState().resetProfileBackupState();
    useModalStore.setState({ confirm: mocks.confirm });
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
    vi.mocked(commands.appFeedLoggerSync).mockResolvedValue({
        result: 'synced',
        frames: 3,
        inserted: 3,
        framesWithoutBaseline: 0
    });
    vi.mocked(commands.appFeedLoggerUnpair).mockResolvedValue(null);
    vi.mocked(commands.appFeedLoggerSettingsClear).mockResolvedValue(null);
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('turning automatic backups off while a recorder depends on them', () => {
    it('turns backups off without asking when no recorder is set up', async () => {
        recorderSetUp(null);

        await switchAutomaticBackupsOff();

        await waitFor(() =>
            expect(mocks.setProfileBackupSettings).toHaveBeenCalledWith(
                expect.objectContaining({ autoEnabled: false })
            )
        );
        expect(mocks.confirm).not.toHaveBeenCalled();
        expect(commands.appFeedLoggerSettingsClear).not.toHaveBeenCalled();
    });

    it('asks first and keeps both backups and the recorder when the user cancels', async () => {
        recorderSetUp('http://127.0.0.1:8787');
        mocks.confirm.mockResolvedValue({ ok: false });

        await switchAutomaticBackupsOff();

        await waitFor(() =>
            expect(mocks.confirm).toHaveBeenCalledWith(
                expect.objectContaining({
                    title: 'offline_record.backup_off_confirm_title',
                    destructive: true
                })
            )
        );
        expect(commands.appFeedLoggerSync).not.toHaveBeenCalled();
        expect(commands.appFeedLoggerUnpair).not.toHaveBeenCalled();
        expect(commands.appFeedLoggerSettingsClear).not.toHaveBeenCalled();
        expect(mocks.setProfileBackupSettings).not.toHaveBeenCalled();
    });

    it('fills in, logs the recorder out, disconnects it, then turns backups off when the user confirms', async () => {
        recorderSetUp('http://127.0.0.1:8787');
        mocks.confirm.mockResolvedValue({ ok: true });

        await switchAutomaticBackupsOff();

        await waitFor(() =>
            expect(mocks.setProfileBackupSettings).toHaveBeenCalledWith(
                expect.objectContaining({ autoEnabled: false })
            )
        );
        const sync = callOrder(vi.mocked(commands.appFeedLoggerSync));
        const unpair = callOrder(vi.mocked(commands.appFeedLoggerUnpair));
        const disconnect = callOrder(
            vi.mocked(commands.appFeedLoggerSettingsClear)
        );
        const backupsOff = callOrder(mocks.setProfileBackupSettings);
        expect(sync).toBeLessThan(unpair);
        expect(unpair).toBeLessThan(disconnect);
        expect(disconnect).toBeLessThan(backupsOff);
    });

    it('still disconnects the recorder and turns backups off when the final fill-in and log-out fail', async () => {
        recorderSetUp('http://127.0.0.1:8787');
        mocks.confirm.mockResolvedValue({ ok: true });
        vi.mocked(commands.appFeedLoggerSync).mockRejectedValue(
            new Error('unreachable')
        );
        vi.mocked(commands.appFeedLoggerUnpair).mockRejectedValue(
            new Error('unreachable')
        );

        await switchAutomaticBackupsOff();

        await waitFor(() =>
            expect(mocks.setProfileBackupSettings).toHaveBeenCalledWith(
                expect.objectContaining({ autoEnabled: false })
            )
        );
        expect(commands.appFeedLoggerSettingsClear).toHaveBeenCalledTimes(1);
    });
});
