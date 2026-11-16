import { RefreshCwIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { commands, type IpcStatus } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

const STATUS_POLL_MS = 5000;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function VrcxIpcSettingsGroup() {
    const { t } = useTranslation();
    const usesSocket = useRuntimeStore((state) => {
        const platform = state.hostCapabilities.platform;
        return platform === 'linux' || platform === 'macos';
    });
    const [status, setStatus] = useState<IpcStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [pipeName, setPipeName] = useState('');
    const [socketPath, setSocketPath] = useState('');
    const [savedPipeName, setSavedPipeName] = useState('');
    const [savedSocketPath, setSavedSocketPath] = useState('');

    const applyStatus = useCallback((next: IpcStatus) => {
        setStatus(next);
        setPipeName(next.pipeName);
        setSavedPipeName(next.pipeName);
        setSocketPath(next.socketPath);
        setSavedSocketPath(next.socketPath);
    }, []);

    useEffect(() => {
        let active = true;
        commands
            .appVrcxIpcStatus()
            .then((next) => {
                if (active) {
                    applyStatus(next);
                }
            })
            .catch(() => {});
        // Keep the connected-program count and a stopped pipe current
        // without touching what is being typed.
        const timer = setInterval(() => {
            commands
                .appVrcxIpcStatus()
                .then((next) => {
                    if (active) {
                        setStatus(next);
                    }
                })
                .catch(() => {});
        }, STATUS_POLL_MS);
        return () => {
            active = false;
            clearInterval(timer);
        };
    }, [applyStatus]);

    async function save(enabled: boolean, name: string, path: string) {
        setBusy(true);
        try {
            const next = await commands.appVrcxIpcSetSettings({
                enabled,
                pipeName: name.trim(),
                socketPath: path.trim()
            });
            applyStatus(next);
            if (next.error) {
                toast.add({ type: 'error', title: next.error });
            }
        } catch (error: unknown) {
            toast.add({ type: 'error', title: errorMessage(error) });
        } finally {
            setBusy(false);
        }
    }

    async function refresh() {
        try {
            applyStatus(await commands.appVrcxIpcStatus());
        } catch (error: unknown) {
            toast.add({ type: 'error', title: errorMessage(error) });
        }
    }

    const enabled = status?.enabled === true;
    const stateKey = status?.running
        ? 'running'
        : status?.error
          ? 'error'
          : enabled
            ? 'stopped'
            : 'disabled';
    const addressChanged =
        pipeName.trim() !== savedPipeName ||
        (usesSocket && socketPath.trim() !== savedSocketPath);

    return (
        <SettingsCard
            cardId="integrations.vrcx-ipc"
            title={t('view.settings.integrations.vrcx_ipc.header')}
            description={t('view.settings.integrations.vrcx_ipc.description')}
            action={
                <Badge
                    variant="outline"
                    className={cn(
                        'mt-0.5 gap-1.5',
                        stateKey === 'error' && 'text-destructive'
                    )}
                >
                    <span
                        aria-hidden="true"
                        className={cn(
                            'bg-muted-foreground/40 size-1.5 rounded-full',
                            stateKey === 'running' && 'bg-emerald-500',
                            stateKey === 'error' && 'bg-destructive'
                        )}
                    />
                    {t(
                        `view.settings.integrations.vrcx_ipc.status.${stateKey}`
                    )}
                </Badge>
            }
        >
            <Field
                settingId="integrations.vrcx-ipc.enabled"
                label={t('view.settings.integrations.vrcx_ipc.enable')}
                description={t(
                    'view.settings.integrations.vrcx_ipc.enable_description'
                )}
            >
                <Switch
                    checked={enabled}
                    disabled={busy || !status}
                    onCheckedChange={(checked) => {
                        void save(checked, savedPipeName, savedSocketPath);
                    }}
                />
            </Field>

            <Field
                settingId="integrations.vrcx-ipc.pipe-name"
                label={t('view.settings.integrations.vrcx_ipc.pipe_name')}
                description={t(
                    'view.settings.integrations.vrcx_ipc.pipe_name_description',
                    { name: status?.defaultPipeName ?? '' }
                )}
            >
                <Input
                    value={pipeName}
                    placeholder={status?.defaultPipeName ?? ''}
                    disabled={busy}
                    onChange={(event) => setPipeName(event.target.value)}
                    className="w-64 font-mono"
                />
            </Field>

            {usesSocket ? (
                <Field
                    settingId="integrations.vrcx-ipc.socket-path"
                    label={t('view.settings.integrations.vrcx_ipc.socket_path')}
                    description={t(
                        'view.settings.integrations.vrcx_ipc.socket_path_description',
                        { path: status?.defaultSocketPath ?? '' }
                    )}
                >
                    <Input
                        value={socketPath}
                        placeholder={status?.defaultSocketPath ?? ''}
                        disabled={busy}
                        onChange={(event) => setSocketPath(event.target.value)}
                        className="w-72 font-mono"
                    />
                </Field>
            ) : null}

            <Field
                settingId="integrations.vrcx-ipc.status"
                label={t('view.settings.integrations.vrcx_ipc.status_label')}
                description={t(
                    'view.settings.integrations.vrcx_ipc.status_description',
                    {
                        address: status?.address ?? '',
                        count: status?.connectedClients ?? 0
                    }
                )}
                error={status?.error ?? undefined}
            >
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {addressChanged ? (
                        <Button
                            type="button"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                                void save(enabled, pipeName, socketPath);
                            }}
                        >
                            {t('view.settings.integrations.vrcx_ipc.apply')}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                            void refresh();
                        }}
                    >
                        <RefreshCwIcon data-icon="inline-start" />
                        {t('common.actions.refresh')}
                    </Button>
                </div>
            </Field>
        </SettingsCard>
    );
}
