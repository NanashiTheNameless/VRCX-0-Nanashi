import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import type { AdoptionCensusLock } from '@/platform/tauri/bindings';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from './SettingsField';

type AdoptionCensusFieldProps = {
    enabled?: boolean;
    onEnabledChange: (checked: boolean) => void;
};

export function AdoptionCensusField({
    enabled,
    onEnabledChange
}: AdoptionCensusFieldProps) {
    const { t } = useTranslation();
    const [lock, setLock] = useState<AdoptionCensusLock | null>(null);

    useEffect(() => {
        let active = true;
        void commands
            .appAdoptionCensusLock()
            .then((value) => {
                if (active) {
                    setLock(value);
                }
            })
            .catch(() => undefined);
        return () => {
            active = false;
        };
    }, []);

    return (
        <Field
            label={t('view.settings.advanced.adoption_census.label')}
            description={
                lock
                    ? t(`view.settings.advanced.adoption_census.locked_${lock}`)
                    : t('view.settings.advanced.adoption_census.description')
            }
        >
            <Switch
                checked={lock ? false : enabled}
                disabled={Boolean(lock)}
                onCheckedChange={onEnabledChange}
            />
        </Field>
    );
}
