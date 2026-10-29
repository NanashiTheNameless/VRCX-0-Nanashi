use vrcx_0_i18n::{text as native_text, DesktopWidgetKey, ShellKey};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TrayLabels {
    pub(crate) open: String,
    pub(crate) background_mode: String,
    pub(crate) lock: String,
    pub(crate) do_not_disturb: String,
    pub(crate) do_not_disturb_one_hour: String,
    pub(crate) do_not_disturb_three_hours: String,
    pub(crate) do_not_disturb_until_stopped: String,
    pub(crate) do_not_disturb_turn_off: String,
    pub(crate) game_isolation: String,
    pub(crate) rebuild_ui: String,
    pub(crate) sidebar_mode: String,
    pub(crate) disable_theme: String,
    pub(crate) check_updates: String,
    pub(crate) desktop_widget: String,
    pub(crate) desktop_widget_turn_on: String,
    pub(crate) desktop_widget_show: String,
    pub(crate) desktop_widget_pin: String,
    pub(crate) desktop_widget_click_through: String,
    pub(crate) desktop_widget_close: String,
    pub(crate) exit: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BackgroundModeNotificationLabels {
    pub(crate) title: String,
    pub(crate) body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AuthFailureNotificationLabels {
    pub(crate) title: String,
    pub(crate) body: String,
}

pub(crate) fn tray_labels_for_language(language: &str) -> TrayLabels {
    TrayLabels {
        open: text(language, ShellKey::NativeShellTrayOpen),
        background_mode: text(language, ShellKey::NativeShellTrayBackgroundMode),
        lock: text(language, ShellKey::NativeShellTrayLock),
        do_not_disturb: text(language, ShellKey::NativeShellTrayDoNotDisturb),
        do_not_disturb_one_hour: text(language, ShellKey::NativeShellTrayDoNotDisturbOneHour),
        do_not_disturb_three_hours: text(language, ShellKey::NativeShellTrayDoNotDisturbThreeHours),
        do_not_disturb_until_stopped: text(
            language,
            ShellKey::NativeShellTrayDoNotDisturbUntilStopped,
        ),
        do_not_disturb_turn_off: text(language, ShellKey::NativeShellTrayDoNotDisturbTurnOff),
        game_isolation: text(language, ShellKey::NativeShellTrayGameIsolation),
        rebuild_ui: text(language, ShellKey::NativeShellTrayRebuildUi),
        sidebar_mode: text(language, ShellKey::NativeShellTraySidebarMode),
        disable_theme: text(language, ShellKey::NativeShellTrayDisableTheme),
        check_updates: text(language, ShellKey::NativeShellMenuAppCheckUpdates),
        desktop_widget: native_text(language, DesktopWidgetKey::DesktopWidgetTitle),
        desktop_widget_turn_on: native_text(language, DesktopWidgetKey::DesktopWidgetTrayTurnOn),
        desktop_widget_show: native_text(language, DesktopWidgetKey::DesktopWidgetTrayShow),
        desktop_widget_pin: native_text(language, DesktopWidgetKey::DesktopWidgetMenuPin),
        desktop_widget_click_through: native_text(
            language,
            DesktopWidgetKey::DesktopWidgetMenuClickThrough,
        ),
        desktop_widget_close: native_text(language, DesktopWidgetKey::DesktopWidgetMenuClose),
        exit: text(language, ShellKey::NativeShellTrayExit),
    }
}

pub(crate) fn tray_realtime_reconnecting_for_language(language: &str) -> String {
    text(language, ShellKey::NativeShellTrayRealtimeReconnecting)
}

pub(crate) fn background_mode_notification_labels_for_language(
    language: &str,
) -> BackgroundModeNotificationLabels {
    BackgroundModeNotificationLabels {
        title: text(
            language,
            ShellKey::NativeShellNotificationBackgroundModeStartedTitle,
        ),
        body: text(
            language,
            ShellKey::NativeShellNotificationBackgroundModeStartedBody,
        ),
    }
}

pub(crate) fn auth_failure_notification_labels_for_language(
    language: &str,
) -> AuthFailureNotificationLabels {
    AuthFailureNotificationLabels {
        title: text(language, ShellKey::NativeShellNotificationAuthFailureTitle),
        body: text(language, ShellKey::NativeShellNotificationAuthFailureBody),
    }
}

fn text(language: &str, key: ShellKey) -> String {
    native_text(language, key)
}

#[cfg(test)]
mod tests {
    use super::tray_labels_for_language;

    #[test]
    fn the_tray_offers_the_activity_window_in_english() {
        let labels = tray_labels_for_language("zh-CN");

        assert_eq!(labels.desktop_widget, "Desktop Overlay");
        assert_eq!(labels.desktop_widget_turn_on, "Turn On");
        assert_eq!(labels.desktop_widget_show, "Bring to Front");
        assert_eq!(labels.desktop_widget_pin, "Always on Top");
        assert_eq!(labels.desktop_widget_click_through, "Click-Through");
        assert_eq!(labels.desktop_widget_close, "Close");
    }
}
