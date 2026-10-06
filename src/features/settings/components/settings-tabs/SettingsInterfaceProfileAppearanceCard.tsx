import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { usePreferencesStore } from '@/state/preferencesStore';
import { Switch } from '@/ui/shadcn/switch';

import { useSettingsPageSection } from '../../SettingsPageStateContext';
import { SettingsCard } from '../SettingsCard';
import { Field, FieldGroup, SettingsSectionHeading } from '../SettingsField';

export function SettingsInterfaceProfileAppearanceCard() {
    const { t } = useTranslation();
    const settingsInterface = useSettingsPageSection('interface');
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            showUserDialogProfileBackground:
                state.showUserDialogProfileBackground,
            showUserDialogAvatarFrame: state.showUserDialogAvatarFrame,
            showUserDialogProfileEffect: state.showUserDialogProfileEffect,
            showUserDialogNameplateEffect: state.showUserDialogNameplateEffect,
            showSidebarAvatarFrame: state.showSidebarAvatarFrame,
            showSidebarNameplate: state.showSidebarNameplate,
            showHoverCardAvatarFrame: state.showHoverCardAvatarFrame,
            showHoverCardProfileEffect: state.showHoverCardProfileEffect,
            showHoverCardNameplate: state.showHoverCardNameplate
        }))
    );
    const {
        onShowUserDialogProfileBackgroundChange,
        onShowUserDialogAvatarFrameChange,
        onShowUserDialogProfileEffectChange,
        onShowUserDialogNameplateEffectChange,
        onShowSidebarAvatarFrameChange,
        onShowSidebarNameplateChange,
        onShowHoverCardAvatarFrameChange,
        onShowHoverCardProfileEffectChange,
        onShowHoverCardNameplateChange
    } = settingsInterface;
    const anyDecorationShown =
        prefs.showUserDialogProfileBackground ||
        prefs.showUserDialogAvatarFrame ||
        prefs.showUserDialogProfileEffect ||
        prefs.showUserDialogNameplateEffect ||
        prefs.showSidebarAvatarFrame ||
        prefs.showSidebarNameplate;

    function setAllDecorations(checked: boolean) {
        onShowUserDialogProfileBackgroundChange(checked);
        onShowUserDialogAvatarFrameChange(checked);
        onShowUserDialogProfileEffectChange(checked);
        onShowUserDialogNameplateEffectChange(checked);
        onShowSidebarAvatarFrameChange(checked);
        onShowSidebarNameplateChange(checked);
    }

    return (
        <SettingsCard
            cardId="interface.profile-appearance"
            title={t('view.settings.appearance.profile_appearance.header')}
            bodyClassName="flex flex-col gap-5"
        >
            <FieldGroup className="gap-0">
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
            </FieldGroup>

            <FieldGroup className="gap-0">
                <SettingsSectionHeading
                    title={t('view.settings.appearance.user_dialog.header')}
                />
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
                        'view.settings.appearance.profile_appearance.sidebar'
                    )}
                />
                <Field
                    label={t(
                        'view.settings.appearance.profile_appearance.sidebar_avatar_frame'
                    )}
                    description={t(
                        'view.settings.appearance.profile_appearance.sidebar_avatar_frame_description'
                    )}
                >
                    <Switch
                        checked={prefs.showSidebarAvatarFrame}
                        onCheckedChange={onShowSidebarAvatarFrameChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.appearance.profile_appearance.sidebar_nameplate'
                    )}
                    description={t(
                        'view.settings.appearance.profile_appearance.sidebar_nameplate_description'
                    )}
                >
                    <Switch
                        checked={prefs.showSidebarNameplate}
                        onCheckedChange={onShowSidebarNameplateChange}
                    />
                </Field>
            </FieldGroup>

            <FieldGroup className="gap-0">
                <SettingsSectionHeading
                    title={t(
                        'view.settings.appearance.profile_appearance.hover_card'
                    )}
                />
                <Field
                    label={t(
                        'view.settings.appearance.profile_appearance.hover_card_avatar_frame'
                    )}
                    description={t(
                        'view.settings.appearance.profile_appearance.hover_card_avatar_frame_description'
                    )}
                >
                    <Switch
                        checked={prefs.showHoverCardAvatarFrame}
                        onCheckedChange={onShowHoverCardAvatarFrameChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.appearance.profile_appearance.hover_card_profile_effect'
                    )}
                    description={t(
                        'view.settings.appearance.profile_appearance.hover_card_profile_effect_description'
                    )}
                >
                    <Switch
                        checked={prefs.showHoverCardProfileEffect}
                        onCheckedChange={onShowHoverCardProfileEffectChange}
                    />
                </Field>
                <Field
                    label={t(
                        'view.settings.appearance.profile_appearance.hover_card_nameplate'
                    )}
                    description={t(
                        'view.settings.appearance.profile_appearance.hover_card_nameplate_description'
                    )}
                >
                    <Switch
                        checked={prefs.showHoverCardNameplate}
                        onCheckedChange={onShowHoverCardNameplateChange}
                    />
                </Field>
            </FieldGroup>
        </SettingsCard>
    );
}
