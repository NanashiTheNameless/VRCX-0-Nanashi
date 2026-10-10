import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { invoke } from '@/platform/tauri/generatedInvoke';
import { Button } from '@/ui/shadcn/button';

type Address = {
    ip: string;
    location: string;
    firstSeenMs: number;
    lastSeenMs: number;
};

type Client = {
    clientId: string;
    kind: string;
    label: string;
    clientVersion: string | null;
    current: boolean;
    activeNow: boolean;
    revoked: boolean;
    lastSeenMs: number | null;
    address: Address | null;
    history: Address[];
};

const INPUT_CLASS = 'bg-background h-9 w-full rounded-md border px-3 text-sm';
const DELETE_WORD = 'DELETE';

function useTask() {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string>();
    const run = useCallback(async (work: () => Promise<void>) => {
        setBusy(true);
        setError(undefined);
        try {
            await work();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setBusy(false);
        }
    }, []);
    return { busy, error, run };
}

// Receiving side of a key transfer, offered while this PC has no key yet.
export function SettingsHistorySyncReceiveKey({
    onReceived
}: {
    onReceived: () => void;
}) {
    const { t } = useTranslation();
    const { busy, error, run } = useTask();
    const [code, setCode] = useState<string>();

    useEffect(() => {
        if (!code) return;
        const timer = setInterval(() => {
            void invoke<boolean>('app__remote_sync_transfer_poll')
                .then((received) => {
                    if (received) {
                        setCode(undefined);
                        onReceived();
                    }
                })
                .catch(() => setCode(undefined));
        }, 3000);
        return () => clearInterval(timer);
    }, [code, onReceived]);

    return (
        <div className="space-y-2">
            <p className="text-muted-foreground">
                {t('view.settings.history_sync.transfer.receive_description')}
            </p>
            {code ? (
                <>
                    <p className="bg-muted rounded-md p-2 font-mono text-base select-all">
                        {code}
                    </p>
                    <p className="text-muted-foreground">
                        {t('view.settings.history_sync.transfer.waiting')}
                    </p>
                </>
            ) : (
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                        void run(async () => {
                            setCode(
                                await invoke<string>(
                                    'app__remote_sync_transfer_begin'
                                )
                            );
                        })
                    }
                >
                    {t('view.settings.history_sync.transfer.receive')}
                </Button>
            )}
            {error ? <p className="text-destructive">{error}</p> : null}
        </div>
    );
}

