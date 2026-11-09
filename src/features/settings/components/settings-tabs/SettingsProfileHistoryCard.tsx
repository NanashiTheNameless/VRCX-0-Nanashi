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

// Literal ids, so the settings manifest test can find every switch.
const FIELDS = [
    {
        field: 'status',
        key: 'status',
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
        key: 'bio',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.bio-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.bio-sync'
            }
        ]
    },
    {
        field: 'pronouns',
        key: 'pronouns',
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
    },
    {
        field: 'displayName',
        key: 'display_name',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.display-name-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.display-name-sync'
            }
        ]
    },
    {
        field: 'bioLinks',
        key: 'bio_links',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.bio-links-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.bio-links-sync'
            }
        ]
    },
    {
        field: 'profilePictures',
        key: 'profile_pictures',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.profile-pictures-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.profile-pictures-sync'
            }
        ]
    },
    {
        field: 'profileDecorations',
        key: 'profile_decorations',
        choices: [
            {
                property: 'recording',
                settingId:
                    'social.profile-history.profile-decorations-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.profile-decorations-sync'
            }
        ]
    },
    {
        field: 'badges',
        key: 'badges',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.badges-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.badges-sync'
            }
        ]
    },
    {
        field: 'tags',
        key: 'tags',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.tags-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.tags-sync'
            }
        ]
    },
    {
        field: 'ageVerification',
        key: 'age_verification',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.age-verification-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.age-verification-sync'
            }
        ]
    },
    {
        field: 'avatarCloning',
        key: 'avatar_cloning',
        choices: [
            {
                property: 'recording',
                settingId: 'social.profile-history.avatar-cloning-recording'
            },
            {
                property: 'sync',
                settingId: 'social.profile-history.avatar-cloning-sync'
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
            [field]: {
                recording: false,
                sync: true,
                ...settings[field],
                [property]: value
            }
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
            {FIELDS.map(({ field, key, choices }) => (
                <div
                    key={field}
                    className="space-y-3 border-b pb-4 last:border-b-0"
                >
                    <p className="font-medium">{t(`${T}.${key}`)}</p>
                    {choices.map(({ property, settingId }) => (
                        <Field
                            key={property}
                            settingId={settingId}
                            label={t(`${T}.${key}_${property}`)}
                            description={t(`${T}.${property}_description`)}
                            onReset={() =>
                                save(field, property, property === 'sync')
                            }
                        >
                            <Switch
                                aria-label={`${t(`${T}.${key}`)}: ${t(`${T}.${property}`)}`}
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
