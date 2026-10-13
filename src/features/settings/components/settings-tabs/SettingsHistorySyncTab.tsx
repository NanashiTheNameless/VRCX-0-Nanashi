import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import { invoke } from '@/platform/tauri/generatedInvoke';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { SettingsHistorySyncPanel } from './SettingsHistorySyncPanel';
import { SettingsHistorySyncTrust } from './SettingsHistorySyncTrust';
import { SettingsSelfHostedRecorderCard } from './SettingsSelfHostedRecorderCard';

type SettingsSnapshot = {
    backend: string;
    apiOrigin: string;
    websiteOrigin: string;
    paired: boolean;
    syncIntervalMinutes: number;
    syncSettingsEnabled: boolean;
    pauseWhileGameRunning: boolean;
};

type Capabilities = {
    server: string;
    version: string;
    commit: string;
    protocol: number[];
    registration: string;
    websiteOrigins: string[];
    collectorAvailable: boolean;
    policyUrl: string | null;
};

type Account = {
    accountId: string;
    usageBytes: number;
    quotaBytes: number | null;
    collectorAllowed: boolean;
    syncAllowed: boolean;
    scopes: string[];
};

type PairingStart = {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresIn: number;
    interval: number;
};

type WebsiteVerification = {
    verified: boolean;
    version: string | null;
    sourceCommit: string | null;
    filesChecked: number;
    detail: string;
};

type DedupeDevices = {
    devices: { keyId: string; label: string }[];
    selectedDeviceKeyId: string | null;
};

const OFFICIAL_API = 'https://vrcx-api.namelessnanashi.dev';
const OFFICIAL_WEBSITE = 'https://vrcx.namelessnanashi.dev';

