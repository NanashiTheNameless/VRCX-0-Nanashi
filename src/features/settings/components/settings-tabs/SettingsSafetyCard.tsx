import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type SafetySettings,
    type SafetySource,
    type SafetyStatus,
    type SourceFormat,
    type WatchEntry
} from '@/platform/tauri/bindings';
import { useModalStore } from '@/state/modalStore';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';
import { Textarea } from '@/ui/shadcn/textarea';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';
import { SettingsAvatarBlocks } from './SettingsAvatarBlocks';
import { SettingsGlobalHide } from './SettingsGlobalHide';
import { SettingsInstanceAvatarCheck } from './SettingsInstanceAvatarCheck';

const P = 'view.settings.safety';
const formats: SourceFormat[] = [
    'avatarIds',
    'userIds',
    'domains',
    'githubAvatars'
];
const lines = (value: string) =>
    value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

function Watchlist({
    kind,
    entries,
    change
}: {
    kind: 'groups' | 'avatars';
    entries: WatchEntry[];
    change: (entries: WatchEntry[]) => void;
}) {
    const { t } = useTranslation();
    const [id, setId] = useState('');
    const [label, setLabel] = useState('');
    return (
        <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 font-medium">{t(`${P}.${kind}`)}</legend>
            <div className="flex flex-wrap gap-2">
                <Input
                    className="min-w-52 flex-1"
                    aria-label={t(`${P}.${kind}_id`)}
                    placeholder={kind === 'groups' ? 'grp_...' : 'avtr_...'}
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                />
                <Input
                    className="min-w-44 flex-1"
                    aria-label={t(`${P}.${kind}_label`)}
                    placeholder={t(`${P}.${kind}_label`)}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                />
                <Button
                    variant="outline"
                    disabled={
                        !id.trim() ||
                        (kind === 'avatars' && !label.trim()) ||
                        entries.some((entry) => entry.id === id.trim())
                    }
                    onClick={() => {
                        change([
                            ...entries,
                            {
                                id: id.trim(),
                                label: label.trim(),
                                enabled: true
                            }
                        ]);
                        setId('');
                        setLabel('');
                    }}
                >
                    {t(`${P}.add`)}
                </Button>
            </div>
            {entries.map((entry, index) => (
                <div key={entry.id} className="flex items-center gap-2">
                    <Switch
                        aria-label={`${t(`${P}.enabled`)} ${entry.label || entry.id}`}
                        checked={entry.enabled}
                        onCheckedChange={(enabled) =>
                            change(
                                entries.map((e, i) =>
                                    i === index ? { ...e, enabled } : e
                                )
                            )
                        }
                    />
                    <span className="min-w-0 flex-1 text-sm break-all">
                        {entry.label ? `${entry.label} - ` : ''}
                        {entry.id}
                    </span>
                    <Button
                        variant="ghost"
                        onClick={() =>
                            change(entries.filter((_, i) => i !== index))
                        }
                    >
                        {t(`${P}.remove`)}
                    </Button>
                </div>
            ))}
        </fieldset>
    );
}

