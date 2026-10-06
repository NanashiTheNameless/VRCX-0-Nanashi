import type { NotificationLayout } from '@/state/shellStore';

import {
    avatarAutoCleanupOptions,
    desktopToastOptions,
    notificationLayoutOptions,
    notificationTtsNameModeOptions,
    notificationTtsOptions,
    sqliteTableSizeRows
} from '../settingsOptions';
import type { SettingsSectionInput } from '../settingsPageStateSectionTypes';

type NotificationsSectionInput = SettingsSectionInput<
    | 'prefs'
    | 'commit'
    | 'setPrefs'
    | 'setNotificationLayoutPreference'
    | 'setWebhookNotificationsDialogOpen'
    | 'ttsVoices'
    | 'notificationTtsTestVisible'
    | 'notificationTtsTest'
    | 'setDesktopNotificationsDialogOpen'
    | 'setTtsNotificationsDialogOpen'
    | 'saveStringPreference'
    | 'saveBoolPreference'
    | 'savePreferenceValue'
    | 'setIntConfigPreference'
    | 'saveNotificationTtsMode'
    | 'saveNotificationTtsVoice'
    | 'setNotificationTtsTestVisible'
    | 'setNotificationTtsTest'
    | 'speakNotificationTts'
>;

type VrSectionInput = SettingsSectionInput<
    | 'setVrNotificationsDialogOpen'
    | 'setHmdNotificationsDialogOpen'
    | 'setWristFeedNotificationsDialogOpen'
    | 'savePreferenceValue'
    | 'saveStringPreference'
    | 'saveBoolPreference'
    | 'setIntConfigPreference'
    | 'saveWristOverlayEnabled'
>;

type AdvancedSectionInput = SettingsSectionInput<
    | 'sqliteTableSizes'
    | 'onlineVisitCount'
    | 'configTreeData'
    | 'appDataDirState'
    | 'saveBoolPreference'
    | 'handleGameLogDisabledChange'
    | 'handleFeedPersistenceDisabledChange'
    | 'saveStringPreference'
    | 'setPurgeDialogOpen'
    | 'refreshSqliteTableSizes'
    | 'refreshOnlineVisits'
    | 'refreshConfigTreeData'
    | 'openAppDataDirSelector'
    | 'resetAppDataDir'
    | 'cleanupAppDataDir'
    | 'dismissAppDataDirCleanup'
    | 'setConfigTreeData'
>;

export function buildNotificationsSection({
    prefs,
    commit,
    setPrefs,
    setNotificationLayoutPreference,
    setWebhookNotificationsDialogOpen,
    ttsVoices,
    notificationTtsTestVisible,
    notificationTtsTest,
    setDesktopNotificationsDialogOpen,
    setTtsNotificationsDialogOpen,
    saveStringPreference,
    saveBoolPreference,
    savePreferenceValue,
    setIntConfigPreference,
    saveNotificationTtsMode,
    saveNotificationTtsVoice,
    setNotificationTtsTestVisible,
    setNotificationTtsTest,
    speakNotificationTts
}: NotificationsSectionInput) {
    return {
        desktopToastOptions,
        notificationTtsOptions,
        notificationTtsNameModeOptions,
        ttsVoices,
        notificationTtsTestVisible,
        notificationTtsTest,
        setDesktopNotificationsDialogOpen,
        setTtsNotificationsDialogOpen,
        saveStringPreference,
        saveBoolPreference,
        savePreferenceValue,
        setIntConfigPreference,
        saveNotificationTtsMode,
        saveNotificationTtsVoice,
        setNotificationTtsTestVisible,
        setNotificationTtsTest,
        speakNotificationTts,
        notificationLayoutOptions,
        setWebhookNotificationsDialogOpen,
        onNotificationLayoutChange: (value: NotificationLayout) => {
            commit(
                async () => {
                    const nextLayout =
                        await setNotificationLayoutPreference(value);
                    setPrefs((current) => ({
                        ...current,
                        notificationLayout: nextLayout
                    }));
                },
                () => {
                    const previous = prefs.notificationLayout;
                    setPrefs((current) => ({
                        ...current,
                        notificationLayout: value
                    }));
                    return () =>
                        setPrefs((current) => ({
                            ...current,
                            notificationLayout: previous
                        }));
                }
            );
        },
        onNotificationIconDotChange: (checked: boolean) => {
            saveBoolPreference(
                'notificationIconDot',
                'notificationIconDot',
                checked
            );
        },
        onTaskbarIconDotChange: (checked: boolean) => {
            saveBoolPreference('taskbarIconDot', 'taskbarIconDot', checked);
        },
        onFriendLogNotificationDotChange: (checked: boolean) => {
            saveBoolPreference(
                'friendLogNotificationDot',
                'friendLogNotificationDot',
                checked
            );
        }
    };
}

export function buildVrSection({
    setVrNotificationsDialogOpen,
    setHmdNotificationsDialogOpen,
    setWristFeedNotificationsDialogOpen,
    savePreferenceValue,
    saveStringPreference,
    saveBoolPreference,
    setIntConfigPreference,
    saveWristOverlayEnabled
}: VrSectionInput) {
    return {
        setVrNotificationsDialogOpen,
        setHmdNotificationsDialogOpen,
        setWristFeedNotificationsDialogOpen,
        savePreferenceValue,
        saveStringPreference,
        saveBoolPreference,
        setIntConfigPreference,
        saveWristOverlayEnabled
    };
}

export function buildAdvancedSection({
    sqliteTableSizes,
    onlineVisitCount,
    configTreeData,
    appDataDirState,
    saveBoolPreference,
    handleGameLogDisabledChange,
    handleFeedPersistenceDisabledChange,
    saveStringPreference,
    setPurgeDialogOpen,
    refreshSqliteTableSizes,
    refreshOnlineVisits,
    refreshConfigTreeData,
    openAppDataDirSelector,
    resetAppDataDir,
    cleanupAppDataDir,
    dismissAppDataDirCleanup,
    setConfigTreeData
}: AdvancedSectionInput) {
    return {
        avatarAutoCleanupOptions,
        sqliteTableSizes,
        sqliteTableSizeRows,
        onlineVisitCount,
        configTreeData,
        appDataDirState,
        saveBoolPreference,
        handleGameLogDisabledChange,
        handleFeedPersistenceDisabledChange,
        saveStringPreference,
        setPurgeDialogOpen,
        refreshSqliteTableSizes,
        refreshOnlineVisits,
        refreshConfigTreeData,
        openAppDataDirSelector,
        resetAppDataDir,
        cleanupAppDataDir,
        dismissAppDataDirCleanup,
        setConfigTreeData
    };
}
