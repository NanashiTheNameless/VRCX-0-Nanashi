import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { timeToText } from '@/lib/dateTime';
import { cn } from '@/lib/utils';
import { commands, type FeedLoggerStatus } from '@/platform/tauri/bindings';
import { formatDataDirMigrationBytes } from '@/services/dataDirMigrationI18n';
import {
    resolveOfflineRecordHealth,
    syncRecorderBeforeLeaving,
    type OfflineRecordHealthLevel
} from '@/services/offlineRecordService';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import { Separator } from '@/ui/shadcn/separator';

import {
    formatUnixTime,
    runThenRefreshStatus,
    type RunAction
} from './offlineRecordModel';
import { SectionTitle } from './SectionTitle';
import { useBackfillHistory } from './useBackfillHistory';
import { VrchatLoginForm } from './VrchatLoginForm';
import { WebhookSection } from './WebhookSection';

const HEALTH_DOT_CLASS: Record<OfflineRecordHealthLevel, string> = {
    ok: 'bg-[var(--status-online)]',
    warning: 'bg-[var(--status-askme)]',
    error: 'bg-[var(--status-busy)]'
};

function StatRow({
    label,
    value,
    warning = false
}: {
    label: string;
    value: string;
    warning?: boolean;
}) {
    return (
        <div className="flex justify-between gap-4 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span
                className={cn(
                    'tabular-nums',
                    warning && 'text-[var(--status-askme)]'
                )}
            >
                {value}
            </span>
        </div>
    );
}

function ConnectionHeader({
    address,
    busy,
    onDisconnect
}: {
    address: string;
    busy: boolean;
    onDisconnect: () => void;
}) {
    const { t } = useTranslation();
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const probe = useOfflineRecordStore((state) => state.health);
    const health = resolveOfflineRecordHealth(probe, currentUserId);
    return (
        <section className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
                <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-sm font-medium">
                        {address}
                    </span>
                    {probe?.state === 'connected' ? (
                        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            v{probe.status.loggerVersion}
                        </span>
                    ) : null}
                </span>
                {health ? (
                    <span className="flex items-center gap-1.5 text-xs">
                        <span
                            aria-hidden="true"
                            className={cn(
                                'size-2 shrink-0 rounded-full',
                                HEALTH_DOT_CLASS[health.level]
                            )}
                        />
                        <span className="text-muted-foreground">
                            {t(health.messageKey)}
                        </span>
                    </span>
                ) : null}
                {probe?.state === 'unreachable' ||
                probe?.state === 'badResponse' ? (
                    <span className="text-muted-foreground truncate text-xs">
                        {probe.message}
                    </span>
                ) : null}
            </div>
            <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onDisconnect}
            >
                {t('offline_record.disconnect')}
            </Button>
        </section>
    );
}

