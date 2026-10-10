import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '@/platform/tauri/generatedInvoke';
import { Button } from '@/ui/shadcn/button';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';
import { SettingsTabContent } from '../SettingsViewParts';
import { SettingsHistorySyncPanel } from './SettingsHistorySyncPanel';
import { SettingsHistorySyncTrust } from './SettingsHistorySyncTrust';

type SettingsSnapshot = {
    backend: string;
    apiOrigin: string;
    websiteOrigin: string;
    paired: boolean;
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

type PairingPoll =
    | { status: 'pending'; value: { intervalSeconds: number } }
    | { status: 'approved'; value: { accountId: string } };

type WebsiteVerification = {
    verified: boolean;
    version: string | null;
    sourceCommit: string | null;
    filesChecked: number;
    detail: string;
};

const OFFICIAL_API = 'https://vrcx-api.namelessnanashi.dev';
const OFFICIAL_WEBSITE = 'https://vrcx.namelessnanashi.dev';

export function SettingsHistorySyncTab() {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<SettingsSnapshot>();
    const [capabilities, setCapabilities] = useState<Capabilities>();
    const [account, setAccount] = useState<Account>();
    const [apiOrigin, setApiOrigin] = useState(OFFICIAL_API);
    const [websiteOrigin, setWebsiteOrigin] = useState(OFFICIAL_WEBSITE);
    const [pairing, setPairing] = useState<PairingStart>();
    const [pollInterval, setPollInterval] = useState(5);
    const [pairStartedAt, setPairStartedAt] = useState<number>();
    const [confirmServerChange, setConfirmServerChange] = useState(false);
    const [busy, setBusy] = useState(false);
    const [verification, setVerification] = useState<WebsiteVerification>();
    const [error, setError] = useState<string>();

    const refresh = useCallback(async () => {
        try {
            const snapshot = await invoke<SettingsSnapshot>(
                'app__remote_sync_settings_get'
            );
            setSettings(snapshot);
            setApiOrigin(snapshot.apiOrigin);
            setWebsiteOrigin(snapshot.websiteOrigin);
            if (snapshot.backend === 'remotesync') {
                const capabilitySnapshot = await invoke<Capabilities>(
                    'app__remote_sync_capabilities_get'
                );
                setCapabilities(capabilitySnapshot);
                if (snapshot.paired) {
                    setAccount(
                        await invoke<Account>('app__remote_sync_account_get')
                    );
                }
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
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
                const result = await invoke<PairingPoll>(
                    'app__remote_sync_pair_poll',
                    {
                        deviceCode: pairing.deviceCode,
                        intervalSeconds: pollInterval
                    }
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
                setPollInterval(result.value.intervalSeconds);
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

    async function saveSettings(backend: string) {
        setBusy(true);
        setError(undefined);
        try {
            const isChangingServer =
                apiOrigin !== settings?.apiOrigin ||
                websiteOrigin !== settings?.websiteOrigin;
            if (isChangingServer && !confirmServerChange) {
                return;
            }
            const checked =
                backend === 'remotesync'
                    ? await invoke<Capabilities>(
                          'app__remote_sync_server_validate',
                          { apiOrigin }
                      )
                    : undefined;
            const nextWebsiteOrigin =
                checked?.websiteOrigins[0] &&
                websiteOrigin === settings?.websiteOrigin
                    ? checked.websiteOrigins[0]
                    : websiteOrigin;
            await invoke('app__remote_sync_settings_set', {
                backend,
                apiOrigin,
                websiteOrigin: nextWebsiteOrigin
            });
            setWebsiteOrigin(nextWebsiteOrigin);
            if (checked) setCapabilities(checked);
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

    async function signOut() {
        setBusy(true);
        try {
            await invoke('app__remote_sync_sign_out');
            setAccount(undefined);
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
                    label={t('view.settings.history_sync.backend')}
                    description={t(
                        'view.settings.history_sync.backend_description'
                    )}
                >
                    <select
                        className="bg-background h-9 rounded-md border px-3 text-sm"
                        value={backend}
                        disabled={busy}
                        onChange={(event) =>
                            void saveSettings(event.target.value)
                        }
                    >
                        <option value="off">
                            {t('view.settings.history_sync.off')}
                        </option>
                        <option value="remotesync">
                            {t('view.settings.history_sync.remotesync')}
                        </option>
                    </select>
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
                            onClick={() => void saveSettings(backend)}
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
                        />
                    ) : null}
                </SettingsCard>
            ) : null}
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
