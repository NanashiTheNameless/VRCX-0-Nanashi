import { BookOpenIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type FeedLoggerSettingsView
} from '@/platform/tauri/bindings';
import {
    offlineRecordErrorMessage,
    offlineRecordGuideUrl,
    resolveOfflineRecordHealth,
    syncThenRemoveRecorder
} from '@/services/offlineRecordService';
import { getProfileBackupSettings } from '@/services/profileBackupService';
import { openExternalLink } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

import {
    isAutomaticBackupReady,
    resolveSetupStep,
    type RunAction
} from './offlineRecordModel';
import { SetupWizard } from './SetupWizard';
import { StatusPanel } from './StatusPanel';

type OfflineRecordDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
};

export function OfflineRecordDialog({
    open,
    onOpenChange
}: OfflineRecordDialogProps) {
    const { t, i18n } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const probe = useOfflineRecordStore((state) => state.health);
    const confirm = useModalStore((state) => state.confirm);
    const [settings, setSettings] = useState<FeedLoggerSettingsView | null>(
        null
    );
    const [backupReady, setBackupReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [connectError, setConnectError] = useState('');
    const status = probe?.state === 'connected' ? probe.status : null;

    const reportError = useCallback((error: unknown) => {
        toast.add({
            type: 'error',
            title: offlineRecordErrorMessage(error)
        });
    }, []);

    const refresh = useCallback(async () => {
        const [view, backup] = await Promise.all([
            commands.appFeedLoggerSettingsGet(),
            getProfileBackupSettings().catch(() => null)
        ]);
        setSettings(view);
        setBackupReady(isAutomaticBackupReady(backup));
        if (view.address) {
            await commands.appFeedLoggerStatus();
        }
    }, []);

    useEffect(() => {
        if (open) {
            setConnectError('');
            refresh().catch(reportError);
        }
    }, [open, refresh, reportError]);

    const run: RunAction = async (action) => {
        setBusy(true);
        try {
            await action();
        } catch (error) {
            reportError(error);
        } finally {
            setBusy(false);
        }
    };

    function openBackup() {
        onOpenChange(false);
        setSystemHostOpen('profileBackupOpen', true);
    }

    function connect(address: string, password: string) {
        setConnectError('');
        void run(async () => {
            const result = await commands.appFeedLoggerSettingsSave(
                address,
                password
            );
            if (result.state !== 'connected') {
                const failure = resolveOfflineRecordHealth(
                    result,
                    currentUserId
                );
                setConnectError(
                    failure
                        ? t(failure.messageKey)
                        : t('offline_record.action_failed')
                );
            }
            await refresh();
        });
    }

    function disconnect() {
        void run(async () => {
            const result = await confirm({
                title: t('offline_record.disconnect_confirm_title'),
                description: t('offline_record.disconnect_confirm_description'),
                confirmText: t('offline_record.disconnect'),
                cancelText: t('common.actions.cancel'),
                destructive: true
            });
            if (result.ok && (await syncThenRemoveRecorder())) {
                await refresh();
            }
        });
    }

    const setupStep = resolveSetupStep(settings, backupReady, status);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[85vh] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                <DialogHeader className="border-b px-6 py-5">
                    <DialogTitle>{t('offline_record.header')}</DialogTitle>
                    <DialogDescription>
                        {t('offline_record.dialog_description')}
                    </DialogDescription>
                    <ul className="text-muted-foreground flex list-disc flex-col gap-0.5 pl-4 text-xs leading-relaxed">
                        <li>{t('offline_record.scope_note')}</li>
                        <li>{t('offline_record.shutdown_note')}</li>
                    </ul>
                    <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs"
                        onClick={() => {
                            openExternalLink(
                                offlineRecordGuideUrl(i18n.language)
                            ).catch(reportError);
                        }}
                    >
                        <BookOpenIcon className="size-3.5" />
                        {t('offline_record.guide')}
                    </button>
                </DialogHeader>

                <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
                    {settings && setupStep !== null ? (
                        <SetupWizard
                            step={setupStep}
                            busy={busy}
                            session={status?.session ?? null}
                            savedCredentialsAvailable={
                                settings.savedCredentialsAvailable
                            }
                            error={connectError}
                            onOpenBackup={openBackup}
                            onConnect={connect}
                            onCancelSetup={disconnect}
                            run={run}
                        />
                    ) : null}
                    {settings?.address && setupStep === null ? (
                        <StatusPanel
                            address={settings.address}
                            status={status}
                            busy={busy}
                            savedCredentialsAvailable={
                                settings.savedCredentialsAvailable
                            }
                            onDisconnect={disconnect}
                            run={run}
                        />
                    ) : null}
                </div>
            </DialogContent>
        </Dialog>
    );
}
