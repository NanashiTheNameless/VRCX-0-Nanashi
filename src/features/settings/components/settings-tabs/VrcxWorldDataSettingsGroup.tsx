import { DatabaseIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsCard } from '@/components/layout/SettingsCard';
import { cn } from '@/lib/utils';
import {
    commands,
    type WorldDataEntry,
    type WorldDataStatus,
    type WorldDataWorld
} from '@/platform/tauri/bindings';
import { openWorldDialog } from '@/services/dialogService';
import { toast } from '@/services/toastService';
import { useModalStore } from '@/state/modalStore';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '@/ui/shadcn/dialog';
import {
    NumberField,
    NumberFieldDecrement,
    NumberFieldGroup,
    NumberFieldIncrement,
    NumberFieldInput
} from '@/ui/shadcn/number-field';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from '../SettingsField';

const DEFAULT_PORT = 22500;
const STATUS_POLL_MS = 5000;

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function WorldDataViewer() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [worlds, setWorlds] = useState<WorldDataWorld[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [entries, setEntries] = useState<WorldDataEntry[]>([]);
    const [busy, setBusy] = useState(false);

    const loadWorlds = useCallback(async () => {
        setBusy(true);
        try {
            setWorlds(await commands.appVrcxWorldDataWorlds());
        } catch (error: unknown) {
            toast.add({ type: 'error', title: errorMessage(error) });
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => {
        if (open) {
            void loadWorlds();
        } else {
            setSelected(null);
            setEntries([]);
        }
    }, [open, loadWorlds]);

    async function selectWorld(worldId: string) {
        setSelected(worldId);
        try {
            setEntries(await commands.appVrcxWorldDataEntries(worldId));
        } catch (error: unknown) {
            toast.add({ type: 'error', title: errorMessage(error) });
        }
    }

    async function forgetWorld(worldId: string) {
        setBusy(true);
        try {
            await commands.appVrcxWorldDataForget(worldId);
            if (selected === worldId) {
                setSelected(null);
                setEntries([]);
            }
            setWorlds(await commands.appVrcxWorldDataWorlds());
        } catch (error: unknown) {
            toast.add({ type: 'error', title: errorMessage(error) });
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
                render={
                    <Button type="button" variant="outline" size="sm">
                        <DatabaseIcon data-icon="inline-start" />
                        {t('view.settings.integrations.world_data.view')}
                    </Button>
                }
            />
            <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>
                        {t(
                            'view.settings.integrations.world_data.viewer_title'
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {t(
                            'view.settings.integrations.world_data.viewer_description'
                        )}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid max-h-[60vh] min-h-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                    <div className="min-h-0 overflow-y-auto rounded-md border">
                        {worlds.length === 0 ? (
                            <p className="text-muted-foreground p-3 text-sm">
                                {busy
                                    ? t('common.loading')
                                    : t(
                                          'view.settings.integrations.world_data.empty'
                                      )}
                            </p>
                        ) : (
                            worlds.map((world) => (
                                <div
                                    key={world.worldId}
                                    className={cn(
                                        'flex items-center gap-2 border-b px-3 py-2 last:border-b-0',
                                        selected === world.worldId &&
                                            'bg-muted/60'
                                    )}
                                >
                                    <button
                                        type="button"
                                        className="min-w-0 flex-1 text-left"
                                        onClick={() => {
                                            void selectWorld(world.worldId);
                                        }}
                                    >
                                        <span className="block truncate font-mono text-xs">
                                            {world.worldId}
                                        </span>
                                        <span className="text-muted-foreground text-xs">
                                            {t(
                                                'view.settings.integrations.world_data.world_summary',
                                                {
                                                    count: world.entryCount,
                                                    size: formatBytes(
                                                        world.totalDataSize
                                                    )
                                                }
                                            )}
                                            {world.allowExternalRead
                                                ? ` - ${t('view.settings.integrations.world_data.shared')}`
                                                : ''}
                                        </span>
                                    </button>
                                    {world.worldId.startsWith('wrld_') ? (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() =>
                                                openWorldDialog({
                                                    worldId: world.worldId
                                                })
                                            }
                                        >
                                            {t('common.actions.open')}
                                        </Button>
                                    ) : null}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        disabled={busy}
                                        aria-label={t(
                                            'view.settings.integrations.world_data.forget'
                                        )}
                                        title={t(
                                            'view.settings.integrations.world_data.forget'
                                        )}
                                        onClick={() => {
                                            void forgetWorld(world.worldId);
                                        }}
                                    >
                                        <Trash2Icon />
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="min-h-0 overflow-y-auto rounded-md border">
                        {selected === null ? (
                            <p className="text-muted-foreground p-3 text-sm">
                                {t(
                                    'view.settings.integrations.world_data.select_world'
                                )}
                            </p>
                        ) : entries.length === 0 ? (
                            <p className="text-muted-foreground p-3 text-sm">
                                {t(
                                    'view.settings.integrations.world_data.no_entries'
                                )}
                            </p>
                        ) : (
                            entries.map((entry) => (
                                <div
                                    key={entry.key}
                                    className="border-b px-3 py-2 last:border-b-0"
                                >
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="min-w-0 flex-1 truncate font-mono font-medium">
                                            {entry.key}
                                        </span>
                                        <span className="text-muted-foreground">
                                            {formatBytes(entry.valueSize)}
                                        </span>
                                    </div>
                                    <pre className="text-muted-foreground mt-1 max-h-32 overflow-auto text-xs break-all whitespace-pre-wrap">
                                        {entry.value}
                                    </pre>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function WorldDataImport() {
    const { t } = useTranslation();
    const [vrcxFile, setVrcxFile] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let active = true;
        commands
            .appVrcxWorldDataImportSource()
            .then((path) => {
                if (active) {
                    setVrcxFile(path);
                }
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);

    async function runImport(path: string | null) {
        const confirmed = await useModalStore.getState().confirm({
            title: t(
                'view.settings.integrations.world_data.import_confirm_title'
            ),
            description: t(
                'view.settings.integrations.world_data.import_confirm_description',
                { path: path ?? vrcxFile ?? '' }
            ),
            confirmText: t('view.settings.integrations.world_data.import'),
            cancelText: t('common.actions.cancel')
        });
        if (!confirmed.ok) {
            return;
        }
        setBusy(true);
        try {
            const report = await commands.appVrcxWorldDataImport(path);
            toast.add({
                type: 'success',
                title: t('view.settings.integrations.world_data.import_done', {
                    worlds: report.worldsAdded,
                    values: report.entriesAdded,
                    skipped: report.entriesSkipped
                })
            });
        } catch (error: unknown) {
            toast.add({ type: 'error', title: errorMessage(error) });
        } finally {
            setBusy(false);
        }
    }

    async function chooseFile() {
        const path = await commands.appOpenFileSelectorDialog(
            null,
            null,
            'Database|*.db;*.sqlite;*.sqlite3'
        );
        if (typeof path === 'string' && path.trim()) {
            await runImport(path);
        }
    }

    return (
        <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !vrcxFile}
                onClick={() => {
                    void runImport(null);
                }}
            >
                {t('view.settings.integrations.world_data.import_vrcx')}
            </Button>
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                    void chooseFile();
                }}
            >
                {t('view.settings.integrations.world_data.import_file')}
            </Button>
        </div>
    );
}

export function VrcxWorldDataSettingsGroup() {
    const { t } = useTranslation();
    const [status, setStatus] = useState<WorldDataStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [portInput, setPortInput] = useState(String(DEFAULT_PORT));

    const applyStatus = useCallback((next: WorldDataStatus) => {
        setStatus(next);
        setPortInput(String(next.port));
    }, []);

    useEffect(() => {
        let active = true;
        commands
            .appVrcxWorldDataStatus()
            .then((next) => {
                if (active) {
                    applyStatus(next);
                }
            })
            .catch(() => {});
        // Show a server that stopped on its own without resetting the port
        // being typed.
        const timer = setInterval(() => {
            commands
                .appVrcxWorldDataStatus()
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

    async function save(enabled: boolean, port: number) {
        setBusy(true);
        try {
            const next = await commands.appVrcxWorldDataSetSettings({
                enabled,
                port
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

    function applyPort() {
        const port = Number(portInput);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) {
            toast.add({
                type: 'error',
                title: t('view.settings.integrations.world_data.port_invalid')
            });
            return;
        }
        void save(status?.enabled === true, port);
    }

    const enabled = status?.enabled === true;
    const stateKey = status?.running
        ? 'running'
        : status?.error
          ? 'error'
          : 'disabled';

    return (
        <SettingsCard
            cardId="integrations.world-data"
            title={t('view.settings.integrations.world_data.header')}
            description={t('view.settings.integrations.world_data.description')}
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
                        `view.settings.integrations.world_data.status.${stateKey}`
                    )}
                </Badge>
            }
        >
            <Field
                settingId="integrations.world-data.enabled"
                label={t('view.settings.integrations.world_data.enable')}
                description={t(
                    'view.settings.integrations.world_data.enable_description'
                )}
            >
                <Switch
                    checked={enabled}
                    disabled={busy || !status}
                    onCheckedChange={(checked) => {
                        void save(checked, status?.port ?? DEFAULT_PORT);
                    }}
                />
            </Field>

            <Field
                settingId="integrations.world-data.port"
                label={t('view.settings.integrations.world_data.port_label')}
                description={t(
                    'view.settings.integrations.world_data.port_description'
                )}
                error={status?.error ?? undefined}
            >
                <div className="flex items-center gap-2">
                    <NumberField
                        min={1024}
                        max={65535}
                        allowOutOfRange
                        value={portInput === '' ? null : Number(portInput)}
                        disabled={busy}
                        onValueChange={(value) =>
                            setPortInput(value === null ? '' : String(value))
                        }
                        className="w-40"
                    >
                        <NumberFieldGroup>
                            <NumberFieldDecrement />
                            <NumberFieldInput />
                            <NumberFieldIncrement />
                        </NumberFieldGroup>
                    </NumberField>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={applyPort}
                    >
                        {t('view.settings.integrations.world_data.port_apply')}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        aria-label={t('common.actions.refresh')}
                        title={t('common.actions.refresh')}
                        onClick={() => {
                            void commands
                                .appVrcxWorldDataStatus()
                                .then(applyStatus)
                                .catch(() => {});
                        }}
                    >
                        <RefreshCwIcon />
                    </Button>
                </div>
            </Field>

            <Field
                settingId="integrations.world-data.stored"
                label={t('view.settings.integrations.world_data.stored')}
                description={t(
                    'view.settings.integrations.world_data.stored_description'
                )}
            >
                <WorldDataViewer />
            </Field>

            <Field
                settingId="integrations.world-data.import"
                label={t('view.settings.integrations.world_data.import_label')}
                description={t(
                    'view.settings.integrations.world_data.import_description'
                )}
            >
                <WorldDataImport />
            </Field>
        </SettingsCard>
    );
}