export function SettingsSafetyCard() {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<SafetySettings | null>(null);
    const [saved, setSaved] = useState('');
    const [status, setStatus] = useState<SafetyStatus | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const dirty = !!settings && JSON.stringify(settings) !== saved;
    useEffect(() => {
        let active = true;
        Promise.all([
            commands.appSafetySettingsGet(),
            commands.appSafetyStatus()
        ])
            .then(([value, state]) => {
                if (active) {
                    setSettings(value);
                    setSaved(JSON.stringify(value));
                    setStatus(state);
                }
            })
            .catch((reason: unknown) => {
                if (active) setError(String(reason));
            });
        return () => {
            active = false;
        };
    }, []);
    const update = (patch: Partial<SafetySettings>) =>
        setSettings((current) => current && { ...current, ...patch });
    const updateSource = (id: string, patch: Partial<SafetySource>) =>
        setSettings(
            (current) =>
                current && {
                    ...current,
                    sources: current.sources.map((s) =>
                        s.id === id ? { ...s, ...patch } : s
                    )
                }
        );
    async function run(action: () => Promise<unknown>) {
        setBusy(true);
        setError('');
        try {
            await action();
        } catch (reason) {
            setError(String(reason));
        } finally {
            setBusy(false);
        }
    }
    async function refreshSources() {
        setRefreshing(true);
        setError('');
        try {
            setStatus(await commands.appSafetySourcesRefresh());
        } catch (reason) {
            setError(String(reason));
        } finally {
            setRefreshing(false);
        }
    }
    async function save() {
        if (!settings) return;
        const normalized = {
            ...settings,
            blockedDomains: lines(settings.blockedDomains.join('\n')),
            allowedDomains: lines(settings.allowedDomains.join('\n')),
            sources: settings.sources.map((source) => ({
                ...source,
                banGroupIds: lines(source.banGroupIds.join('\n'))
            }))
        };
        const automatic = normalized.sources.filter(
            (s) => s.enabled && (s.blockUsers || s.banGroupIds.length)
        );
        if (settings.enabled && automatic.length) {
            const confirmed = await useModalStore.getState().confirm({
                title: t(`${P}.confirm_title`),
                description: t(`${P}.confirm_description`, {
                    sources: automatic
                        .map(
                            (s) =>
                                `${s.name}: ${s.blockUsers ? t(`${P}.block`) : ''} ${s.banGroupIds.join(', ')}`
                        )
                        .join('\n')
                }),
                confirmText: t(`${P}.save`),
                cancelText: t('common.actions.cancel')
            });
            if (!confirmed.ok) return;
        }
        const value = await commands.appSafetySettingsSave(normalized);
        setSettings(value);
        setSaved(JSON.stringify(value));
        setStatus(await commands.appSafetyStatus());
    }
    return (
        <SettingsCard
            cardId="notifications.safety"
            title={t(`${P}.title`)}
            description={t(`${P}.description`)}
        >
            {error && (
                <p role="alert" className="text-destructive py-2">
                    {error}
                </p>
            )}
            <fieldset
                disabled={busy || !settings}
                className="min-w-0 space-y-4"
            >
                {settings && (
                    <>
                        <Field label={t(`${P}.enabled`)}>
                            <Switch
                                checked={settings.enabled}
                                onCheckedChange={(enabled) =>
                                    update({ enabled })
                                }
                            />
                        </Field>
                        <p className="text-muted-foreground text-sm">
                            {t(`${P}.avatar_limit`)}
                        </p>
                        <Watchlist
                            kind="groups"
                            entries={settings.groups}
                            change={(groups) => update({ groups })}
                        />
                        <Watchlist
                            kind="avatars"
                            entries={settings.avatars}
                            change={(avatars) => update({ avatars })}
                        />
                        <Field
                            label={t(`${P}.url_warnings`)}
                            description={t(`${P}.url_description`)}
                        >
                            <Switch
                                checked={settings.urlWarnings}
                                onCheckedChange={(urlWarnings) =>
                                    update({ urlWarnings })
                                }
                            />
                        </Field>
                        <Field label={t(`${P}.shorteners`)}>
                            <Switch
                                checked={settings.warnShorteners}
                                onCheckedChange={(warnShorteners) =>
                                    update({ warnShorteners })
                                }
                            />
                        </Field>
                        <label className="block space-y-1 text-sm">
                            {t(`${P}.blocked_domains`)}
                            <Textarea
                                value={settings.blockedDomains.join('\n')}
                                onChange={(e) =>
                                    update({
                                        blockedDomains:
                                            e.target.value.split('\n')
                                    })
                                }
                            />
                        </label>
                        <label className="block space-y-1 text-sm">
                            {t(`${P}.allowed_domains`)}
                            <Textarea
                                value={settings.allowedDomains.join('\n')}
                                onChange={(e) =>
                                    update({
                                        allowedDomains:
                                            e.target.value.split('\n')
                                    })
                                }
                            />
                        </label>
                        <p className="text-muted-foreground text-sm">
                            {t(`${P}.sources_description`)}
                        </p>
                        <p className="text-muted-foreground text-sm">
                            {t(`${P}.manual_actions`)}
                        </p>
                        {settings.sources.map((source) => {
                            const state = status?.sources.find(
                                (s) => s.id === source.id
                            );
                            const formatItems = formats.map((value) => ({
                                value,
                                label: t(`${P}.formats.${value}`)
                            }));
                            return (
                                <fieldset
                                    key={source.id}
                                    className="space-y-2 rounded-md border p-3"
                                >
                                    <legend className="px-1 font-medium">
                                        {source.name || t(`${P}.new_source`)}
                                    </legend>
                                    <Field label={t(`${P}.source_enabled`)}>
                                        <Switch
                                            checked={source.enabled}
                                            onCheckedChange={(enabled) =>
                                                updateSource(source.id, {
                                                    enabled
                                                })
                                            }
                                        />
                                    </Field>
                                    <Input
                                        aria-label={t(`${P}.source_name`)}
                                        placeholder={t(`${P}.source_name`)}
                                        value={source.name}
                                        onChange={(e) =>
                                            updateSource(source.id, {
                                                name: e.target.value
                                            })
                                        }
                                    />
                                    <Input
                                        aria-label={t(`${P}.source_url`)}
                                        placeholder="https://..."
                                        value={source.url}
                                        onChange={(e) =>
                                            updateSource(source.id, {
                                                url: e.target.value
                                            })
                                        }
                                    />
                                    <Select
                                        value={source.format}
                                        items={formatItems}
                                        onValueChange={(value) =>
                                            value &&
                                            updateSource(source.id, {
                                                format: value as SourceFormat,
                                                blockUsers: false,
                                                banGroupIds: [],
                                                globalHide: false
                                            })
                                        }
                                    >
                                        <SelectTrigger
                                            aria-label={t(`${P}.source_format`)}
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {formatItems.map(
                                                ({ value, label }) => (
                                                    <SelectItem
                                                        key={value}
                                                        value={value}
                                                    >
                                                        {label}
                                                    </SelectItem>
                                                )
                                            )}
                                        </SelectContent>
                                    </Select>
                                    <Field label={t(`${P}.warn`)}>
                                        <Switch
                                            checked={source.warn}
                                            onCheckedChange={(warn) =>
                                                updateSource(source.id, {
                                                    warn
                                                })
                                            }
                                        />
                                    </Field>
                                    {source.format === 'userIds' && (
                                        <>
                                            <Field label={t(`${P}.block`)}>
                                                <Switch
                                                    checked={source.blockUsers}
                                                    onCheckedChange={(
                                                        blockUsers
                                                    ) =>
                                                        updateSource(
                                                            source.id,
                                                            { blockUsers }
                                                        )
                                                    }
                                                />
                                            </Field>
                                            <label className="block space-y-1 text-sm">
                                                {t(`${P}.ban_groups`)}
                                                <Textarea
                                                    value={source.banGroupIds.join(
                                                        '\n'
                                                    )}
                                                    onChange={(e) =>
                                                        updateSource(
                                                            source.id,
                                                            {
                                                                banGroupIds:
                                                                    e.target.value.split(
                                                                        '\n'
                                                                    )
                                                            }
                                                        )
                                                    }
                                                />
                                            </label>
                                        </>
                                    )}
                                    {(source.format === 'avatarIds' ||
                                        source.format === 'githubAvatars') && (
                                        <Field
                                            label={t(`${P}.global_hide.toggle`)}
                                            description={t(
                                                `${P}.global_hide.toggle_description`
                                            )}
                                        >
                                            <Switch
                                                checked={source.globalHide}
                                                onCheckedChange={(globalHide) =>
                                                    updateSource(source.id, {
                                                        globalHide
                                                    })
                                                }
                                            />
                                        </Field>
                                    )}
                                    {(source.format === 'avatarIds' ||
                                        source.format === 'githubAvatars') && (
                                        <SettingsAvatarBlocks
                                            sourceId={source.id}
                                            disabled={
                                                dirty ||
                                                !source.enabled ||
                                                !settings.enabled
                                            }
                                        />
                                    )}
                                    {state && (
                                        <p className="text-muted-foreground text-sm">
                                            {t(`${P}.source_status`, {
                                                count: state.count,
                                                date:
                                                    state.updatedAt ||
                                                    t(`${P}.never`)
                                            })}
                                            {state.error && (
                                                <span
                                                    role="alert"
                                                    className="text-destructive block"
                                                >
                                                    {state.error}
                                                </span>
                                            )}
                                        </p>
                                    )}
                                    <Button
                                        variant="ghost"
                                        onClick={() =>
                                            update({
                                                sources:
                                                    settings.sources.filter(
                                                        (s) =>
                                                            s.id !== source.id
                                                    )
                                            })
                                        }
                                    >
                                        {t(`${P}.remove`)}
                                    </Button>
                                </fieldset>
                            );
                        })}
                        <Button
                            variant="outline"
                            onClick={() =>
                                update({
                                    sources: [
                                        ...settings.sources,
                                        {
                                            id: crypto.randomUUID(),
                                            name: '',
                                            url: '',
                                            format: 'avatarIds',
                                            enabled: false,
                                            warn: true,
                                            blockUsers: false,
                                            banGroupIds: [],
                                            globalHide: false
                                        }
                                    ]
                                })
                            }
                        >
                            {t(`${P}.add_source`)}
                        </Button>
                        <SettingsGlobalHide />
                        <SettingsInstanceAvatarCheck />
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                disabled={!dirty}
                                onClick={() => void run(save)}
                            >
                                {t(`${P}.save`)}
                            </Button>
                            <Button
                                variant="outline"
                                disabled={
                                    dirty || !settings.enabled || refreshing
                                }
                                onClick={() => void refreshSources()}
                            >
                                {t(
                                    `${P}.${refreshing ? 'refreshing' : 'refresh_sources'}`
                                )}
                            </Button>
                            {dirty && (
                                <span className="text-muted-foreground text-sm">
                                    {t(`${P}.unsaved`)}
                                </span>
                            )}
                        </div>
                        <p className="text-muted-foreground text-sm">
                            {t(`${P}.channels`)}
                        </p>
                    </>
                )}
                <div className="flex items-center gap-2">
                    <span className="font-medium">{t(`${P}.history`)}</span>
                    <Button
                        variant="outline"
                        onClick={() =>
                            void run(async () =>
                                setStatus(await commands.appSafetyStatus())
                            )
                        }
                    >
                        {t(`${P}.refresh_history`)}
                    </Button>
                </div>
                {!!status?.droppedEvents && (
                    <p role="alert">
                        {t(`${P}.dropped`, { count: status.droppedEvents })}
                    </p>
                )}
                <div className="max-h-80 space-y-2 overflow-auto">
                    {status?.audit.map((entry, index) => (
                        <div
                            key={`${entry.createdAt}-${index}`}
                            className="rounded border p-2 text-sm"
                        >
                            <p>{entry.message}</p>
                            <p className="text-muted-foreground">
                                {entry.createdAt} | {entry.source} |{' '}
                                {entry.action}: {entry.outcome}
                            </p>
                        </div>
                    ))}
                    {!status?.audit.length && (
                        <p className="text-muted-foreground text-sm">
                            {t(`${P}.no_history`)}
                        </p>
                    )}
                </div>
            </fieldset>
        </SettingsCard>
    );
}
