import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { commands } from '@/platform/tauri/bindings';
import { toast } from '@/services/toastService';
import { Switch } from '@/ui/shadcn/switch';

import { Field } from './SettingsField';

// Fork: keeps the PC from idle-sleeping so live updates keep arriving while
// the app sits in the tray. The display can still turn off.
export function KeepSystemAwakeSetting() {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState<boolean | undefined>(undefined);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let active = true;
        commands
            .appKeepSystemAwakeGet()
            .then((result) => {
                if (active) setEnabled(result);
            })
            .catch(() => {
                if (active) setEnabled(false);
            });
        return () => {
            active = false;
        };
    }, []);

    async function change(next: boolean) {
        setBusy(true);
        try {
            setEnabled(await commands.appKeepSystemAwakeSet(next));
        } catch (error) {
            toast.add({
                type: 'error',
                title: error instanceof Error ? error.message : String(error)
            });
        } finally {
            setBusy(false);
        }
    }

    return (
        <Field
            label={t('view.settings.general.application.keep_system_awake')}
            description={t(
                'view.settings.general.application.keep_system_awake_description'
            )}
        >
            <Switch
                checked={enabled === true}
                disabled={enabled === undefined || busy}
                onCheckedChange={(checked) => void change(checked)}
            />
        </Field>
    );
}
