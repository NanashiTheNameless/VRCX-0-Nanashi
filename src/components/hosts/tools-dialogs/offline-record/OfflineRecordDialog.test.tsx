// @vitest-environment jsdom

import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor
} from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    commands,
    type FeedLoggerProbe,
    type FeedLoggerSettingsView
} from '@/platform/tauri/bindings';
import { PlatformCommandError } from '@/platform/tauri/errors';
import { useModalStore } from '@/state/modalStore';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { connectedRecorder } from '@/test/offlineRecordFixtures';

const mocks = vi.hoisted(() => ({
    confirm: vi.fn(),
    getProfileBackupSettings: vi.fn(),
    toastAdd: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', async () =>
    (await import('@/test/mockCommands')).mockBindingsModule()
);

vi.mock('@/services/profileBackupService', () => ({
    getProfileBackupSettings: mocks.getProfileBackupSettings
}));

vi.mock('@/services/toastService', () => ({
    toast: { add: mocks.toastAdd, close: vi.fn() }
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

vi.mock('@/ui/shadcn/tooltip', () => ({
    Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
    TooltipContent: ({ children }: PropsWithChildren) => (
        <div role="tooltip">{children}</div>
    ),
    TooltipTrigger: ({ render }: { render?: ReactNode }) => <>{render}</>
}));

import { OfflineRecordDialog } from './OfflineRecordDialog';

const RECORDER_ADDRESS = 'http://127.0.0.1:8787';

function backupSettings(autoEnabled: boolean) {
    return {
        autoEnabled,
        autoIntervalDays: 7,
        autoRetainExtra: 2,
        autoTargetDir: 'D:/Backups',
        lastAutoAt: null
    };
}

function noRecorder(savedCredentialsAvailable = true) {
    vi.mocked(commands.appFeedLoggerSettingsGet).mockResolvedValue({
        address: null,
        savedCredentialsAvailable
    });
}

function recorderReports(
    probe: FeedLoggerProbe,
    settings: Partial<FeedLoggerSettingsView> = {}
) {
    vi.mocked(commands.appFeedLoggerSettingsGet).mockResolvedValue({
        address: RECORDER_ADDRESS,
        savedCredentialsAvailable: true,
        ...settings
    });
    vi.mocked(commands.appFeedLoggerStatus).mockImplementation(() => {
        useOfflineRecordStore.getState().applyHealth(probe);
        return Promise.resolve(probe);
    });
}

function openDialog() {
    const onOpenChange = vi.fn();
    const view = render(
        <OfflineRecordDialog open onOpenChange={onOpenChange} />
    );
    return { ...view, onOpenChange };
}

function setupStep() {
    return screen.getByRole('progressbar').getAttribute('aria-valuenow');
}

function button(name: string) {
    return screen.getByRole<HTMLButtonElement>('button', { name });
}

async function enterAddressAndPassword(address: string, password: string) {
    fireEvent.change(await screen.findByLabelText('offline_record.address'), {
        target: { value: address }
    });
    fireEvent.click(button('offline_record.next'));
    fireEvent.change(screen.getByLabelText('offline_record.password'), {
        target: { value: password }
    });
    fireEvent.click(button('offline_record.connect'));
}

beforeEach(() => {
    useOfflineRecordStore.setState({
        health: null,
        syncProgress: null,
        backfillRevision: 0,
        riskAcknowledged: false
    });
    useRuntimeStore.setState((state) => ({
        auth: {
            ...state.auth,
            currentUserId: 'usr_self',
            currentUserDisplayName: 'Self Name'
        },
        systemHosts: { ...state.systemHosts, profileBackupOpen: false }
    }));
    noRecorder();
    vi.mocked(commands.appFeedLoggerSettingsClear).mockResolvedValue(null);
    vi.mocked(commands.appFeedLoggerStatus).mockResolvedValue({
        state: 'notConfigured'
    });
    mocks.getProfileBackupSettings.mockResolvedValue(backupSettings(true));
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('first-time setup', () => {
    it('stops at step 1 of 4 until automatic backups are on and sends the user to backups', async () => {
        mocks.getProfileBackupSettings.mockResolvedValue(backupSettings(false));
        const { onOpenChange } = openDialog();

        expect(
            await screen.findByText('offline_record.setup.backup_title')
        ).toBeTruthy();
        expect(setupStep()).toBe('1');
        expect(screen.queryByLabelText('offline_record.address')).toBeNull();

        fireEvent.click(button('offline_record.open_backup'));

        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(useRuntimeStore.getState().systemHosts.profileBackupOpen).toBe(
            true
        );
    });

    it('goes through address, recorder password and VRChat login in that order', async () => {
        vi.mocked(commands.appFeedLoggerSettingsSave).mockImplementation(() => {
            const probe = connectedRecorder({
                session: { state: 'noCredentials' },
                accountId: null
            });
            recorderReports(probe);
            return Promise.resolve(probe);
        });
        openDialog();

        expect(
            await screen.findByText('offline_record.setup.address_title')
        ).toBeTruthy();
        expect(setupStep()).toBe('2');
        expect(button('offline_record.next').disabled).toBe(true);

        fireEvent.change(screen.getByLabelText('offline_record.address'), {
            target: { value: `  ${RECORDER_ADDRESS}  ` }
        });
        fireEvent.click(button('offline_record.next'));

        expect(
            screen.getByText('offline_record.setup.password_title')
        ).toBeTruthy();
        expect(setupStep()).toBe('3');
        expect(button('offline_record.connect').disabled).toBe(true);

        fireEvent.change(screen.getByLabelText('offline_record.password'), {
            target: { value: 'vrcx0-test' }
        });
        fireEvent.click(button('offline_record.connect'));

        expect(
            await screen.findByText('offline_record.setup.login_title')
        ).toBeTruthy();
        expect(setupStep()).toBe('4');
        expect(commands.appFeedLoggerSettingsSave).toHaveBeenCalledWith(
            RECORDER_ADDRESS,
            'vrcx0-test'
        );
        expect(commands.appFeedLoggerSettingsClear).not.toHaveBeenCalled();
    });

    it.each([
        {
            problem: 'cannot be reached',
            probe: { state: 'unreachable', message: 'timeout' },
            reason: 'offline_record.health.unreachable'
        },
        {
            problem: 'rejects the password',
            probe: { state: 'unauthorized' },
            reason: 'offline_record.health.unauthorized'
        },
        {
            problem: 'is a beta build while this VRCX-0 is stable',
            probe: { state: 'betaRecorder' },
            reason: 'offline_record.health.beta_recorder'
        },
        {
            problem: 'answers with something unexpected',
            probe: { state: 'badResponse', message: 'not json' },
            reason: 'offline_record.health.bad_response'
        }
    ] satisfies { problem: string; probe: FeedLoggerProbe; reason: string }[])(
        'keeps the user on the password step with the reason when the recorder $problem',
        async ({ probe, reason }) => {
            vi.mocked(commands.appFeedLoggerSettingsSave).mockResolvedValue(
                probe
            );
            openDialog();

            await enterAddressAndPassword(RECORDER_ADDRESS, 'vrcx0-test');

            expect(await screen.findByText(reason)).toBeTruthy();
            expect(setupStep()).toBe('3');
            expect(
                screen.getByLabelText('offline_record.password')
            ).toBeTruthy();
        }
    );
});

describe('reopening the dialog', () => {
    it('does not show the error from an earlier failed connection', async () => {
        vi.mocked(commands.appFeedLoggerSettingsSave).mockResolvedValue({
            state: 'unauthorized'
        });
        const view = openDialog();
        await enterAddressAndPassword(RECORDER_ADDRESS, 'vrcx0-test');
        expect(
            await screen.findByText('offline_record.health.unauthorized')
        ).toBeTruthy();

        view.rerender(
            <OfflineRecordDialog
                open={false}
                onOpenChange={view.onOpenChange}
            />
        );
        view.rerender(
            <OfflineRecordDialog open onOpenChange={view.onOpenChange} />
        );
        fireEvent.change(
            await screen.findByLabelText('offline_record.address'),
            { target: { value: RECORDER_ADDRESS } }
        );
        fireEvent.click(button('offline_record.next'));

        expect(screen.getByLabelText('offline_record.password')).toBeTruthy();
        expect(
            screen.queryByText('offline_record.health.unauthorized')
        ).toBeNull();
    });
});

describe('leaving the recorder', () => {
    beforeEach(() => {
        useModalStore.setState({ confirm: mocks.confirm });
        mocks.confirm.mockResolvedValue({ ok: true });
        vi.mocked(commands.appFeedLoggerSync).mockResolvedValue({
            result: 'synced',
            frames: 5,
            inserted: 5,
            framesWithoutBaseline: 0
        });
        vi.mocked(commands.appFeedLoggerUnpair).mockResolvedValue(null);
        recorderReports(connectedRecorder({ unsyncedFrames: 5 }));
    });

    function callOrder(command: (...args: never[]) => unknown) {
        return vi.mocked(command).mock.invocationCallOrder[0];
    }

    it('fills in, logs the recorder out and forgets it when the user disconnects', async () => {
        openDialog();

        fireEvent.click(await screen.findByText('offline_record.disconnect'));

        await waitFor(() =>
            expect(commands.appFeedLoggerSettingsClear).toHaveBeenCalledTimes(1)
        );
        expect(callOrder(commands.appFeedLoggerSync)).toBeLessThan(
            callOrder(commands.appFeedLoggerUnpair)
        );
        expect(callOrder(commands.appFeedLoggerUnpair)).toBeLessThan(
            callOrder(commands.appFeedLoggerSettingsClear)
        );
    });

    it('fills in before the recorder logs out of VRChat', async () => {
        openDialog();

        fireEvent.click(await screen.findByText('offline_record.sign_out'));

        await waitFor(() =>
            expect(commands.appFeedLoggerUnpair).toHaveBeenCalledTimes(1)
        );
        expect(callOrder(commands.appFeedLoggerSync)).toBeLessThan(
            callOrder(commands.appFeedLoggerUnpair)
        );
        expect(commands.appFeedLoggerSettingsClear).not.toHaveBeenCalled();
    });

    it('explains a recorder error in the interface language', async () => {
        vi.mocked(commands.appFeedLoggerSync).mockRejectedValue(
            new PlatformCommandError({
                code: 'feed_logger',
                message: 'VRCX-0 is not connected to the feed logger right now',
                feedLoggerCode: 'notPresent'
            })
        );
        openDialog();

        fireEvent.click(await screen.findByText('offline_record.sync_now'));

        await waitFor(() =>
            expect(mocks.toastAdd).toHaveBeenCalledWith({
                type: 'error',
                title: expect.stringContaining("isn't linked with the recorder")
            })
        );
    });
});

describe('logging the recorder in to VRChat', () => {
    it('asks the user to accept the risk notice before any login is possible', async () => {
        recorderReports(
            connectedRecorder({
                session: { state: 'noCredentials' },
                accountId: null
            })
        );
        openDialog();

        expect(
            await screen.findByText('offline_record.risk_title')
        ).toBeTruthy();
        expect(button('offline_record.push_saved_credentials').disabled).toBe(
            true
        );

        fireEvent.click(screen.getByRole('checkbox'));

        await waitFor(() =>
            expect(
                button('offline_record.push_saved_credentials').disabled
            ).toBe(false)
        );
    });

    it('does not ask again at the two-factor step once the risk was accepted', async () => {
        recorderReports(
            connectedRecorder({
                session: { state: 'noCredentials' },
                accountId: null
            }),
            { savedCredentialsAvailable: false }
        );
        vi.mocked(commands.appFeedLoggerPushCredentials).mockImplementation(
            () => {
                const session = {
                    state: 'awaitingTwoFactor' as const,
                    methods: ['totp']
                };
                recorderReports(
                    connectedRecorder({ session, accountId: null }),
                    { savedCredentialsAvailable: false }
                );
                return Promise.resolve(session);
            }
        );
        vi.mocked(commands.appFeedLoggerSubmitTwoFactor).mockResolvedValue({
            state: 'recording'
        });
        openDialog();

        fireEvent.click(await screen.findByRole('checkbox'));
        fireEvent.change(
            screen.getByLabelText('offline_record.vrchat_username'),
            { target: { value: ' alice ' } }
        );
        fireEvent.change(
            screen.getByLabelText('offline_record.vrchat_password'),
            { target: { value: 'hunter2' } }
        );
        fireEvent.click(button('offline_record.push_credentials'));

        const code = await screen.findByLabelText<HTMLInputElement>(
            'offline_record.two_factor_code'
        );
        expect(commands.appFeedLoggerPushCredentials).toHaveBeenCalledWith(
            'alice',
            'hunter2',
            true
        );
        expect(code.disabled).toBe(false);

        fireEvent.change(code, { target: { value: ' 123456 ' } });
        fireEvent.click(button('offline_record.verify'));

        await waitFor(() =>
            expect(commands.appFeedLoggerSubmitTwoFactor).toHaveBeenCalledWith(
                'totp',
                '123456'
            )
        );
    });

    it('does not ask again when the user logs the recorder in again later in the session', async () => {
        recorderReports(
            connectedRecorder({
                session: { state: 'noCredentials' },
                accountId: null
            })
        );
        const { unmount } = openDialog();
        fireEvent.click(await screen.findByRole('checkbox'));
        await waitFor(() =>
            expect(
                button('offline_record.push_saved_credentials').disabled
            ).toBe(false)
        );
        unmount();

        recorderReports(connectedRecorder({ session: { state: 'recording' } }));
        openDialog();
        fireEvent.click(await screen.findByText('offline_record.relogin'));

        expect(button('offline_record.push_saved_credentials').disabled).toBe(
            false
        );
    });

    it('forgets the typed VRChat password once the recorder has received it', async () => {
        useOfflineRecordStore.setState({ riskAcknowledged: true });
        recorderReports(
            connectedRecorder({ session: { state: 'recording' } }),
            {
                savedCredentialsAvailable: false
            }
        );
        vi.mocked(commands.appFeedLoggerPushCredentials).mockResolvedValue({
            state: 'recording'
        });
        openDialog();
        fireEvent.click(await screen.findByText('offline_record.relogin'));
        const password = screen.getByLabelText<HTMLInputElement>(
            'offline_record.vrchat_password'
        );
        fireEvent.change(
            screen.getByLabelText('offline_record.vrchat_username'),
            { target: { value: 'someone' } }
        );
        fireEvent.change(password, { target: { value: 'vrchat-secret' } });

        fireEvent.click(button('offline_record.push_credentials'));

        await waitFor(() => expect(password.value).toBe(''));
        expect(commands.appFeedLoggerPushCredentials).toHaveBeenCalledWith(
            'someone',
            'vrchat-secret',
            true
        );
    });

    it('offers only one-click login when VRCX-0 already saved the VRChat password', async () => {
        recorderReports(
            connectedRecorder({
                session: { state: 'noCredentials' },
                accountId: null
            })
        );
        vi.mocked(commands.appFeedLoggerPushSavedCredentials).mockResolvedValue(
            { state: 'loggingIn' }
        );
        useOfflineRecordStore.setState({ riskAcknowledged: true });
        openDialog();

        fireEvent.click(
            await screen.findByText('offline_record.push_saved_credentials')
        );
        expect(
            screen.queryByLabelText('offline_record.vrchat_username')
        ).toBeNull();
        expect(
            screen.queryByLabelText('offline_record.vrchat_password')
        ).toBeNull();

        await waitFor(() =>
            expect(
                commands.appFeedLoggerPushSavedCredentials
            ).toHaveBeenCalledWith(true)
        );
        expect(commands.appFeedLoggerPushCredentials).not.toHaveBeenCalled();
    });

    it('offers no one-click login when VRCX-0 has no saved VRChat password', async () => {
        recorderReports(
            connectedRecorder({
                session: { state: 'noCredentials' },
                accountId: null
            }),
            { savedCredentialsAvailable: false }
        );
        openDialog();

        expect(
            await screen.findByText('offline_record.push_credentials')
        ).toBeTruthy();
        expect(
            screen.queryByText('offline_record.push_saved_credentials')
        ).toBeNull();
    });
});

describe('recorder status', () => {
    it('shows the display name, account ID and recorder version when the recorder follows the current VRCX-0 account', async () => {
        recorderReports(connectedRecorder({ loggerVersion: '2.32.0' }));
        openDialog();

        expect(await screen.findByText('Self Name')).toBeTruthy();
        expect(screen.getByText('usr_self')).toBeTruthy();
        expect(screen.getByText('v2.32.0')).toBeTruthy();
        expect(
            screen.getByText('offline_record.health.recording')
        ).toBeTruthy();
    });

    it('shows only the account ID and warns when the recorder follows another VRChat account', async () => {
        recorderReports(connectedRecorder({ accountId: 'usr_other' }));
        openDialog();

        expect(await screen.findByText('usr_other')).toBeTruthy();
        expect(screen.queryByText('Self Name')).toBeNull();
        expect(
            screen.getByText('offline_record.health.account_mismatch')
        ).toBeTruthy();
    });
});

describe('recorder problems', () => {
    it('shows records lost on the recorder, save failures and the last error', async () => {
        recorderReports(
            connectedRecorder({
                droppedUnsyncedFrames: 12,
                droppedAfterPasswordChange: 3,
                storageError: 'disk is full',
                lastError: 'VRChat returned 502',
                availableBytes: 1024
            })
        );
        openDialog();

        expect(
            await screen.findByText('offline_record.dropped_unsynced')
        ).toBeTruthy();
        expect(screen.getByText('12')).toBeTruthy();
        expect(
            screen.getByText('offline_record.dropped_after_password_change')
        ).toBeTruthy();
        expect(screen.getByText('offline_record.storage_error')).toBeTruthy();
        expect(screen.getByText('offline_record.last_error')).toBeTruthy();
        expect(screen.getByText('offline_record.available_space')).toBeTruthy();
    });

    it('shows no problem rows while nothing has gone wrong', async () => {
        recorderReports(connectedRecorder());
        openDialog();

        expect(
            await screen.findByText('offline_record.unsynced_frames')
        ).toBeTruthy();
        expect(
            screen.queryByText('offline_record.dropped_unsynced')
        ).toBeNull();
        expect(
            screen.queryByText('offline_record.dropped_after_password_change')
        ).toBeNull();
        expect(screen.queryByText('offline_record.storage_error')).toBeNull();
        expect(screen.queryByText('offline_record.last_error')).toBeNull();
    });
});

describe('webhook alerts', () => {
    function recorderWithWebhook() {
        recorderReports(
            connectedRecorder({
                webhookConfigured: true,
                webhookTarget: 'https://discord.com/…fghij',
                webhookFormat: 'discord'
            })
        );
    }

    it('shows a saved webhook with its secret hidden and only lets the user edit it after choosing Change', async () => {
        recorderWithWebhook();
        openDialog();

        expect(
            await screen.findByText('https://discord.com/…fghij')
        ).toBeTruthy();
        expect(
            screen.queryByLabelText('offline_record.webhook_url')
        ).toBeNull();

        fireEvent.click(button('offline_record.webhook_change'));

        expect(
            screen.getByLabelText<HTMLInputElement>(
                'offline_record.webhook_url'
            ).value
        ).toBe('');
    });

    it('reports success after sending a test message', async () => {
        recorderWithWebhook();
        vi.mocked(commands.appFeedLoggerTestWebhook).mockResolvedValue(null);
        openDialog();

        fireEvent.click(await screen.findByText('offline_record.webhook_test'));

        await waitFor(() =>
            expect(mocks.toastAdd).toHaveBeenCalledWith({
                type: 'success',
                title: 'offline_record.webhook_test_sent'
            })
        );
        expect(commands.appFeedLoggerTestWebhook).toHaveBeenCalledTimes(1);
    });

    it('lists which events send a message in the info tooltip', async () => {
        recorderWithWebhook();
        openDialog();

        await screen.findByText('https://discord.com/…fghij');
        const tooltip = screen.getByRole('tooltip');

        expect(
            [...tooltip.querySelectorAll('li')].map((item) => item.textContent)
        ).toEqual([
            'offline_record.webhook_events.login_stopped',
            'offline_record.webhook_events.two_factor',
            'offline_record.webhook_events.storage_failed',
            'offline_record.webhook_events.recovered',
            'offline_record.webhook_events.records_dropped'
        ]);
    });
});
