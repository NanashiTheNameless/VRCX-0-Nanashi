import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { usePreferencesStore } from '@/state/preferencesStore';
import { Switch } from '@/ui/shadcn/switch';

import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsCard } from '../SettingsCard';
import { Field, FieldGroup, SettingsSectionHeading } from '../SettingsField';

export function SettingsInterfaceUserDialogCard() {
    const { t } = useTranslation();
    const settingsInterface = useSettingsPageSection('interface');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            showUserDialogProfileBackground:
                state.showUserDialogProfileBackground,
            showUserDialogAvatarFrame: state.showUserDialogAvatarFrame,
            showUserDialogProfileEffect: state.showUserDialogProfileEffect,
            showUserDialogNameplateEffect: state.showUserDialogNameplateEffect,
            hideUserNotes: state.hideUserNotes,
            hideUserMemos: state.hideUserMemos
        }))
    );
    const {
        onShowUserDialogProfileBackgroundChange,
        onShowUserDialogAvatarFrameChange,
        onShowUserDialogProfileEffectChange,
        onShowUserDialogNameplateEffectChange,
        onHideUserNotesChange,
        onHideUserMemosChange
    } = settingsInterface;
    const anyDecorationShown =
        prefs.showUserDialogProfileBackground ||
        prefs.showUserDialogAvatarFrame ||
        prefs.showUserDialogProfileEffect ||
        prefs.showUserDialogNameplateEffect;

    function setAllDecorations(checked: boolean) {
        onShowUserDialogProfileBackgroundChange(checked);
        onShowUserDialogAvatarFrameChange(checked);
        onShowUserDialogProfileEffectChange(checked);
        onShowUserDialogNameplateEffectChange(checked);
    }

    return (
        <SettingsCard
            cardId="interface.user-dialog"
            title={t('view.settings.appearance.user_dialog.header')}
            bodyClassName="flex flex-col gap-5"
        >
            <FieldGroup className="gap-0">
                <SettingsSectionHeading
                    title={t(
                        'view.settings.appearance.user_dialog.profile_appearance'
                    )}
                />
                <Field
                    label={t(
                        'view.settings.appearance.user_dialog.profile_decorations'
                    )}
                    description={t(
                        'view.settings.appearance.user_dialog.profile_decorations_description'
                    )}
                >
                    <Switch
                        checked={anyDecorationShown}
                        onCheckedChange={setAllDecorations}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.appearance.user_dialog.profile_background'
                    )}
                    description={t(
                        'view.settings.appearance.user_dialog.profile_background_description'
                    )}
                >
                    <Switch
                        checked={prefs.showUserDialogProfileBackground}
                        onCheckedChange={
                            onShowUserDialogProfileBackgroundChange
                        }
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.appearance.user_dialog.avatar_frame'
                    )}
                    description={t(
                        'view.settings.appearance.user_dialog.avatar_frame_description'
                    )}
                >
                    <Switch
                        checked={prefs.showUserDialogAvatarFrame}
                        onCheckedChange={onShowUserDialogAvatarFrameChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.appearance.user_dialog.profile_effect'
                    )}
                    description={t(
                        'view.settings.appearance.user_dialog.profile_effect_description'
                    )}
                >
                    <Switch
                        checked={prefs.showUserDialogProfileEffect}
                        onCheckedChange={onShowUserDialogProfileEffectChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.appearance.user_dialog.nameplate_effect'
                    )}
                    description={t(
                        'view.settings.appearance.user_dialog.nameplate_effect_description'
                    )}
                >
                    <Switch
                        checked={prefs.showUserDialogNameplateEffect}
                        onCheckedChange={onShowUserDialogNameplateEffectChange}
                    />
                </Field>
            </FieldGroup>

            <FieldGroup className="gap-0">
                <SettingsSectionHeading
                    title={t(
                        'view.settings.appearance.user_dialog.additional_information'
                    )}
                />
                <Field
                    label={t(
                        'view.settings.appearance.user_dialog.vrchat_notes'
                    )}
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
            </FieldGroup>
        </SettingsCard>
    );
}