export function SettingsHistorySyncTab() {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<SettingsSnapshot>();
    const [capabilities, setCapabilities] = useState<Capabilities>();
    const [account, setAccount] = useState<Account>();
    const [dedupeDevices, setDedupeDevices] = useState<DedupeDevices>();
    const [apiOrigin, setApiOrigin] = useState(OFFICIAL_API);
    const [websiteOrigin, setWebsiteOrigin] = useState(OFFICIAL_WEBSITE);
    const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(10);
    const [syncSettingsEnabled, setSyncSettingsEnabled] = useState(true);
    const [pauseWhileGameRunning, setPauseWhileGameRunning] = useState(false);
    const [pairing, setPairing] = useState<PairingStart>();
    const [pollInterval, setPollInterval] = useState(5);
    const [pairStartedAt, setPairStartedAt] = useState<number>();
    const [confirmServerChange, setConfirmServerChange] = useState(false);
    const [busy, setBusy] = useState(false);
    const [verification, setVerification] = useState<WebsiteVerification>();
    const [error, setError] = useState<string>();

    const refresh = useCallback(async () => {
        let snapshot: SettingsSnapshot;
        try {
            snapshot = await invoke<SettingsSnapshot>(
                'app__remote_sync_settings_get'
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            return;
        }

        setSettings(snapshot);
        setApiOrigin(snapshot.apiOrigin);
        setWebsiteOrigin(snapshot.websiteOrigin);
        setSyncIntervalMinutes(snapshot.syncIntervalMinutes);
        setSyncSettingsEnabled(snapshot.syncSettingsEnabled);
        setPauseWhileGameRunning(snapshot.pauseWhileGameRunning);

        if (snapshot.backend !== 'remotesync') {
            setCapabilities(undefined);
            setAccount(undefined);
            setDedupeDevices(undefined);
            return;
        }

        if (!snapshot.paired) {
            setCapabilities(undefined);
            setAccount(undefined);
            setDedupeDevices(undefined);
            return;
        }

        setCapabilities(undefined);
        void invoke<Capabilities>('app__remote_sync_capabilities_get')
            .then(setCapabilities)
            .catch(() => setCapabilities(undefined));

        void invoke<Account>('app__remote_sync_account_get')
            .then(setAccount)
            .catch(() => setAccount(undefined));
        void invoke<DedupeDevices>('app__remote_sync_dedupe_devices_get')
            .then(setDedupeDevices)
            .catch(() => setDedupeDevices(undefined));
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (!pairing || !pairStartedAt) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            if (
                cancelled ||
                Date.now() - pairStartedAt >= pairing.expiresIn * 1000
            ) {
                if (!cancelled) {
                    setError(t('view.settings.history_sync.pairing_expired'));
                    setPairing(undefined);
                }
                return;
            }
            try {
                const result = await commands.appRemoteSyncPairPoll(
                    pairing.deviceCode,
                    pollInterval
                );
                if (result.status === 'approved') {
                    setPairing(undefined);
                    setAccount(
                        await invoke<Account>('app__remote_sync_account_get')
                    );
                    setSettings((previous) =>
                        previous ? { ...previous, paired: true } : previous
                    );
                    return;
                }
                setPollInterval(result.value.interval_seconds);
            } catch (cause) {
                setError(
                    cause instanceof Error ? cause.message : String(cause)
                );
                setPairing(undefined);
                return;
            }
            timer = setTimeout(poll, pollInterval * 1000);
        };
        timer = setTimeout(poll, pollInterval * 1000);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [pairStartedAt, pairing, pollInterval, t]);

    // Each control saves only its own value; the others keep what is stored,
    // so a value picked but not saved yet is not written along with it.
    async function saveSettings(
        backend: string,
        changes: {
            server?: boolean;
            syncIntervalMinutes?: number;
            syncSettingsEnabled?: boolean;
            pauseWhileGameRunning?: boolean;
        } = {}
    ) {
        setBusy(true);
        setError(undefined);
        try {
            const next = {
                apiOrigin: changes.server
                    ? apiOrigin
                    : (settings?.apiOrigin ?? apiOrigin),
                websiteOrigin: changes.server
                    ? websiteOrigin
                    : (settings?.websiteOrigin ?? websiteOrigin),
                syncIntervalMinutes:
                    changes.syncIntervalMinutes ??
                    settings?.syncIntervalMinutes ??
                    syncIntervalMinutes,
                syncSettingsEnabled:
                    changes.syncSettingsEnabled ??
                    settings?.syncSettingsEnabled ??
                    syncSettingsEnabled,
                pauseWhileGameRunning:
                    changes.pauseWhileGameRunning ??
                    settings?.pauseWhileGameRunning ??
                    pauseWhileGameRunning
            };
            const isChangingServer =
                next.apiOrigin !== settings?.apiOrigin ||
                next.websiteOrigin !== settings?.websiteOrigin;
            if (isChangingServer && !confirmServerChange) {
                return;
            }
            await invoke('app__remote_sync_settings_set', { backend, ...next });
            setSettings((previous) =>
                previous ? { ...previous, backend, ...next } : previous
            );
            setConfirmServerChange(false);
            await refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
        }
    }

    async function pairThisPc() {
        setBusy(true);
        setError(undefined);
        try {
            const result = await invoke<PairingStart>(
                'app__remote_sync_pair_start',
                { deviceLabel: 'VRCX-0-Nanashi desktop' }
            );
            setPairing(result);
            setPollInterval(result.interval);
            setPairStartedAt(Date.now());
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
        }
    }

    async function verifyWebsite() {
        setBusy(true);
        setError(undefined);
        try {
            setVerification(
                await invoke<WebsiteVerification>(
                    'app__remote_sync_website_verify'
                )
            );
        } catch (cause) {
            setVerification(undefined);
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
        }
    }

    async function selectDedupeDevice(keyId: string) {
        setBusy(true);
        setError(undefined);
        try {
            await invoke('app__remote_sync_dedupe_device_set', { keyId });
            setDedupeDevices((previous) =>
                previous
                    ? { ...previous, selectedDeviceKeyId: keyId }
                    : previous
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
        }
    }

    async function signOut() {
        setBusy(true);
        try {
            await invoke('app__remote_sync_sign_out');
            setAccount(undefined);
            setDedupeDevices(undefined);
            setSettings((previous) =>
                previous ? { ...previous, paired: false } : previous
            );
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
        }
    }

    const backend = settings?.backend ?? 'off';

    return (
        <SettingsTabContent value="history-sync">
            <SettingsCard
                cardId="history-sync.backend"
                title={t('view.settings.history_sync.header')}
                description={t('view.settings.history_sync.description')}
            >
                <Field
                    label={
                        <span className="flex flex-wrap items-center gap-2">
                            {t('view.settings.history_sync.backend')}
                            <Badge variant="secondary">
                                {t('view.settings.history_sync.preferred')}
                            </Badge>
                        </span>
                    }
                    description={t(
                        'view.settings.history_sync.backend_description'
                    )}
                >
                    <Switch
                        checked={backend === 'remotesync'}
                        disabled={busy || !settings}
                        onCheckedChange={(enabled) =>
                            void saveSettings(enabled ? 'remotesync' : 'off')
                        }
                    />
                </Field>
            </SettingsCard>

            {backend === 'remotesync' ? (
                <SettingsCard
                    cardId="history-sync.remotesync"
                    title={t('view.settings.history_sync.remotesync')}
                    description={t('view.settings.history_sync.server_note')}
                >
                    <SettingsHistorySyncTrust
                        serverKey={`${settings?.apiOrigin} ${settings?.websiteOrigin}`}
                    />
                    <Field
                        label={t('view.settings.history_sync.sync_interval')}
                        description={t(
                            'view.settings.history_sync.sync_interval_description'
                        )}
                    >
                        <div className="flex items-center gap-2">
                            <Select
                                value={String(syncIntervalMinutes)}
                                disabled={busy}
                                onValueChange={(value) =>
                                    setSyncIntervalMinutes(Number(value))
                                }
                            >
                                <SelectTrigger
                                    size="sm"
                                    aria-label={t(
                                        'view.settings.history_sync.sync_interval'
                                    )}
                                >
                                    <SelectValue>
                                        {(value: string) => {
                                            const minutes = Number(value);
                                            return t(
                                                minutes === 1
                                                    ? 'view.settings.history_sync.sync_interval_one_minute'
                                                    : 'view.settings.history_sync.sync_interval_minutes',
                                                { minutes }
                                            );
                                        }}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {[1, 5, 10, 15, 30, 60].map((minutes) => (
                                        <SelectItem
                                            key={minutes}
                                            value={String(minutes)}
                                        >
                                            {t(
                                                minutes === 1
                                                    ? 'view.settings.history_sync.sync_interval_one_minute'
                                                    : 'view.settings.history_sync.sync_interval_minutes',
                                                { minutes }
                                            )}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={
                                    busy ||
                                    syncIntervalMinutes ===
                                        settings?.syncIntervalMinutes
                                }
                                onClick={() =>
                                    void saveSettings(backend, {
                                        syncIntervalMinutes
                                    })
                                }
                            >
                                {t(
                                    'view.settings.history_sync.save_sync_interval'
                                )}
                            </Button>
                        </div>
                    </Field>
                    <Field
                        label={t('view.settings.history_sync.pause_in_game')}
                        description={t(
                            'view.settings.history_sync.pause_in_game_description'
                        )}
                    >
                        <Switch
                            checked={pauseWhileGameRunning}
                            disabled={busy || !settings}
                            onCheckedChange={(enabled) => {
                                setPauseWhileGameRunning(enabled);
                                void saveSettings(backend, {
                                    pauseWhileGameRunning: enabled
                                });
                            }}
                        />
                    </Field>
                    <Field
                        label={t('view.settings.history_sync.dedupe_device')}
                        description={t(
                            'view.settings.history_sync.dedupe_device_description'
                        )}
                    >
                        <Select
                            value={dedupeDevices?.selectedDeviceKeyId ?? ''}
                            disabled={busy || !dedupeDevices?.devices.length}
                            onValueChange={(keyId) => {
                                if (keyId) void selectDedupeDevice(keyId);
                            }}
                        >
                            <SelectTrigger
                                size="sm"
                                aria-label={t(
                                    'view.settings.history_sync.dedupe_device'
                                )}
                            >
                                <SelectValue
                                    placeholder={t(
                                        'view.settings.history_sync.dedupe_device_empty'
                                    )}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {dedupeDevices?.devices.map((device) => (
                                    <SelectItem
                                        key={device.keyId}
                                        value={device.keyId}
                                    >
                                        {device.label} (
                                        {device.keyId.slice(0, 6)})
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                    <Field
                        label={t('view.settings.history_sync.sync_settings')}
                        description={t(
                            'view.settings.history_sync.sync_settings_description'
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <Switch
                                checked={syncSettingsEnabled}
                                disabled={busy || !settings}
                                onCheckedChange={setSyncSettingsEnabled}
                            />
                            <Button
                                type="button"
                                variant="outline"
                                disabled={
                                    busy ||
                                    syncSettingsEnabled ===
                                        settings?.syncSettingsEnabled
                                }
                                onClick={() =>
                                    void saveSettings(backend, {
                                        syncSettingsEnabled
                                    })
                                }
                            >
                                {t(
                                    'view.settings.history_sync.save_sync_settings'
                                )}
                            </Button>
                        </div>
                    </Field>
                    <Field label={t('view.settings.history_sync.api_url')}>
                        <input
                            className="bg-background h-9 w-full rounded-md border px-3 text-sm"
                            value={apiOrigin}
                            onChange={(event) =>
                                setApiOrigin(event.target.value)
                            }
                            spellCheck={false}
                        />
                    </Field>
                    <Field label={t('view.settings.history_sync.website_url')}>
                        <input
                            className="bg-background h-9 w-full rounded-md border px-3 text-sm"
                            value={websiteOrigin}
                            onChange={(event) =>
                                setWebsiteOrigin(event.target.value)
                            }
                            spellCheck={false}
                        />
                    </Field>
                    {apiOrigin !== settings?.apiOrigin ||
                    websiteOrigin !== settings?.websiteOrigin ? (
                        <div className="rounded-md border border-amber-500/50 p-3 text-sm">
                            <p>
                                {t(
                                    'view.settings.history_sync.server_change_warning'
                                )}
                            </p>
                            <label className="mt-2 flex items-start gap-2">
                                <input
                                    type="checkbox"
                                    checked={confirmServerChange}
                                    onChange={(event) =>
                                        setConfirmServerChange(
                                            event.target.checked
                                        )
                                    }
                                />
                                <span>
                                    {t(
                                        'view.settings.history_sync.server_change_confirm'
                                    )}
                                </span>
                            </label>
                        </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                                void saveSettings(backend, { server: true })
                            }
                        >
                            {t('view.settings.history_sync.save_server')}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                                setApiOrigin(OFFICIAL_API);
                                setWebsiteOrigin(OFFICIAL_WEBSITE);
                            }}
                        >
                            {t('view.settings.history_sync.reset_server')}
                        </Button>
                    </div>
                    {capabilities ? (
                        <p className="text-muted-foreground text-sm">
                            {t('view.settings.history_sync.server_identity', {
                                version: capabilities.version,
                                commit: capabilities.commit,
                                registration: capabilities.registration
                            })}
                        </p>
                    ) : null}
                    {!settings?.paired ? (
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                disabled={busy || Boolean(pairing)}
                                onClick={() => void pairThisPc()}
                            >
                                {t('view.settings.history_sync.pair_this_pc')}
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() =>
                                    window.open(
                                        `${websiteOrigin}/signup`,
                                        '_blank',
                                        'noopener,noreferrer'
                                    )
                                }
                            >
                                {t('view.settings.history_sync.create_account')}
                            </Button>
                        </div>
                    ) : (
                        <>
                            {account ? (
                                <div className="space-y-1 text-sm">
                                    <p>
                                        {t(
                                            'view.settings.history_sync.account',
                                            {
                                                accountId: account.accountId
                                            }
                                        )}
                                    </p>
                                    <p>
                                        {t('view.settings.history_sync.quota', {
                                            used: formatBytes(
                                                account.usageBytes
                                            ),
                                            quota:
                                                account.quotaBytes === null
                                                    ? t(
                                                          'view.settings.history_sync.unlimited'
                                                      )
                                                    : formatBytes(
                                                          account.quotaBytes
                                                      )
                                        })}
                                    </p>
                                    {account.quotaBytes !== null &&
                                    account.usageBytes >=
                                        account.quotaBytes * 0.8 ? (
                                        <p className="text-amber-600">
                                            {t(
                                                account.usageBytes >=
                                                    account.quotaBytes * 0.95
                                                    ? 'view.settings.history_sync.quota_almost_full'
                                                    : 'view.settings.history_sync.quota_warning'
                                            )}
                                        </p>
                                    ) : null}
                                    {!account.syncAllowed ? (
                                        <p className="text-destructive">
                                            {t(
                                                'view.settings.history_sync.sync_disabled'
                                            )}
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() =>
                                        window.open(
                                            websiteOrigin,
                                            '_blank',
                                            'noopener,noreferrer'
                                        )
                                    }
                                >
                                    {t(
                                        'view.settings.history_sync.manage_key_envelopes'
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => void refresh()}
                                >
                                    {t(
                                        'view.settings.history_sync.refresh_status'
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => void verifyWebsite()}
                                >
                                    {t(
                                        'view.settings.history_sync.verify_website'
                                    )}
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() => void signOut()}
                                >
                                    {t('view.settings.history_sync.sign_out')}
                                </Button>
                            </div>
                        </>
                    )}
                    {pairing ? (
                        <div className="rounded-md border p-3 text-sm">
                            <p className="font-medium">
                                {t('view.settings.history_sync.pairing_code', {
                                    code: pairing.userCode
                                })}
                            </p>
                            <a
                                className="text-primary underline"
                                href={pairing.verificationUri}
                                target="_blank"
                                rel="noreferrer"
                            >
                                {pairing.verificationUri}
                            </a>
                            <p className="text-muted-foreground mt-1">
                                {t(
                                    'view.settings.history_sync.pairing_waiting'
                                )}
                            </p>
                            <Button
                                className="mt-2"
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setPairing(undefined)}
                            >
                                {t('view.settings.history_sync.cancel_pairing')}
                            </Button>
                        </div>
                    ) : null}
                    {verification ? (
                        <div className="rounded-md border p-3 text-sm">
                            <p
                                className={
                                    verification.verified
                                        ? 'text-green-600'
                                        : 'text-amber-600'
                                }
                            >
                                {verification.verified
                                    ? t(
                                          'view.settings.history_sync.website_verified'
                                      )
                                    : t(
                                          'view.settings.history_sync.website_not_verified'
                                      )}
                            </p>
                            <p>{verification.detail}</p>
                            {verification.version ? (
                                <p className="text-muted-foreground">
                                    {t(
                                        'view.settings.history_sync.build_identity',
                                        {
                                            version: verification.version,
                                            commit:
                                                verification.sourceCommit ??
                                                'unknown',
                                            count: verification.filesChecked
                                        }
                                    )}
                                </p>
                            ) : null}
                        </div>
                    ) : null}
                    {error ? (
                        <p className="text-destructive text-sm">{error}</p>
                    ) : null}
                    {settings?.paired ? (
                        <SettingsHistorySyncPanel
                            collectorAvailable={
                                capabilities?.collectorAvailable ?? false
                            }
                            collectorAllowed={
                                account?.collectorAllowed ?? false
                            }
                            onSyncComplete={() => {
                                void invoke<DedupeDevices>(
                                    'app__remote_sync_dedupe_devices_get'
                                )
                                    .then(setDedupeDevices)
                                    .catch(() => setDedupeDevices(undefined));
                            }}
                        />
                    ) : null}
                </SettingsCard>
            ) : null}

            <SettingsSelfHostedRecorderCard
                historySyncEnabled={backend === 'remotesync'}
            />
        </SettingsTabContent>
    );
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unit = -1;
    do {
        size /= 1024;
        unit += 1;
    } while (size >= 1024 && unit < units.length - 1);
    return `${size.toFixed(1)} ${units[unit]}`;
}
