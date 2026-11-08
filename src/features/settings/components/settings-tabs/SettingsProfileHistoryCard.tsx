import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    commands,
    type ProfileHistoryField,
    type ProfileHistorySettings
} from '@/platform/tauri/bindings';
import { Switch } from '@/ui/shadcn/switch';

import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

const FIELDS = [
    {
        field: 'status',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.status-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.status-sync'
            }
        ]
    },
    {
        field: 'bio',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.bio-recording'
            },
            { property: 'sync', settingId: 'social.profile-history.bio-sync' }
        ]
    },
    {
        field: 'pronouns',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.pronouns-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.pronouns-sync'
            }
        ]
    }
] as const;
const T = 'view.settings.social.profile_history';

export function SettingsProfileHistoryCard() {
    const { t } = useTranslation();
    const [settings, setSettings] = useState<ProfileHistorySettings | null>(
        null
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        commands
            .appProfileHistorySettingsGet()
            .then((value) => {
                if (active) setSettings(value);
            })
            .catch((cause: unknown) => {
                if (active) setError(String(cause));
            });
        return () => {
            active = false;
        };
    }, []);

    async function save(
        field: ProfileHistoryField,
        property: 'recording' | 'sync',
        value: boolean
    ) {
        if (!settings || saving) return;
        const next = {
            ...settings,
            [field]: { ...settings[field], [property]: value }
        };
        setSaving(true);
        setError('');
        try {
            await commands.appProfileHistorySettingsSet(next);
            setSettings(next);
        } catch (cause) {
            setError(String(cause));
        } finally {
            setSaving(false);
        }
    }

    return (
        <SettingsCard cardId="social.profile-history" title={t(`${T}.header`)}>
            <p className="text-muted-foreground text-sm">
                {t(`${T}.description`)}
            </p>
            {FIELDS.map(({ field, choices }) => (
                <div
                    key={field}
                    className="space-y-3 border-b pb-4 last:border-b-0"
                >
                    <p className="font-medium">{t(`${T}.${field}`)}</p>
                    {choices.map(({ property, settingId }) => (
                        <Field
                            key={property}
                            settingId={settingId}
                            label={t(`${T}.${field}_${property}`)}
                            description={t(`${T}.${property}_description`)}
                            onReset={() =>
                                save(field, property, property === 'sync')
                            }
                        >
                            <Switch
                                aria-label={`${t(`${T}.${field}`)}: ${t(`${T}.${property}`)}`}
                                checked={
                                    settings?.[field]?.[property] ??
                                    property === 'sync'
                                }
                                disabled={!settings || saving}
                                onCheckedChange={(value) => {
                                    void save(field, property, value);
                                }}
                            />
                        </Field>
                    ))}
                </div>
            ))}
            {error ? (
                <p role="alert" className="text-destructive text-sm">
                    {error}
                </p>
            ) : null}
        </SettingsCard>
    );
}
