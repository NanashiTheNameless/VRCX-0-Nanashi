import { useEffect, useState } from 'react';

import { setStringConfigPreference } from '@/services/preferencesService';
import { isValidDisplayTimeZone } from '@/shared/utils/displayTimeZone';
import { usePreferencesStore } from '@/state/preferencesStore';
import { Input } from '@/ui/shadcn/input';

import { Field } from '../SettingsField';

export function SettingsTimeZoneField() {
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
            label="Timezone"
            description="Use an IANA timezone or a fixed UTC offset. Leave blank to follow the system timezone. This setting applies to this PC."
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
