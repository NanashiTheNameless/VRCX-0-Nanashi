import {
    avatarAutoCleanupOptions,
    desktopToastOptions,
    notificationTtsNameModeOptions,
    notificationTtsOptions,
    sqliteTableSizeRows
} from '../settingsOptions';
import type { SettingsSectionInput } from '../settingsPageStateSectionTypes';

type NotificationsSectionInput = SettingsSectionInput<
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
        speakNotificationTts
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
