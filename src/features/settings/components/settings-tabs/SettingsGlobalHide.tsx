import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands, type GlobalHideStatus } from '@/platform/tauri/bindings';
import { useModalStore } from '@/state/modalStore';
import { Button } from '@/ui/shadcn/button';

const P = 'view.settings.safety.global_hide';
const POLL_MS = 15_000;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Fork: status and controls for the throttled global-hide job. Unblocking is
// a separate, explicit, reviewed action; turning the option off never unblocks.
export function SettingsGlobalHide() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<GlobalHideStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        const load = () =>
            commands
                .appSafetyGlobalHideStatus()
                .then((result) => {
                    if (active) setStatus(result);
                })
                .catch(() => {});
        void load();
        const timer = window.setInterval(() => void load(), POLL_MS);
        return () => {
            active = false;
            window.clearInterval(timer);
        };
    }, []);

    if (!status || (!status.sourceNames.length && !status.blockedByApp)) {
        return null;
    }

    async function run(action: () => Promise<GlobalHideStatus>) {
        setBusy(true);
        setError('');
        try {
            setStatus(await action());
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            setBusy(false);
        }
    }

    async function unblockAll() {
        setBusy(true);
        setError('');
        try {
            const preview = await commands.appSafetyGlobalHideUnblockPreview();
            if (!preview.ids.length) {
                setError(t(`${P}.nothing_to_unblock`));
                return;
            }
            const result = await useModalStore.getState().confirm({
                title: t(`${P}.unblock_title`),
                description: t(`${P}.unblock_description`, {
                    count: preview.ids.length
                }),
                confirmText: t(`${P}.unblock_confirm`),
                cancelText: t(`${P}.cancel`)
            });
            if (!result.ok) {
                return;
            }
            setStatus(
                await commands.appSafetyGlobalHideUnblockStart(preview.token)
            );
        } catch (cause) {
            setError(errorMessage(cause));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-2 rounded-md border p-3 text-sm">
            <p className="font-medium">{t(`${P}.header`)}</p>
            {!status.signedIn ? (
                <p className="text-muted-foreground">{t(`${P}.sign_in`)}</p>
            ) : (
                <>
                    <p className="text-muted-foreground">
                        {t(`${P}.summary`, {
                            blocked: status.blockedByApp,
                            pending: status.pending,
                            already: status.alreadyBlocked,
                            skipped: status.skipped,
                            listed: status.listed
                        })}
                    </p>
                    <p className="text-muted-foreground">
                        {t(`${P}.today`, {
                            today: status.today,
                            cap: status.dailyCap
                        })}
                    </p>
                    {status.paused ? (
                        <p>{t(`${P}.paused`)}</p>
                    ) : status.backoffUntil ? (
                        <p>
                            {t(`${P}.backoff`, {
                                until: new Date(
                                    status.backoffUntil
                                ).toLocaleString()
                            })}
                        </p>
                    ) : null}
                    {status.lastError ? (
                        <p className="text-destructive">
                            {t(`${P}.last_error`, { error: status.lastError })}
                        </p>
                    ) : null}
                    {status.unblockRemaining ? (
                        <p>
                            {t(`${P}.unblocking`, {
                                count: status.unblockRemaining
                            })}
                        </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                                void run(() =>
                                    commands.appSafetyGlobalHideSetPaused(
                                        !status.paused
                                    )
                                )
                            }
                        >
                            {status.paused ? t(`${P}.resume`) : t(`${P}.pause`)}
                        </Button>
                        {status.unblockRemaining ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                    void run(() =>
                                        commands.appSafetyGlobalHideUnblockCancel()
                                    )
                                }
                            >
                                {t(`${P}.stop_unblock`)}
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={busy || !status.blockedByApp}
                                onClick={() => void unblockAll()}
                            >
                                {t(`${P}.unblock_button`)}
                            </Button>
                        )}
                    </div>
                </>
            )}
            {error ? <p className="text-destructive">{error}</p> : null}
        </div>
    );
}
