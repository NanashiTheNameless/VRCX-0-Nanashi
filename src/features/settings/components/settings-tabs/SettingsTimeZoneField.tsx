import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setStringConfigPreference } from '@/services/preferencesService';
import { isValidDisplayTimeZone } from '@/shared/utils/displayTimeZone';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Input } from '@/ui/shadcn/input';

import { Field } from '../SettingsField';

export function SettingsTimeZoneField() {
    const { t } = useTranslation();
    const saved = usePreferencesStore((state) => state.dtTimeZone);
    const [draft, setDraft] = useState(saved);
    const [error, setError] = useState('');
    useEffect(() => setDraft(saved), [saved]);
    const save = async () => {
        const value = draft.trim();
        if (!isValidDisplayTimeZone(value)) {
            setError(
                'Enter an IANA timezone, such as America/Chicago, or a UTC offset, such as UTC+05:30.'
            );
            return;
        }
        try {
            await setStringConfigPreference('dtTimeZone', value);
            setError('');
        } catch (failure) {
            setError(String(failure));
        }
    };
    return (
        <Field
            settingId="interface.time-date.time-zone"
            label={t('view.settings.appearance.timedate.time_zone')}
            description={t(
                'view.settings.appearance.timedate.time_zone_description'
            )}
            controlId="settings-timezone"
        >
            <Input
                id="settings-timezone"
                value={draft}
                placeholder="System timezone"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'settings-timezone-error' : undefined}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => void save()}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                }}
            />
            {error && (
                <p id="settings-timezone-error" role="alert">
                    {error}
                </p>
            )}
        </Field>
    );
}
