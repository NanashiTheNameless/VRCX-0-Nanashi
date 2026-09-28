import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY } from '@/services/changelogService';
import { restartApplication } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import type { AppUpdateMode } from '@/shared/appUpdateMode';
import { isUpdateCheckDisabledBuild } from '@/shared/buildLabel';
import { usePreferencesStore } from '@/state/preferencesStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { useSettingsPageSection } from '../SettingsPageStateContext';

export function useSettingsSystemTabState() {
    const { t } = useTranslation();
    const system = useSettingsPageSection('system');
    const hostPlatform = useRuntimeStore(
        (state) => state.hostCapabilities.platform
    );
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const prefs = usePreferencesStore(
        useShallow((state) => ({
            isStartAtWindowsStartup: state.isStartAtWindowsStartup,
            isStartAsMinimizedState: state.isStartAsMinimizedState,
            isCloseToTray: state.isCloseToTray,
            systemWindowFrame: state.systemWindowFrame,
            autoLoginDelayEnabled: state.autoLoginDelayEnabled,
            autoLoginDelaySeconds: state.autoLoginDelaySeconds,
            autoUpdateMode: state.autoUpdateVRCX,
            showPostUpdateChangelogToast: state.showPostUpdateChangelogToast,
            backgroundModeEnabled: state.backgroundModeEnabled,
            backgroundModeDelayEnabled: state.backgroundModeDelayEnabled,
            backgroundModeDelayMinutes: state.backgroundModeDelayMinutes,
            proxyEnabled: state.proxyEnabled,
            proxyServer: state.proxyServer
        }))
    );
    const {
        savePreferenceValue,
        saveBoolPreference,
        saveStringPreference,
        setProxyEnabledPreference,
        setStartAtWindowsStartupPreference,
        setStartAsMinimizedPreference,
        setCloseToTrayPreference,
        setSystemWindowFramePreference,
        promptAutoLoginDelaySeconds,
        promptBackgroundModeDelayMinutes
    } = system;

    return {
        hostPlatform,
        isStartAtWindowsStartup: prefs.isStartAtWindowsStartup,
        isStartAsMinimizedState: prefs.isStartAsMinimizedState,
        isCloseToTray: prefs.isCloseToTray,
        systemWindowFrame: prefs.systemWindowFrame,
        autoLoginDelayEnabled: prefs.autoLoginDelayEnabled,
        autoLoginDelaySeconds: prefs.autoLoginDelaySeconds,
        autoUpdateMode: prefs.autoUpdateMode,
        updateCheckDisabled: isUpdateCheckDisabledBuild(),
        showPostUpdateChangelogToast: prefs.showPostUpdateChangelogToast,
        backgroundModeEnabled: prefs.backgroundModeEnabled,
        backgroundModeDelayEnabled: prefs.backgroundModeDelayEnabled,
        backgroundModeDelayMinutes: prefs.backgroundModeDelayMinutes,
        proxyEnabled: prefs.proxyEnabled,
        proxyServer: prefs.proxyServer,
        onStartAtWindowsStartupChange: (enabled: boolean) => {
            savePreferenceValue('isStartAtWindowsStartup', enabled, () =>
                setStartAtWindowsStartupPreference(enabled)
            );
        },
        onStartAsMinimizedChange: (enabled: boolean) => {
            savePreferenceValue('isStartAsMinimizedState', enabled, () =>
                setStartAsMinimizedPreference(enabled)
            );
        },
        onSystemWindowFrameChange: async (enabled: boolean) => {
            const saved = await savePreferenceValue(
                'systemWindowFrame',
                enabled,
                () => setSystemWindowFramePreference(enabled)
            );
            if (saved) {
                toast.add({
                    title: t(
                        'view.settings.general.application.system_window_frame_saved'
                    ),
                    actionProps: {
                        children: t(
                            'view.settings.general.application.system_window_frame_restart_now'
                        ),
                        onClick: () => {
                            void restartApplication();
                        }
                    }
                });
            }
        },
        onCloseToTrayChange: (enabled: boolean) => {
            savePreferenceValue('isCloseToTray', enabled, () =>
                setCloseToTrayPreference(enabled)
            );
        },
        onAutoLoginDelayEnabledChange: (enabled: boolean) => {
            saveBoolPreference(
                'autoLoginDelayEnabled',
                'autoLoginDelayEnabled',
                enabled
            );
        },
        onBackgroundModeEnabledChange: (enabled: boolean) => {
            saveBoolPreference(
                'backgroundModeEnabled',
                'backgroundModeEnabled',
                enabled
            );
        },
        onBackgroundModeDelayEnabledChange: (enabled: boolean) => {
            saveBoolPreference(
                'backgroundModeDelayEnabled',
                'backgroundModeDelayEnabled',
                enabled
            );
        },
        onAutoUpdateModeChange: (mode: AppUpdateMode) => {
            saveStringPreference('autoUpdateVRCX', 'autoUpdateVRCX', mode);
        },
        onPostUpdateChangelogToastChange: (enabled: boolean) => {
            saveBoolPreference(
                'showPostUpdateChangelogToast',
                POST_UPDATE_CHANGELOG_TOAST_CONFIG_KEY,
                enabled
            );
        },
        onPromptAutoLoginDelaySeconds: () => {
            promptAutoLoginDelaySeconds();
        },
        onPromptBackgroundModeDelayMinutes: () => {
            promptBackgroundModeDelayMinutes();
        },
        onProxyEnabledChange: async (enabled: boolean) => {
            const saved = await savePreferenceValue(
                'proxyEnabled',
                enabled,
                () => setProxyEnabledPreference(enabled)
            );
            if (saved) {
                toast.add({
                    type: 'success',
                    title: t('prompt.proxy_settings.saved_restart_required')
                });
            }
        },
        onProxySettings: () => {
            setSystemHostOpen('proxySettingsOpen', true);
        }
    };
}
