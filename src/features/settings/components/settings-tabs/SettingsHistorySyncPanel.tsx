import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime';
import { invoke } from '@/platform/tauri/generatedInvoke';
import { Button } from '@/ui/shadcn/button';
import { Progress } from '@/ui/shadcn/progress';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';

import {
    SettingsHistorySyncAccount,
    SettingsHistorySyncReceiveKey
} from './SettingsHistorySyncAccount';

type SyncStatus = {
    enabled: boolean;
    paired: boolean;
    hasKey: boolean;
    signedInToVrchat: boolean;
    vaultId: string | null;
    lastSyncAt: number | null;
    progress: SyncProgress | null;
    log: { kind: string; message: string; createdAt: number }[];
};

type SyncProgress = {
    phase: 'connecting' | 'reading' | 'uploading' | 'deduplicating';
    readFrom: number;
    readThrough: number;
    readTotal: number;
    importedRows: number;
    matchedRows: number;
    pushedRows: number;
    replacedChunks: number;
};

const ACTIVE_REFRESH_MS = 1000;
const IDLE_REFRESH_MS = 5000;

function readPercent(progress: SyncProgress): number {
    const total = progress.readTotal - progress.readFrom;
    if (total <= 0) {
        return 100;
    }
    const done = progress.readThrough - progress.readFrom;
    return Math.min(100, Math.max(0, Math.floor((done / total) * 100)));
}

type SyncRun = {
    createdVault: boolean;
    pushedRows: number;
    importedRows: number;
    matchedRows: number;
    gaps: number;
    unknownStreams: string[];
    cancelled: boolean;
};

type CollectorSnapshot = {
    state: string;
    lastChunkAtMs: number | null;
    lastError: string | null;
    liveAgeMs: number | null;
    live: {
        ownStatus: string;
        ownLocation: string;
        friends: {
            userId: string;
            displayName: string;
            status: string;
            location: string;
            platform: string;
        }[];
    } | null;
};

const INPUT_CLASS =
    'bg-background h-9 w-full rounded-md border px-3 font-mono text-sm';

