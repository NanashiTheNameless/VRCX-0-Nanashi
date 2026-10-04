import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { usePreferencesStore } from '@/state/preferencesStore';
import { Switch } from '@/ui/shadcn/switch';

import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsCard } from '../SettingsCard';
import { Field } from '../SettingsField';

export function SettingsInterfaceUserDialogCard() {
    const { t } = useTranslation();
    const settingsInterface = useSettingsPageSection('interface');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            hideUserNotes: state.hideUserNotes,
            hideUserMemos: state.hideUserMemos
        }))
    );
    const { onHideUserNotesChange, onHideUserMemosChange } = settingsInterface;

    return (
        <SettingsCard
            cardId="interface.user-dialog"
            title={t('view.settings.appearance.user_dialog.header')}
        >
            <Field
                label={t('view.settings.appearance.user_dialog.vrchat_notes')}
                description={t(
                    'view.settings.appearance.user_dialog.vrchat_notes_description'
                )}
            >
                <Switch
                    checked={!prefs.hideUserNotes}
                    onCheckedChange={onHideUserNotesChange}
                />
            </Field>
            <Field
                label={t('view.settings.appearance.user_dialog.vrcx_memos')}
                description={t(
                    'view.settings.appearance.user_dialog.vrcx_memos_description'
                )}
            >
                <Switch
                    checked={!prefs.hideUserMemos}
                    onCheckedChange={onHideUserMemosChange}
                />
            </Field>
        </SettingsCard>
    );
}
