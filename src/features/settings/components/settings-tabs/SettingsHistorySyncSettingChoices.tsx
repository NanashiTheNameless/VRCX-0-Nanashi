import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type RemoteSyncSettingGroup
} from '@/platform/tauri/bindings';
import { ConfigKeys } from '@/repositories/configKeys';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';

const KEY_PREFIX = 'config:vrcx_';

const settingNames = new Map(
    Object.keys(ConfigKeys).map((name) => [
        name.replace(/^VRCX_/, '').toLowerCase(),
        name
    ])
);

function settingName(key: string) {
    const name = key.startsWith(KEY_PREFIX)
        ? key.slice(KEY_PREFIX.length)
        : key;
    return settingNames.get(name) ?? name;
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
    const [open, setOpen] = useState<string[]>([]);
    const [error, setError] = useState<string>();

    const report = useCallback((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
    }, []);

    useEffect(() => {
        commands.appRemoteSyncSettingGroupsGet().then(setGroups).catch(report);
    }, [report]);

    const save = (next: RemoteSyncSettingGroup[]) => {
        const previous = groups;
        setGroups(next);
        setError(undefined);
        commands
            .appRemoteSyncSettingChoicesSet(choicesFrom(next))
            .catch((cause: unknown) => {
                setGroups(previous);
                report(cause);
            });
    };

    const setGroup = (id: string, enabled: boolean) =>
        save(
            groups.map((group) =>
                group.id === id
                    ? {
                          ...group,
                          enabled,
                          settings: group.settings.map((setting) => ({
                              ...setting,
                              synced: enabled
                          }))
                      }
                    : group
            )
        );

    const setSetting = (key: string, synced: boolean) =>
        save(
            groups.map((group) => ({
                ...group,
                settings: group.settings.map((setting) =>
                    setting.key === key ? { ...setting, synced } : setting
                )
            }))
        );

    return (
        <div className="flex flex-col gap-2">
            {groups.map((group) => {
                const expanded = open.includes(group.id);
                const synced = group.settings.filter(
                    (setting) => setting.synced
                ).length;
                return (
                    <div
                        key={group.id}
                        className="flex flex-col gap-2 rounded-md border px-3 py-2"
                    >
                        <div className="flex items-center gap-3">
                            <Switch
                                aria-label={t(
                                    `view.settings.history_sync.setting_groups.${group.id}`
                                )}
                                checked={group.enabled}
                                disabled={disabled}
                                onCheckedChange={(enabled) =>
                                    setGroup(group.id, enabled)
                                }
                            />
                            <span className="min-w-0 flex-1 text-sm">
                                {t(
                                    `view.settings.history_sync.setting_groups.${group.id}`
                                )}
                            </span>
                            <span className="text-muted-foreground text-xs tabular-nums">
                                {t(
                                    'view.settings.history_sync.setting_choices_count',
                                    {
                                        synced,
                                        total: group.settings.length
                                    }
                                )}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={!group.settings.length}
                                aria-expanded={expanded}
                                onClick={() =>
                                    setOpen(
                                        expanded
                                            ? open.filter(
                                                  (id) => id !== group.id
                                              )
                                            : [...open, group.id]
                                    )
                                }
                            >
                                {t(
                                    expanded
                                        ? 'view.settings.history_sync.setting_choices_hide'
                                        : 'view.settings.history_sync.setting_choices_show'
                                )}
                            </Button>
                        </div>
                        {expanded
                            ? group.settings.map((setting) => (
                                  <label
                                      key={setting.key}
                                      className="flex items-center gap-3 pl-6 text-sm"
                                  >
                                      <Switch
                                          checked={setting.synced}
                                          disabled={disabled}
                                          onCheckedChange={(next) =>
                                              setSetting(setting.key, next)
                                          }
                                      />
                                      <span className="min-w-0 truncate font-mono text-xs">
                                          {settingName(setting.key)}
                                      </span>
                                  </label>
                              ))
                            : null}
                    </div>
                );
            })}
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
    );
}
