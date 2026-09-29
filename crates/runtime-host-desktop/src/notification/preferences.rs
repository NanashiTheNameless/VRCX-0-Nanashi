use vrcx_0_persistence::config::ConfigRepository;

use super::{
    NotificationDeliveryCondition, NotificationDeliveryPreferences, NotificationTtsNameMode,
};

pub fn load_preferences(config: &ConfigRepository) -> NotificationDeliveryPreferences {
    NotificationDeliveryPreferences {
        desktop_toast: NotificationDeliveryCondition::from_config(&config_string(
            config,
            "desktopToast",
            "Never",
        )),
        desktop_notification_sound: config_bool(config, "desktopNotificationSound", false),
        notification_tts: NotificationDeliveryCondition::from_config(&config_string(
            config,
            "notificationTTS",
            "Never",
        )),
        notification_tts_name_mode: config_tts_name_mode(config),
        notification_tts_voice_native: config_string(config, "notificationTTSVoiceNative", ""),
        notification_tts_volume: config_int_with_legacy(config, "notificationTTSVolume", 100)
            .clamp(0, 100) as u8,
        xs_notifications: config_bool_with_legacy(config, "xsNotifications", false),
        ovrt_hud_notifications: config_bool_with_legacy(config, "ovrtHudNotifications", false),
        ovrt_wrist_notifications: config_bool_with_legacy(config, "ovrtWristNotifications", false),
        image_notifications: config_bool_with_legacy(config, "imageNotifications", true),
        notification_timeout_ms: config_int_with_legacy(config, "notificationTimeout", 3000),
        notification_opacity_percent: config_int_with_legacy(config, "notificationOpacity", 100),
        show_instance_id_in_location: config_bool(config, "VRCX_showInstanceIdInLocation", false),
    }
}

pub fn config_tts_name_mode(config: &ConfigRepository) -> NotificationTtsNameMode {
    let configured = config_string(config, "notificationTTSNameMode", "");
    if !configured.trim().is_empty() {
        return notification_tts_name_mode(&configured);
    }
    if config_bool(config, "notificationTTSNickName", false) {
        NotificationTtsNameMode::Note
    } else {
        NotificationTtsNameMode::Username
    }
}

pub fn seed_hmd_notifications_default(
    config: &ConfigRepository,
) -> Result<Option<bool>, vrcx_0_persistence::Error> {
    if config.get_raw("hmdNotificationsEnabled")?.is_some() {
        return Ok(None);
    }
    let external_overlay_enabled = [
        "xsNotifications",
        "ovrtHudNotifications",
        "ovrtWristNotifications",
    ]
    .into_iter()
    .any(|key| config_bool_with_legacy(config, key, false));
    let enabled = !external_overlay_enabled;
    config.set_bool("hmdNotificationsEnabled", enabled)?;
    Ok(Some(enabled))
}

pub fn notification_tts_name_mode(value: &str) -> NotificationTtsNameMode {
    match value {
        "note" => NotificationTtsNameMode::Note,
        "usernameAndNote" => NotificationTtsNameMode::UsernameAndNote,
        _ => NotificationTtsNameMode::Username,
    }
}

fn config_string(config: &ConfigRepository, key: &str, default_value: &str) -> String {
    config
        .get_string(key, default_value)
        .unwrap_or_else(|_| default_value.to_string())
}

fn config_bool(config: &ConfigRepository, key: &str, default_value: bool) -> bool {
    config.get_bool(key, default_value).unwrap_or(default_value)
}

fn config_bool_with_legacy(config: &ConfigRepository, key: &str, default_value: bool) -> bool {
    if config.get_raw(key).ok().flatten().is_some() {
        return config_bool(config, key, default_value);
    }
    if let Some(legacy_key) = legacy_overlay_notification_key(key) {
        if config.get_raw(legacy_key).ok().flatten().is_some() {
            return config_bool(config, legacy_key, default_value);
        }
    }
    default_value
}

fn config_int_with_legacy(config: &ConfigRepository, key: &str, default_value: i32) -> i32 {
    if let Some(raw) = config.get_raw(key).ok().flatten() {
        return parse_config_int(&raw, default_value);
    }
    if let Some(legacy_key) = legacy_overlay_notification_key(key) {
        if let Some(raw) = config.get_raw(legacy_key).ok().flatten() {
            return parse_config_int(&raw, default_value);
        }
    }
    default_value
}

fn parse_config_int(value: &str, default_value: i32) -> i32 {
    value.trim().parse::<i32>().unwrap_or(default_value)
}

fn legacy_overlay_notification_key(key: &str) -> Option<&'static str> {
    match key {
        "xsNotifications" => Some("VRCX-0_xsNotifications"),
        "ovrtHudNotifications" => Some("VRCX-0_ovrtHudNotifications"),
        "ovrtWristNotifications" => Some("VRCX-0_ovrtWristNotifications"),
        "imageNotifications" => Some("VRCX-0_imageNotifications"),
        "notificationTimeout" => Some("VRCX-0_notificationTimeout"),
        "notificationOpacity" => Some("VRCX-0_notificationOpacity"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::test_config;
    use super::seed_hmd_notifications_default;

    #[test]
    fn hmd_default_seed_preserves_legacy_forwarding_contract() {
        let (_dir, config) = test_config("legacy-enabled");
        config.set_bool("VRCX-0_xsNotifications", true).unwrap();

        assert_eq!(
            seed_hmd_notifications_default(&config).unwrap(),
            Some(false)
        );
        assert!(!config.get_bool("hmdNotificationsEnabled", true).unwrap());
    }

    #[test]
    fn hmd_default_seed_runs_once() {
        let (_dir, config) = test_config("existing-value");
        config.set_bool("hmdNotificationsEnabled", false).unwrap();

        assert_eq!(seed_hmd_notifications_default(&config).unwrap(), None);
        assert!(!config.get_bool("hmdNotificationsEnabled", true).unwrap());
    }

    #[test]
    fn tts_name_mode_preserves_legacy_nickname_setting() {
        let (_dir, config) = test_config("tts-name-mode-legacy");

        config.set_bool("notificationTTSNickName", true).unwrap();
        assert_eq!(
            super::config_tts_name_mode(&config),
            super::NotificationTtsNameMode::Note
        );

        config
            .set_string("notificationTTSNameMode", "usernameAndNote")
            .unwrap();
        assert_eq!(
            super::config_tts_name_mode(&config),
            super::NotificationTtsNameMode::UsernameAndNote
        );
    }

    #[test]
    fn tts_volume_defaults_and_clamps_persisted_values() {
        let (_dir, config) = test_config("tts-volume");

        assert_eq!(
            super::load_preferences(&config).notification_tts_volume,
            100
        );

        config.set_string("notificationTTSVolume", "42").unwrap();
        assert_eq!(super::load_preferences(&config).notification_tts_volume, 42);

        config.set_string("notificationTTSVolume", "-1").unwrap();
        assert_eq!(super::load_preferences(&config).notification_tts_volume, 0);

        config.set_string("notificationTTSVolume", "101").unwrap();
        assert_eq!(
            super::load_preferences(&config).notification_tts_volume,
            100
        );
    }
}