export function SettingsHistorySyncPanel({
    collectorAvailable,
    collectorAllowed,
    onSyncComplete
}: {
    collectorAvailable: boolean;
    collectorAllowed: boolean;
    onSyncComplete?: () => void;
}) {
    const { t } = useTranslation();
    const [status, setStatus] = useState<SyncStatus>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const [ownKey, setOwnKey] = useState('');
    const [recoveryInput, setRecoveryInput] = useState('');
    const [recoveryString, setRecoveryString] = useState<string>();
    const [mustConfirmSaved, setMustConfirmSaved] = useState(false);
    const [lastRun, setLastRun] = useState<SyncRun>();
    const [collector, setCollector] = useState<CollectorSnapshot>();
    const [collectorConsent, setCollectorConsent] = useState(false);
    const [collectorForever, setCollectorForever] = useState(false);
    const [collectorDays, setCollectorDays] = useState('7');
    const [collectorInterval, setCollectorInterval] = useState(60);
    const collectorIntervalLabel = (seconds: number) =>
        t(
            seconds === 60
                ? 'view.settings.history_sync.sync_interval_one_minute'
                : 'view.settings.history_sync.sync_interval_minutes',
            { minutes: seconds / 60 }
        );
    const collectorDaysValue = Number(collectorDays);
    const collectorDaysValid =
        Number.isInteger(collectorDaysValue) &&
        collectorDaysValue >= 1 &&
        collectorDaysValue <= 30;

    const refresh = useCallback(async () => {
        setStatus(await invoke<SyncStatus>('app__remote_sync_status_get'));
    }, []);

    const refreshCollector = useCallback(async () => {
        setCollector(
            await invoke<CollectorSnapshot>(
                'app__remote_sync_collector_snapshot'
            )
        );
    }, []);

    const run = useCallback(
        async (work: () => Promise<void>) => {
            setBusy(true);
            setError(undefined);
            try {
                await work();
                await refresh();
            } catch (cause) {
                setError(
                    cause instanceof Error ? cause.message : String(cause)
                );
            } finally {
                setBusy(false);
            }
        },
        [refresh]
    );

    useEffect(() => {
        void run(async () => {});
    }, [run]);

    // A pass can also start in the background, so the status is read again
    // while the panel is open, and more often while a pass is running.
    const syncing = busy || Boolean(status?.progress);
    useEffect(() => {
        const timer = window.setInterval(
            () => void refresh().catch(() => {}),
            syncing ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS
        );
        return () => window.clearInterval(timer);
    }, [refresh, syncing]);

    if (!status) return null;

    if (recoveryString) {
        return (
            <div className="space-y-2 rounded-md border p-3 text-sm">
                <p className="font-medium">
                    {t('view.settings.history_sync.recovery_title')}
                </p>
                <p className="text-muted-foreground">
                    {t('view.settings.history_sync.recovery_warning')}
                </p>
                <p className="bg-muted rounded-md p-2 font-mono break-all select-all">
                    {recoveryString}
                </p>
                <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                        setRecoveryString(undefined);
                        setMustConfirmSaved(false);
                    }}
                >
                    {mustConfirmSaved
                        ? t('view.settings.history_sync.recovery_saved')
                        : t('view.settings.history_sync.recovery_hide')}
                </Button>
            </div>
        );
    }

    if (!status.hasKey) {
        return (
            <div className="space-y-3 rounded-md border p-3 text-sm">
                <p className="font-medium">
                    {t('view.settings.history_sync.key_setup_title')}
                </p>
                <p className="text-muted-foreground">
                    {t('view.settings.history_sync.key_setup_description')}
                </p>
                <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                        void run(async () => {
                            const created = await invoke<string>(
                                'app__remote_sync_key_create',
                                { ownKey: null }
                            );
                            setMustConfirmSaved(true);
                            setRecoveryString(created);
                        })
                    }
                >
                    {t('view.settings.history_sync.key_generate')}
                </Button>
                <details className="rounded-md border p-3">
                    <summary className="cursor-pointer font-medium">
                        {t('view.settings.history_sync.key_existing_title')}
                    </summary>
                    <div className="mt-3 space-y-3">
                        <SettingsHistorySyncReceiveKey
                            onReceived={() => void run(async () => {})}
                        />
                        <div className="space-y-2">
                            <p className="text-muted-foreground">
                                {t(
                                    'view.settings.history_sync.key_import_description'
                                )}
                            </p>
                            <input
                                className={INPUT_CLASS}
                                value={recoveryInput}
                                placeholder="rss1-..."
                                onChange={(event) =>
                                    setRecoveryInput(event.target.value)
                                }
                            />
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy || !recoveryInput.trim()}
                                onClick={() =>
                                    void run(async () => {
                                        await invoke(
                                            'app__remote_sync_key_import',
                                            { recoveryString: recoveryInput }
                                        );
                                        setRecoveryInput('');
                                    })
                                }
                            >
                                {t('view.settings.history_sync.key_import')}
                            </Button>
                        </div>
                        <div className="space-y-2">
                            <p className="text-muted-foreground">
                                {t(
                                    'view.settings.history_sync.key_existing_own_description'
                                )}
                            </p>
                            <input
                                className={INPUT_CLASS}
                                value={ownKey}
                                placeholder={t(
                                    'view.settings.history_sync.own_key_placeholder'
                                )}
                                onChange={(event) =>
                                    setOwnKey(event.target.value)
                                }
                            />
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy || !ownKey.trim()}
                                onClick={() =>
                                    void run(async () => {
                                        const created = await invoke<string>(
                                            'app__remote_sync_key_create',
                                            { ownKey: ownKey.trim() }
                                        );
                                        setOwnKey('');
                                        setMustConfirmSaved(true);
                                        setRecoveryString(created);
                                    })
                                }
                            >
                                {t('view.settings.history_sync.key_use_own')}
                            </Button>
                        </div>
                    </div>
                </details>
                {error ? <p className="text-destructive">{error}</p> : null}
            </div>
        );
    }

    return (
        <div className="space-y-2 rounded-md border p-3 text-sm">
            {collectorAvailable && collectorAllowed && status.vaultId ? (
                <section className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">
                            {t('view.settings.history_sync.collector_title')}:{' '}
                            {collector?.state ??
                                t(
                                    'view.settings.history_sync.collector_unknown'
                                )}
                        </p>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void run(refreshCollector)}
                        >
                            {t('view.settings.history_sync.collector_refresh')}
                        </Button>
                    </div>
                    {collector?.lastError ? (
                        <p className="text-destructive">
                            {collector.lastError}
                        </p>
                    ) : null}
                    {collector?.live ? (
                        <div>
                            <p>
                                {collector.live.ownStatus} -{' '}
                                {collector.live.ownLocation}
                            </p>
                            <p>
                                {t(
                                    'view.settings.history_sync.collector_friends'
                                )}
                                : {collector.live.friends.length} (
                                {collector.liveAgeMs ?? 0} ms old)
                            </p>
                            <ul className="max-h-40 overflow-auto">
                                {collector.live.friends.map((friend) => (
                                    <li key={friend.userId}>
                                        {friend.displayName} - {friend.status} -{' '}
                                        {friend.location || friend.platform}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}
                    <p className="text-muted-foreground">
                        {t('view.settings.history_sync.collector_warning')}
                    </p>
                    <label className="flex items-center gap-2">
                        <span>
                            {t('view.settings.history_sync.collector_duration')}
                        </span>
                        <input
                            className={INPUT_CLASS + ' max-w-24'}
                            type="number"
                            min={1}
                            max={30}
                            step={1}
                            value={collectorDays}
                            disabled={collectorForever}
                            onChange={(event) =>
                                setCollectorDays(event.target.value)
                            }
                        />
                    </label>
                    <label className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={collectorForever}
                            onChange={(event) =>
                                setCollectorForever(event.target.checked)
                            }
                        />
                        <span>
                            {t('view.settings.history_sync.collector_forever')}
                        </span>
                    </label>
                    <div className="flex items-center gap-2">
                        <span>
                            {t('view.settings.history_sync.collector_interval')}
                        </span>
                        <Select
                            value={String(collectorInterval)}
                            onValueChange={(value) =>
                                setCollectorInterval(Number(value))
                            }
                        >
                            <SelectTrigger
                                size="sm"
                                aria-label={t(
                                    'view.settings.history_sync.collector_interval'
                                )}
                            >
                                <SelectValue>
                                    {(value: string) =>
                                        collectorIntervalLabel(Number(value))
                                    }
                                </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                                {[60, 120, 300, 600, 900].map((seconds) => (
                                    <SelectItem
                                        key={seconds}
                                        value={String(seconds)}
                                    >
                                        {collectorIntervalLabel(seconds)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <label className="flex items-start gap-2">
                        <input
                            type="checkbox"
                            checked={collectorConsent}
                            onChange={(event) =>
                                setCollectorConsent(event.target.checked)
                            }
                        />
                        <span>
                            {t('view.settings.history_sync.collector_consent')}
                        </span>
                    </label>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            size="sm"
                            disabled={
                                busy ||
                                !collectorConsent ||
                                (!collectorForever && !collectorDaysValid)
                            }
                            onClick={() =>
                                void run(async () => {
                                    await invoke(
                                        'app__remote_sync_collector_unlock',
                                        {
                                            days: collectorForever
                                                ? null
                                                : collectorDaysValue,
                                            intervalSeconds: collectorInterval
                                        }
                                    );
                                    setCollectorConsent(false);
                                    await refreshCollector();
                                })
                            }
                        >
                            {t('view.settings.history_sync.collector_unlock')}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy || !collectorConsent}
                            onClick={() =>
                                void run(async () => {
                                    await invoke(
                                        'app__remote_sync_collector_lock'
                                    );
                                    setCollectorConsent(false);
                                    await refreshCollector();
                                })
                            }
                        >
                            {t('view.settings.history_sync.collector_lock')}
                        </Button>
                    </div>
                </section>
            ) : null}
            <p>
                {status.lastSyncAt
                    ? t('view.settings.history_sync.last_sync', {
                          time: formatDateFilter(status.lastSyncAt, 'long')
                      })
                    : t('view.settings.history_sync.never_synced')}
            </p>
            {status.progress ? (
                <div className="space-y-1" role="status">
                    <p>
                        {t(
                            `view.settings.history_sync.progress.${status.progress.phase}`,
                            {
                                percent: readPercent(status.progress),
                                imported: status.progress.importedRows,
                                matched: status.progress.matchedRows,
                                sent: status.progress.pushedRows
                            }
                        )}
                    </p>
                    {status.progress.phase === 'reading' ? (
                        <Progress value={readPercent(status.progress)} />
                    ) : null}
                </div>
            ) : null}
            {!status.signedInToVrchat ? (
                <p className="text-muted-foreground">
                    {t('view.settings.history_sync.sign_in_to_vrchat')}
                </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    size="sm"
                    disabled={syncing || !status.signedInToVrchat}
                    onClick={() =>
                        void run(async () => {
                            setLastRun(
                                await invoke<SyncRun>('app__remote_sync_now')
                            );
                            onSyncComplete?.();
                        })
                    }
                >
                    {syncing
                        ? t('view.settings.history_sync.syncing')
                        : t('view.settings.history_sync.sync_now')}
                </Button>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                        void run(async () => {
                            setRecoveryString(
                                await invoke<string>(
                                    'app__remote_sync_recovery_string_get'
                                )
                            );
                        })
                    }
                >
                    {t('view.settings.history_sync.recovery_show')}
                </Button>
            </div>
            {lastRun ? (
                <p className="text-muted-foreground">
                    {t('view.settings.history_sync.sync_result', {
                        sent: lastRun.pushedRows,
                        received: lastRun.importedRows,
                        known: lastRun.matchedRows
                    })}
                </p>
            ) : null}
            {lastRun && lastRun.importedRows > 0 ? (
                <p className="text-muted-foreground">
                    {t('view.settings.history_sync.reopen_hint')}
                </p>
            ) : null}
            {error ? <p className="text-destructive">{error}</p> : null}
            {status.log.length > 0 ? (
                <div>
                    <p className="font-medium">
                        {t('view.settings.history_sync.sync_log')}
                    </p>
                    <ul className="text-muted-foreground max-h-40 overflow-auto text-xs">
                        {status.log.map((entry) => (
                            <li key={`${entry.createdAt}-${entry.message}`}>
                                {formatDateFilter(entry.createdAt, 'long')}{' '}
                                {entry.message}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
            <SettingsHistorySyncAccount
                onChanged={() => void run(async () => {})}
            />
        </div>
    );
}