function LoginSection({
    status,
    busy,
    savedCredentialsAvailable,
    run
}: {
    status: FeedLoggerStatus;
    busy: boolean;
    savedCredentialsAvailable: boolean;
    run: RunAction;
}) {
    const { t } = useTranslation();
    const confirm = useModalStore((state) => state.confirm);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserDisplayName = useRuntimeStore(
        (state) => state.auth.currentUserDisplayName
    );
    const [relogin, setRelogin] = useState(false);
    const displayName =
        status.accountId && status.accountId === currentUserId
            ? currentUserDisplayName
            : '';

    async function signOut() {
        const result = await confirm({
            title: t('offline_record.sign_out_confirm_title'),
            description: t('offline_record.sign_out_confirm_description'),
            confirmText: t('offline_record.sign_out'),
            cancelText: t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        await runThenRefreshStatus(run, async () => {
            if (await syncRecorderBeforeLeaving()) {
                await commands.appFeedLoggerUnpair();
            }
        });
    }

    return (
        <section className="flex flex-col gap-3">
            <SectionTitle>{t('offline_record.vrchat_login')}</SectionTitle>
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">
                        {displayName || status.accountId || '-'}
                    </span>
                    {displayName && status.accountId ? (
                        <span className="text-muted-foreground truncate font-mono text-xs">
                            {status.accountId}
                        </span>
                    ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setRelogin((value) => !value)}
                    >
                        {t('offline_record.relogin')}
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void signOut()}
                    >
                        {t('offline_record.sign_out')}
                    </Button>
                </div>
            </div>
            {status.lastError ? (
                <span className="text-muted-foreground text-xs break-words">
                    {t('offline_record.last_error', {
                        reason: status.lastError
                    })}
                </span>
            ) : null}
            {relogin ? (
                <VrchatLoginForm
                    session={status.session}
                    busy={busy}
                    savedCredentialsAvailable={savedCredentialsAvailable}
                    run={run}
                />
            ) : null}
        </section>
    );
}

function RecordSection({
    status,
    busy,
    run
}: {
    status: FeedLoggerStatus;
    busy: boolean;
    run: RunAction;
}) {
    const { t, i18n } = useTranslation();
    const syncing = useOfflineRecordStore(
        (state) => state.syncProgress !== null
    );
    const backfillHistory = useBackfillHistory();
    const range =
        status.oldestUnsyncedAt !== null && status.newestUnsyncedAt !== null
            ? `${formatUnixTime(status.oldestUnsyncedAt)} - ${formatUnixTime(status.newestUnsyncedAt)}`
            : '-';

    function syncNow() {
        void run(async () => {
            const report = await commands.appFeedLoggerSync();
            if (report.result === 'accountMismatch') {
                toast.add({
                    type: 'error',
                    title: t('offline_record.health.account_mismatch')
                });
            }
        });
    }

    return (
        <section className="flex flex-col gap-3">
            <SectionTitle>{t('offline_record.records')}</SectionTitle>
            <div className="flex flex-col gap-1.5">
                <StatRow
                    label={t('offline_record.uptime')}
                    value={timeToText(
                        (status.serverTime - status.startedAt) * 1000
                    )}
                />
                <StatRow
                    label={t('offline_record.unsynced_frames')}
                    value={String(status.unsyncedFrames)}
                />
                <StatRow
                    label={t('offline_record.unsynced_range')}
                    value={range}
                />
                <StatRow
                    label={t('offline_record.database_size')}
                    value={formatDataDirMigrationBytes(
                        status.databaseBytes,
                        i18n.language
                    )}
                />
                {status.availableBytes !== null ? (
                    <StatRow
                        label={t('offline_record.available_space')}
                        value={formatDataDirMigrationBytes(
                            status.availableBytes,
                            i18n.language
                        )}
                    />
                ) : null}
                <StatRow
                    label={t('offline_record.last_pull')}
                    value={formatUnixTime(status.lastPullAt)}
                />
                {backfillHistory && backfillHistory.total > 0 ? (
                    <>
                        <StatRow
                            label={t('offline_record.backfill_total')}
                            value={String(backfillHistory.total)}
                        />
                        {backfillHistory.recent.map((record) => (
                            <StatRow
                                key={record.at}
                                label={formatUnixTime(record.at)}
                                value={t('offline_record.backfill_record', {
                                    count: record.inserted
                                })}
                            />
                        ))}
                    </>
                ) : null}
                {status.droppedUnsyncedFrames > 0 ? (
                    <StatRow
                        label={t('offline_record.dropped_unsynced')}
                        value={String(status.droppedUnsyncedFrames)}
                        warning
                    />
                ) : null}
                {status.droppedAfterPasswordChange > 0 ? (
                    <StatRow
                        label={t(
                            'offline_record.dropped_after_password_change'
                        )}
                        value={String(status.droppedAfterPasswordChange)}
                        warning
                    />
                ) : null}
            </div>
            {status.storageError ? (
                <span className="text-xs break-words text-[var(--status-askme)]">
                    {t('offline_record.storage_error', {
                        reason: status.storageError
                    })}
                </span>
            ) : null}
            <div className="flex justify-end">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || syncing || status.unsyncedFrames === 0}
                    onClick={syncNow}
                >
                    {t('offline_record.sync_now')}
                </Button>
            </div>
        </section>
    );
}

export function StatusPanel({
    address,
    status,
    busy,
    savedCredentialsAvailable,
    onDisconnect,
    run
}: {
    address: string;
    status: FeedLoggerStatus | null;
    busy: boolean;
    savedCredentialsAvailable: boolean;
    onDisconnect: () => void;
    run: RunAction;
}) {
    return (
        <>
            <ConnectionHeader
                address={address}
                busy={busy}
                onDisconnect={onDisconnect}
            />
            {status ? (
                <>
                    <Separator />
                    <LoginSection
                        status={status}
                        busy={busy}
                        savedCredentialsAvailable={savedCredentialsAvailable}
                        run={run}
                    />
                    <Separator />
                    <RecordSection status={status} busy={busy} run={run} />
                    <Separator />
                    <WebhookSection status={status} busy={busy} run={run} />
                </>
            ) : null}
        </>
    );
}
