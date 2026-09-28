import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import {
    OVERLAY_ACTIVITY_TYPE_DEFINITIONS,
    overlayActivityTypeLabelKey
} from '@/shared/constants/overlayActivityFilters';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '@/ui/shadcn/select';
import { Slider } from '@/ui/shadcn/slider';
import { Switch } from '@/ui/shadcn/switch';

import {
    parseNotificationSounds,
    type NotificationSoundRule,
    type NotificationSounds
} from '../../notificationSounds';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

const PREFIX = 'view.settings.notifications.custom_sounds';
const AUDIENCES = ['anyone', 'friend', 'favorite'] as const;

export function SettingsCustomSoundsCard() {
    const { t } = useTranslation();
    const [config, setConfig] = useState<NotificationSounds | null>(null);
    const [saved, setSaved] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [eventType, setEventType] = useState('OnPlayerJoined');
    const [audience, setAudience] = useState('anyone');
    const ruleKey = eventType + (audience === 'anyone' ? '' : `@${audience}`);
    const eventLabel = (key: string) =>
        t(
            `dialog.wrist_feed_notifications.types.${overlayActivityTypeLabelKey(key)}`,
            { defaultValue: key }
        );
    const eventItems = OVERLAY_ACTIVITY_TYPE_DEFINITIONS.map(({ key }) => ({
        value: key,
        label: eventLabel(key)
    }));
    const audienceItems = AUDIENCES.map((value) => ({
        value,
        label: t(`${PREFIX}.${value}`)
    }));
    const dirty = config !== null && JSON.stringify(config) !== saved;
    const invalid =
        config !== null &&
        Object.values(config.rules).some(
            (rule) => rule.enabled && !rule.path.trim()
        );

    useEffect(() => {
        let active = true;
        configRepository
            .getString('notificationSounds')
            .then((raw) => {
                const loaded = parseNotificationSounds(raw);
                if (active) {
                    setConfig(loaded);
                    setSaved(JSON.stringify(loaded));
                }
            })
            .catch((reason: unknown) => {
                if (active) setError(String(reason));
            });
        return () => {
            active = false;
        };
    }, []);

    function update(key: string, patch: Partial<NotificationSoundRule>) {
        setConfig(
            (current) =>
                current && {
                    ...current,
                    rules: {
                        ...current.rules,
                        [key]: { ...current.rules[key], ...patch }
                    }
                }
        );
    }

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

    async function save() {
        if (!config) return;
        const raw = JSON.stringify(config);
        await configRepository.setString('notificationSounds', raw);
        setSaved(raw);
    }

    return (
        <SettingsCard
            cardId="notifications.customSounds"
            title={t(`${PREFIX}.header`)}
            description={t(`${PREFIX}.description`)}
        >
            {error && (
                <p role="alert" className="text-destructive py-2">
                    {error}
                </p>
            )}
            <fieldset
                disabled={busy || config === null}
                className="min-w-0 space-y-3"
            >
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={eventType}
                        items={eventItems}
                        onValueChange={(value) => value && setEventType(value)}
                    >
                        <SelectTrigger
                            aria-label={t(`${PREFIX}.event`)}
                            className="w-64"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {eventItems.map(({ value, label }) => (
                                <SelectItem key={value} value={value}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        value={audience}
                        items={audienceItems}
                        onValueChange={(value) => value && setAudience(value)}
                    >
                        <SelectTrigger
                            aria-label={t(`${PREFIX}.audience`)}
                            className="w-44"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {audienceItems.map(({ value, label }) => (
                                <SelectItem key={value} value={value}>
                                    {label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="outline"
                        disabled={
                            !config || Object.hasOwn(config.rules, ruleKey)
                        }
                        onClick={() =>
                            update(ruleKey, {
                                enabled: true,
                                path: '',
                                volume: 0.8
                            })
                        }
                    >
                        {t(`${PREFIX}.add`)}
                    </Button>
                </div>
                {config &&
                    Object.entries(config.rules).map(([key, rule]) => {
                        const [type, scope = 'anyone'] = key.split('@');
                        return (
                            <fieldset
                                key={key}
                                className="border-stroke-subtle rounded-md border px-3 pb-2"
                            >
                                <legend className="px-1 text-sm font-medium">
                                    {eventLabel(type)} /{' '}
                                    {t(`${PREFIX}.${scope}`, {
                                        defaultValue: scope
                                    })}
                                </legend>
                                <Field label={t(`${PREFIX}.enabled`)}>
                                    <Switch
                                        checked={rule.enabled}
                                        onCheckedChange={(enabled) =>
                                            update(key, { enabled })
                                        }
                                    />
                                </Field>
                                <div className="flex items-center gap-2 py-2">
                                    <Input
                                        aria-label={t(`${PREFIX}.file`)}
                                        value={rule.path}
                                        placeholder={t(
                                            `${PREFIX}.file_placeholder`
                                        )}
                                        onChange={(event) =>
                                            update(key, {
                                                path: event.target.value
                                            })
                                        }
                                    />
                                    <Button
                                        variant="outline"
                                        onClick={() =>
                                            void run(async () => {
                                                const path =
                                                    await commands.appOpenFileSelectorDialog(
                                                        null,
                                                        null,
                                                        'Audio|*.wav;*.mp3;*.flac;*.ogg'
                                                    );
                                                if (path) update(key, { path });
                                            })
                                        }
                                    >
                                        {t(`${PREFIX}.browse`)}
                                    </Button>
                                </div>
                                <Field
                                    label={`${t(`${PREFIX}.volume`)} (${Math.round(rule.volume * 100)}%)`}
                                >
                                    <Slider
                                        aria-label={t(`${PREFIX}.volume`)}
                                        className="w-52"
                                        min={0}
                                        max={100}
                                        step={1}
                                        value={[Math.round(rule.volume * 100)]}
                                        onValueChange={(value) =>
                                            update(key, {
                                                volume:
                                                    (Array.isArray(value)
                                                        ? value[0]
                                                        : value) / 100
                                            })
                                        }
                                    />
                                </Field>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        disabled={!rule.path.trim()}
                                        onClick={() =>
                                            void run(() =>
                                                commands.appNotificationSoundTest(
                                                    rule.path.trim(),
                                                    rule.volume
                                                )
                                            )
                                        }
                                    >
                                        {t(`${PREFIX}.test`)}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        onClick={() =>
                                            setConfig(
                                                (current) =>
                                                    current && {
                                                        ...current,
                                                        rules: Object.fromEntries(
                                                            Object.entries(
                                                                current.rules
                                                            ).filter(
                                                                ([candidate]) =>
                                                                    candidate !==
                                                                    key
                                                            )
                                                        )
                                                    }
                                            )
                                        }
                                    >
                                        {t(`${PREFIX}.remove`)}
                                    </Button>
                                </div>
                            </fieldset>
                        );
                    })}
                {config && !Object.keys(config.rules).length && (
                    <p className="text-muted-foreground text-sm">
                        {t(`${PREFIX}.empty`)}
                    </p>
                )}
                {invalid && (
                    <p className="text-muted-foreground text-sm">
                        {t(`${PREFIX}.missing_file`)}
                    </p>
                )}
                <div className="flex items-center gap-3">
                    <Button
                        disabled={!dirty || invalid}
                        onClick={() => void run(save)}
                    >
                        {t(`${PREFIX}.save`)}
                    </Button>
                    {dirty && (
                        <span className="text-muted-foreground text-sm">
                            {t(`${PREFIX}.unsaved`)}
                        </span>
                    )}
                </div>
            </fieldset>
        </SettingsCard>
    );
}
