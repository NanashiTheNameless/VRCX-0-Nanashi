import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '@/platform/tauri/generatedInvoke';
import { Button } from '@/ui/shadcn/button';

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
    lastSyncAtMs: number | null;
    log: { kind: string; message: string; createdAtMs: number }[];
};

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
    collectorAllowed
}: {
    collectorAvailable: boolean;
    collectorAllowed: boolean;
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
                <div className="space-y-2">
                    <input
                        className={INPUT_CLASS}
                        value={ownKey}
                        placeholder={t(
                            'view.settings.history_sync.own_key_placeholder'
                        )}
                        onChange={(event) => setOwnKey(event.target.value)}
                    />
                    <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                            void run(async () => {
                                const created = await invoke<string>(
                                    'app__remote_sync_key_create',
                                    { ownKey: ownKey.trim() || null }
                                );
                                setOwnKey('');
                                setMustConfirmSaved(true);
                                setRecoveryString(created);
                            })
                        }
                    >
                        {ownKey.trim()
                            ? t('view.settings.history_sync.key_use_own')
                            : t('view.settings.history_sync.key_generate')}
                    </Button>
                </div>
                <div className="space-y-2">
                    <p className="text-muted-foreground">
                        {t('view.settings.history_sync.key_import_description')}
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
                                await invoke('app__remote_sync_key_import', {
                                    recoveryString: recoveryInput
                                });
                                setRecoveryInput('');
                            })
                        }
                    >
                        {t('view.settings.history_sync.key_import')}
                    </Button>
                </div>
                <SettingsHistorySyncReceiveKey
                    onReceived={() => void run(async () => {})}
                />
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
                            disabled={busy || !collectorConsent}
                            onClick={() =>
                                void run(async () => {
                                    await invoke(
                                        'app__remote_sync_collector_unlock',
                                        { days: 7, intervalSeconds: 300 }
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
                {status.lastSyncAtMs
                    ? t('view.settings.history_sync.last_sync', {
                          time: new Date(status.lastSyncAtMs).toLocaleString()
                      })
                    : t('view.settings.history_sync.never_synced')}
            </p>
            {!status.signedInToVrchat ? (
                <p className="text-muted-foreground">
                    {t('view.settings.history_sync.sign_in_to_vrchat')}
                </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    size="sm"
                    disabled={busy || !status.signedInToVrchat}
                    onClick={() =>
                        void run(async () => {
                            setLastRun(
                                await invoke<SyncRun>('app__remote_sync_now')
                            );
                        })
                    }
                >
                    {busy
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
                            <li key={`${entry.createdAtMs}-${entry.message}`}>
                                {new Date(entry.createdAtMs).toLocaleString()}{' '}
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