export function SettingsHistorySyncAccount({
    onChanged
}: {
    onChanged: () => void;
}) {
    const { t } = useTranslation();
    const { busy, error, run } = useTask();
    const [clients, setClients] = useState<Client[]>();
    const [historyOf, setHistoryOf] = useState<string>();
    const [code, setCode] = useState('');
    const [method, setMethod] = useState('totp');
    const [emailSent, setEmailSent] = useState(false);
    const [transferCode, setTransferCode] = useState('');
    const [transferSent, setTransferSent] = useState(false);
    const [deleteWord, setDeleteWord] = useState('');
    const [keepCollections, setKeepCollections] = useState(true);
    const [rotateWord, setRotateWord] = useState('');
    const [rotatedRecovery, setRotatedRecovery] = useState<string>();

    const loadClients = () =>
        run(async () => {
            setClients(await invoke<Client[]>('app__remote_sync_clients_get'));
        });
    const revoke = (clientId: string | null) =>
        run(async () => {
            await invoke('app__remote_sync_clients_revoke', {
                method,
                code,
                clientId
            });
            setCode('');
            setClients(await invoke<Client[]>('app__remote_sync_clients_get'));
        });

    return (
        <div className="space-y-4 rounded-md border p-3 text-sm">
            <div className="space-y-2">
                <p className="font-medium">
                    {t('view.settings.history_sync.transfer.send_title')}
                </p>
                <p className="text-muted-foreground">
                    {t('view.settings.history_sync.transfer.send_description')}
                </p>
                <input
                    className={INPUT_CLASS}
                    value={transferCode}
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    onChange={(event) => {
                        setTransferCode(event.target.value);
                        setTransferSent(false);
                    }}
                />
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !transferCode.trim()}
                    onClick={() =>
                        void run(async () => {
                            await invoke('app__remote_sync_transfer_send', {
                                code: transferCode
                            });
                            setTransferCode('');
                            setTransferSent(true);
                        })
                    }
                >
                    {t('view.settings.history_sync.transfer.send')}
                </Button>
                {transferSent ? (
                    <p className="text-green-600">
                        {t('view.settings.history_sync.transfer.sent')}
                    </p>
                ) : null}
            </div>

            <div className="space-y-2">
                <p className="font-medium">
                    {t('view.settings.history_sync.clients.title')}
                </p>
                <p className="text-muted-foreground">
                    {t('view.settings.history_sync.clients.description')}
                </p>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void loadClients()}
                >
                    {t('view.settings.history_sync.clients.load')}
                </Button>
                {clients ? (
                    <>
                        <ul className="space-y-2">
                            {clients.map((client) => (
                                <li
                                    key={client.clientId}
                                    className="rounded-md border p-2"
                                >
                                    <p className="font-medium">
                                        {client.label || client.clientId}
                                        {client.current
                                            ? ` (${t('view.settings.history_sync.clients.this_pc')})`
                                            : ''}
                                    </p>
                                    <p className="text-muted-foreground">
                                        {[
                                            client.clientVersion,
                                            client.revoked
                                                ? t(
                                                      'view.settings.history_sync.clients.revoked'
                                                  )
                                                : client.activeNow
                                                  ? t(
                                                        'view.settings.history_sync.clients.active'
                                                    )
                                                  : client.lastSeenMs
                                                    ? new Date(
                                                          client.lastSeenMs
                                                      ).toLocaleString()
                                                    : null,
                                            client.address
                                                ? `${client.address.ip} ${client.address.location}`
                                                : null
                                        ]
                                            .filter(Boolean)
                                            .join(' | ')}
                                    </p>
                                    {historyOf === client.clientId
                                        ? client.history.map((entry) => (
                                              <p
                                                  key={`${entry.ip}-${entry.firstSeenMs}`}
                                                  className="text-muted-foreground text-xs"
                                              >
                                                  {entry.ip} {entry.location}{' '}
                                                  {new Date(
                                                      entry.lastSeenMs
                                                  ).toLocaleString()}
                                              </p>
                                          ))
                                        : null}
                                    <div className="mt-1 flex flex-wrap gap-2">
                                        {client.history.length > 0 ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    setHistoryOf(
                                                        historyOf ===
                                                            client.clientId
                                                            ? undefined
                                                            : client.clientId
                                                    )
                                                }
                                            >
                                                {t(
                                                    'view.settings.history_sync.clients.history'
                                                )}
                                            </Button>
                                        ) : null}
                                        {!client.current && !client.revoked ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                disabled={busy || !code.trim()}
                                                onClick={() =>
                                                    void revoke(client.clientId)
                                                }
                                            >
                                                {t(
                                                    'view.settings.history_sync.clients.revoke'
                                                )}
                                            </Button>
                                        ) : null}
                                    </div>
                                </li>
                            ))}
                        </ul>
                        <p className="text-muted-foreground">
                            {t(
                                'view.settings.history_sync.clients.code_description'
                            )}
                        </p>
                        <input
                            className={INPUT_CLASS}
                            value={code}
                            autoComplete="one-time-code"
                            placeholder={t(
                                'view.settings.history_sync.clients.code_placeholder'
                            )}
                            onChange={(event) => setCode(event.target.value)}
                        />
                        <select
                            className={INPUT_CLASS}
                            value={method}
                            onChange={(event) => {
                                setMethod(event.target.value);
                                setCode('');
                                setEmailSent(false);
                            }}
                        >
                            <option value="totp">
                                {t(
                                    'view.settings.history_sync.clients.method_totp'
                                )}
                            </option>
                            <option value="email">
                                {t(
                                    'view.settings.history_sync.clients.method_email'
                                )}
                            </option>
                            <option value="recovery">
                                {t(
                                    'view.settings.history_sync.clients.method_recovery'
                                )}
                            </option>
                        </select>
                        {method === 'email' ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                    void run(async () => {
                                        await invoke(
                                            'app__remote_sync_email_code_send'
                                        );
                                        setEmailSent(true);
                                    })
                                }
                            >
                                {t(
                                    emailSent
                                        ? 'view.settings.history_sync.clients.email_resend'
                                        : 'view.settings.history_sync.clients.email_send'
                                )}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy || !code.trim()}
                            onClick={() => void revoke(null)}
                        >
                            {t(
                                'view.settings.history_sync.clients.revoke_others'
                            )}
                        </Button>
                    </>
                ) : null}
            </div>

            <div className="space-y-2">
                <p className="text-destructive font-medium">
                    {t('view.settings.history_sync.rotate.title')}
                </p>
                <p className="text-muted-foreground">
                    {t('view.settings.history_sync.rotate.description')}
                </p>
                <input
                    className={INPUT_CLASS}
                    value={rotateWord}
                    onChange={(event) => setRotateWord(event.target.value)}
                    placeholder="ROTATE"
                />
                <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy || rotateWord !== 'ROTATE' || !code.trim()}
                    onClick={() =>
                        void run(async () => {
                            setRotatedRecovery(
                                await invoke<string>(
                                    'app__remote_sync_key_rotate',
                                    { method, code }
                                )
                            );
                            setRotateWord('');
                            setCode('');
                            onChanged();
                        })
                    }
                >
                    {t('view.settings.history_sync.rotate.confirm')}
                </Button>
                {rotatedRecovery ? (
                    <div className="space-y-2 rounded-md border p-3">
                        <p>
                            {t(
                                'view.settings.history_sync.rotate.recovery_warning'
                            )}
                        </p>
                        <code className="bg-muted block rounded p-2 break-all select-all">
                            {rotatedRecovery}
                        </code>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => setRotatedRecovery(undefined)}
                        >
                            {t('view.settings.history_sync.rotate.saved')}
                        </Button>
                    </div>
                ) : null}
            </div>

            <div className="space-y-2">
                <p className="text-destructive font-medium">
                    {t('view.settings.history_sync.delete.title')}
                </p>
                <p className="text-muted-foreground">
                    {t('view.settings.history_sync.delete.description', {
                        word: DELETE_WORD
                    })}
                </p>
                <label className="flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={keepCollections}
                        onChange={(event) =>
                            setKeepCollections(event.target.checked)
                        }
                    />
                    {t('view.settings.history_sync.delete.keep_collections')}
                </label>
                <input
                    className={INPUT_CLASS}
                    value={deleteWord}
                    onChange={(event) => setDeleteWord(event.target.value)}
                />
                <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy || deleteWord !== DELETE_WORD}
                    onClick={() =>
                        void run(async () => {
                            await invoke('app__remote_sync_delete_data', {
                                keepCollections
                            });
                            setDeleteWord('');
                            onChanged();
                        })
                    }
                >
                    {t('view.settings.history_sync.delete.confirm')}
                </Button>
            </div>
            {error ? <p className="text-destructive">{error}</p> : null}
        </div>
    );
}
