import { ChevronRightIcon, RotateCcwIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type RemoteSyncSettingGroup
} from '@/platform/tauri/bindings';
import { ConfigKeys } from '@/repositories/configKeys';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';
import {
    Field,
    FieldContent,
    FieldDescription,
    FieldGroup,
    FieldLabel
} from '@/ui/shadcn/field';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Switch } from '@/ui/shadcn/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { syncSettingLabels } from './syncSettingLabels';

const KEY_PREFIX = 'config:vrcx_';
const SETTING_NAMES = 'view.settings.history_sync.setting_names';

const settingNames = new Map(
    Object.keys(ConfigKeys).map((name) => [
        name.replace(/^VRCX_/, '').toLowerCase(),
        name
    ])
);

function configName(key: string) {
    return key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;
}

// Only for a key that has no label anywhere, such as one added since.
function fallbackName(name: string) {
    const words = (settingNames.get(name) ?? name)
        .replace(/_/g, ' ')
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function syncedCount(group: RemoteSyncSettingGroup) {
    return group.settings.filter((setting) => setting.synced).length;
}

function choicesFrom(groups: RemoteSyncSettingGroup[]) {
    return {
        excludedGroups: groups
            .filter((group) => !group.enabled)
            .map((group) => group.id),
        keyOverrides: Object.fromEntries(
            groups.flatMap((group) =>
                group.settings
                    .filter((setting) => setting.synced !== group.enabled)
                    .map((setting) => [setting.key, setting.synced])
            )
        )
    };
}

export function SettingsHistorySyncSettingChoices({
    disabled
}: {
    disabled: boolean;
}) {
    const { t } = useTranslation();
    const [groups, setGroups] = useState<RemoteSyncSettingGroup[]>([]);
    const [draft, setDraft] = useState<RemoteSyncSettingGroup[]>([]);
    const [open, setOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<string>();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();

    const report = useCallback((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
    }, []);

    useEffect(() => {
        commands.appRemoteSyncSettingGroupsGet().then(setGroups).catch(report);
    }, [report]);

    const openDialog = () => {
        setDraft(groups);
        setError(undefined);
        setOpen(true);
    };

    const updateGroup = (
        id: string,
        update: (group: RemoteSyncSettingGroup) => RemoteSyncSettingGroup
    ) =>
        setDraft((current) =>
            current.map((group) => (group.id === id ? update(group) : group))
        );

    const setGroup = (id: string, enabled: boolean) =>
        updateGroup(id, (group) => ({
            ...group,
            enabled,
            settings: group.settings.map((setting) => ({
                ...setting,
                synced: enabled
            }))
        }));

    const setSetting = (id: string, key: string, synced: boolean) =>
        updateGroup(id, (group) => ({
            ...group,
            settings: group.settings.map((setting) =>
                setting.key === key ? { ...setting, synced } : setting
            )
        }));

    const resetAll = () =>
        setDraft((current) =>
            current.map((group) => ({
                ...group,
                enabled: true,
                settings: group.settings.map((setting) => ({
                    ...setting,
                    synced: true
                }))
            }))
        );

    const saveDraft = async () => {
        setSaving(true);
        setError(undefined);
        try {
            await commands.appRemoteSyncSettingChoicesSet(choicesFrom(draft));
            setGroups(draft);
            setOpen(false);
        } catch (cause) {
            report(cause);
        } finally {
            setSaving(false);
        }
    };

    const groupLabel = (id: string) =>
        t(`view.settings.history_sync.setting_groups.${id}`);
    const countLabel = (list: RemoteSyncSettingGroup[]) =>
        t('view.settings.history_sync.setting_choices_count', {
            synced: list.reduce((sum, group) => sum + syncedCount(group), 0),
            total: list.reduce((sum, group) => sum + group.settings.length, 0)
        });
    const selected = draft.find((group) => group.id === selectedId) ?? draft[0];
    const rows = (selected?.settings ?? [])
        .map((setting) => {
            const name = configName(setting.key);
            const [label, section] = syncSettingLabels[name] ?? [];
            const namePath = `${SETTING_NAMES}.${name}`;
            const ownName = t(namePath);
            return {
                ...setting,
                label: label
                    ? t(label)
                    : ownName !== namePath
                      ? ownName
                      : fallbackName(name),
                section: section ? t(section) : undefined
            };
        })
        .sort((a, b) => a.label.localeCompare(b.label));

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
                <Button
                    type="button"
                    variant="outline"
                    disabled={disabled || !groups.length}
                    onClick={openDialog}
                >
                    {t('common.actions.configure')}
                </Button>
                {groups.length ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                        {countLabel(groups)}
                    </span>
                ) : null}
            </div>
            {error && !open ? (
                <p className="text-destructive text-sm">{error}</p>
            ) : null}

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="grid h-[min(85vh,48rem)] max-h-[85vh] w-[min(94vw,56rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-4xl">
                    <DialogHeader>
                        <DialogTitle>
                            {t('view.settings.history_sync.setting_choices')}
                        </DialogTitle>
                        <DialogDescription>
                            {t(
                                'view.settings.history_sync.setting_choices_description'
                            )}
                        </DialogDescription>
                    </DialogHeader>

                    {selected ? (
                        <Tabs
                            orientation="vertical"
                            value={selected.id}
                            onValueChange={(value) =>
                                setSelectedId(String(value))
                            }
                            className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] grid-rows-[minmax(0,1fr)] gap-3 overflow-hidden sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-5"
                        >
                            <ScrollArea className="h-full min-w-0 border-r pr-3">
                                <TabsList className="h-fit w-full min-w-0 gap-1">
                                    {draft.map((group) => (
                                        <TabsTrigger
                                            key={group.id}
                                            value={group.id}
                                            className="h-auto w-full min-w-0 justify-between gap-3 px-3 py-2.5 text-left whitespace-normal sm:h-auto"
                                        >
                                            <span className="flex min-w-0 flex-1 flex-col items-start gap-1 [overflow-wrap:anywhere]">
                                                <span className="font-medium">
                                                    {groupLabel(group.id)}
                                                </span>
                                                <span className="text-muted-foreground text-xs font-normal tabular-nums">
                                                    {countLabel([group])}
                                                </span>
                                            </span>
                                            <ChevronRightIcon
                                                data-icon="inline-end"
                                                className="shrink-0"
                                            />
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </ScrollArea>

                            <TabsContent
                                value={selected.id}
                                className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3"
                            >
                                <div className="flex min-w-0 items-center justify-between gap-4 border-b pb-3">
                                    <span className="flex min-w-0 flex-col gap-1">
                                        <span className="font-semibold">
                                            {groupLabel(selected.id)}
                                        </span>
                                        <span className="text-muted-foreground text-sm">
                                            {t(
                                                'view.settings.history_sync.setting_choices_group'
                                            )}
                                        </span>
                                    </span>
                                    <Switch
                                        aria-label={t(
                                            'view.settings.history_sync.setting_choices_group'
                                        )}
                                        checked={selected.enabled}
                                        onCheckedChange={(enabled) =>
                                            setGroup(selected.id, enabled)
                                        }
                                    />
                                </div>

                                <ScrollArea className="min-h-0 min-w-0 pr-2">
                                    <FieldGroup className="gap-0 rounded-lg border">
                                        {rows.map((setting) => (
                                            <Field
                                                key={setting.key}
                                                orientation="horizontal"
                                                className="items-center gap-3 border-b px-3 py-2.5 last:border-b-0"
                                            >
                                                <FieldContent className="min-w-0">
                                                    <FieldLabel className="max-w-full min-w-0 [overflow-wrap:anywhere] whitespace-normal">
                                                        {setting.label}
                                                    </FieldLabel>
                                                    {setting.section ? (
                                                        <FieldDescription className="[overflow-wrap:anywhere]">
                                                            {setting.section}
                                                        </FieldDescription>
                                                    ) : null}
                                                </FieldContent>
                                                <Switch
                                                    aria-label={setting.label}
                                                    checked={setting.synced}
                                                    onCheckedChange={(synced) =>
                                                        setSetting(
                                                            selected.id,
                                                            setting.key,
                                                            synced
                                                        )
                                                    }
                                                />
                                            </Field>
                                        ))}
                                    </FieldGroup>
                                </ScrollArea>
                            </TabsContent>
                        </Tabs>
                    ) : null}

                    <DialogFooter className="sm:justify-between">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={resetAll}
                        >
                            <RotateCcwIcon data-icon="inline-start" />
                            {t('common.actions.reset')}
                        </Button>
                        <div className="flex items-center gap-2">
                            {error ? (
                                <span className="text-destructive text-sm">
                                    {error}
                                </span>
                            ) : null}
                            <DialogClose
                                render={
                                    <Button type="button" variant="outline">
                                        {t('common.actions.cancel')}
                                    </Button>
                                }
                            />
                            <Button
                                type="button"
                                onClick={saveDraft}
                                disabled={saving}
                            >
                                {t('common.actions.save')}
                            </Button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
