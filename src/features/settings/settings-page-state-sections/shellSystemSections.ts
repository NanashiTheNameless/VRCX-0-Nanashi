import { settingsTabs } from '../settingsOptions';
import type { SettingsSectionInput } from '../settingsPageStateSectionTypes';

type ShellSectionInput = SettingsSectionInput<
    'activeSettingsTab' | 'setActiveSettingsTab'
>;

type SystemSectionInput = SettingsSectionInput<
    | 'savePreferenceValue'
    | 'saveBoolPreference'
    | 'saveStringPreference'
    | 'setProxyEnabledPreference'
    | 'setStartAtWindowsStartupPreference'
    | 'setStartAsMinimizedPreference'
    | 'setCloseToTrayPreference'
    | 'setSystemWindowFramePreference'
    | 'promptAutoLoginDelaySeconds'
    | 'promptBackgroundModeDelayMinutes'
>;

export function buildShellSection({
    activeSettingsTab,
    setActiveSettingsTab
}: ShellSectionInput) {
    return {
        activeSettingsTab,
        setActiveSettingsTab,
        settingsTabs
    };
}

export function buildSystemSection({
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
}: SystemSectionInput) {
    return {
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
    };
}
