use crate::VrOverlayRuntimeServices;
use vrcx_0_host_desktop::vr_overlay::OverlayActivationButton;

use super::eligibility::WristOverlayStartMode;
use super::localization::OverlayLocale;
use super::runtime::{
    HmdNotificationConfig, HmdNotificationPosition, HmdNotificationStyle, VrOverlayRuntimeConfig,
    WristOverlayHand,
};
use super::service::OverlayBackendPreference;
use super::surfaces::wrist::{wrist_anchor_from_config, MAX_TEXT_PERCENT, MIN_TEXT_PERCENT};
use super::{
    WristOverlayRenderOptions, WristOverlaySizePreset, WristPageOrder, WristPlacement,
    WristPlayersSort,
};

pub const VR_OVERLAY_ENABLED_CONFIG_KEY: &str = "wristOverlayEnabled";
pub const VR_OVERLAY_BACKEND_CONFIG_KEY: &str = "wristOverlayBackend";
pub const VR_OVERLAY_START_MODE_CONFIG_KEY: &str = "wristOverlayStartMode";
pub const VR_OVERLAY_BUTTON_CONFIG_KEY: &str = "wristOverlayButton";
pub const VR_OVERLAY_HAND_CONFIG_KEY: &str = "wristOverlayHand";
pub const VR_OVERLAY_SIZE_CONFIG_KEY: &str = "wristOverlaySize";
pub const VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY: &str = "wristOverlayHidePrivateWorlds";
pub const VR_OVERLAY_DARK_BACKGROUND_CONFIG_KEY: &str = "wristOverlayDarkBackground";
pub const VR_OVERLAY_SHOW_DEVICES_CONFIG_KEY: &str = "wristOverlayShowDevices";
pub const VR_OVERLAY_SHOW_BATTERY_PERCENT_CONFIG_KEY: &str = "wristOverlayShowBatteryPercent";
pub const VR_OVERLAY_PAGES_CONFIG_KEY: &str = "wristOverlayPages";
pub const VR_OVERLAY_PLAYERS_SORT_CONFIG_KEY: &str = "wristOverlayPlayersSort";
pub const VR_OVERLAY_TIMEOUT_SECONDS_CONFIG_KEY: &str = "wristOverlayTimeoutSeconds";
pub const VR_OVERLAY_WIDTH_CM_CONFIG_KEY: &str = "wristOverlayWidthCm";
pub const VR_OVERLAY_ANCHOR_CONFIG_KEY: &str = "wristOverlayAnchor";
pub const VR_OVERLAY_MAX_HEIGHT_CM_CONFIG_KEY: &str = "wristOverlayMaxHeightCm";
pub const VR_OVERLAY_HEADER_TEXT_PERCENT_CONFIG_KEY: &str = "wristOverlayHeaderTextPercent";
pub const VR_OVERLAY_FOOTER_TEXT_PERCENT_CONFIG_KEY: &str = "wristOverlayFooterTextPercent";
pub const VR_OVERLAY_CONTENT_TEXT_PERCENT_CONFIG_KEY: &str = "wristOverlayContentTextPercent";
pub const HMD_NOTIFICATION_TEXT_PERCENT_CONFIG_KEY: &str = "hmdNotificationTextPercent";
pub const VR_OVERLAY_OFFSET_SIDE_CM_CONFIG_KEY: &str = "wristOverlayOffsetSideCm";
pub const VR_OVERLAY_OFFSET_UP_CM_CONFIG_KEY: &str = "wristOverlayOffsetUpCm";
pub const VR_OVERLAY_OFFSET_OUT_CM_CONFIG_KEY: &str = "wristOverlayOffsetOutCm";
pub const VR_OVERLAY_TILT_DEGREES_CONFIG_KEY: &str = "wristOverlayTiltDegrees";
pub const HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY: &str = "hmdNotificationsEnabled";
pub const HMD_NOTIFICATION_START_MODE_CONFIG_KEY: &str = "hmdNotificationStartMode";
pub const HMD_NOTIFICATION_TIMEOUT_CONFIG_KEY: &str = "hmdNotificationTimeout";
pub const HMD_NOTIFICATION_OPACITY_CONFIG_KEY: &str = "hmdNotificationOpacity";
pub const HMD_NOTIFICATION_POSITION_CONFIG_KEY: &str = "hmdNotificationPosition";
pub const HMD_NOTIFICATION_STYLE_CONFIG_KEY: &str = "hmdNotificationStyle";
pub const HMD_NOTIFICATION_AVATARS_CONFIG_KEY: &str = "hmdNotificationAvatars";
const APP_LANGUAGE_CONFIG_KEY: &str = "appLanguage";
const DATE_TIME_HOUR12_CONFIG_KEY: &str = "dtHour12";
const SHOW_INSTANCE_ID_IN_LOCATION_CONFIG_KEY: &str = "VRCX_showInstanceIdInLocation";

pub(super) fn load_runtime_config(
    services: &dyn VrOverlayRuntimeServices,
) -> VrOverlayRuntimeConfig {
    let config = services.config();
    let start_mode = config
        .get_string(VR_OVERLAY_START_MODE_CONFIG_KEY, "vrchatVrMode")
        .map(|value| WristOverlayStartMode::from_config(&value))
        .unwrap_or_default();
    let backend = config
        .get_string(VR_OVERLAY_BACKEND_CONFIG_KEY, "auto")
        .map(|value| OverlayBackendPreference::from_config(&value))
        .unwrap_or_default();
    let button = config
        .get_string(VR_OVERLAY_BUTTON_CONFIG_KEY, "grip")
        .map(|value| match value.trim() {
            "menu" => OverlayActivationButton::Menu,
            _ => OverlayActivationButton::Grip,
        })
        .unwrap_or_default();
    let hand = config
        .get_string(VR_OVERLAY_HAND_CONFIG_KEY, "left")
        .map(|value| WristOverlayHand::from_config(&value))
        .unwrap_or_default();
    let size = config
        .get_string(
            VR_OVERLAY_SIZE_CONFIG_KEY,
            WristOverlaySizePreset::Normal.as_config(),
        )
        .map(|value| WristOverlaySizePreset::from_config(&value))
        .unwrap_or_default();
    let hide_private_worlds = config
        .get_bool(VR_OVERLAY_HIDE_PRIVATE_WORLDS_CONFIG_KEY, false)
        .unwrap_or(false);
    let dark_background = config
        .get_bool(VR_OVERLAY_DARK_BACKGROUND_CONFIG_KEY, true)
        .unwrap_or(true);
    let show_devices = config
        .get_bool(VR_OVERLAY_SHOW_DEVICES_CONFIG_KEY, true)
        .unwrap_or(true);
    let show_battery_percent = config
        .get_bool(VR_OVERLAY_SHOW_BATTERY_PERCENT_CONFIG_KEY, false)
        .unwrap_or(false);
    let hmd_enabled = config
        .get_bool(HMD_NOTIFICATIONS_ENABLED_CONFIG_KEY, false)
        .unwrap_or(false);
    let hmd_start_mode = config
        .get_string(HMD_NOTIFICATION_START_MODE_CONFIG_KEY, "vrchatVrMode")
        .map(|value| WristOverlayStartMode::from_config(&value))
        .unwrap_or_default();
    let hmd_timeout_ms = config
        .get_raw(HMD_NOTIFICATION_TIMEOUT_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(5_000)
        .clamp(1_000, 30_000);
    let hmd_opacity_percent = config
        .get_raw(HMD_NOTIFICATION_OPACITY_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<u8>().ok())
        .unwrap_or(90)
        .min(100);
    let hmd_position = config
        .get_string(HMD_NOTIFICATION_POSITION_CONFIG_KEY, "bottom")
        .map(|value| HmdNotificationPosition::from_config(&value))
        .unwrap_or_default();
    let hmd_style = config
        .get_string(HMD_NOTIFICATION_STYLE_CONFIG_KEY, "standard")
        .map(|value| HmdNotificationStyle::from_config(&value))
        .unwrap_or_default();
    let locale = config
        .get_string(APP_LANGUAGE_CONFIG_KEY, "en")
        .map(|value| OverlayLocale::from_config(&value))
        .unwrap_or_default();
    let dt_hour12 = config
        .get_bool(DATE_TIME_HOUR12_CONFIG_KEY, true)
        .unwrap_or(true);
    let show_instance_id_in_location = config
        .get_bool(SHOW_INSTANCE_ID_IN_LOCATION_CONFIG_KEY, false)
        .unwrap_or(false);
    let wrist_pages = config
        .get_string(VR_OVERLAY_PAGES_CONFIG_KEY, WristPageOrder::DEFAULT_CONFIG)
        .map(|value| WristPageOrder::from_config(&value))
        .unwrap_or_default();
    let wrist_players_sort = config
        .get_string(VR_OVERLAY_PLAYERS_SORT_CONFIG_KEY, "name")
        .map(|value| WristPlayersSort::from_config(&value))
        .unwrap_or_default();
    let wrist_timeout_secs = config
        .get_raw(VR_OVERLAY_TIMEOUT_SECONDS_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|value| value.trim().parse::<u8>().ok())
        .unwrap_or(15)
        .clamp(5, 255);
    let raw_int = |key: &str| {
        config
            .get_raw(key)
            .ok()
            .flatten()
            .and_then(|value| value.trim().parse::<i32>().ok())
    };
    let offset_cm = |key: &str| {
        let max = i32::from(WristPlacement::MAX_OFFSET_CM);
        raw_int(key).unwrap_or(0).clamp(-max, max) as i8
    };
    let text_percent = |key: &str| {
        raw_int(key)
            .unwrap_or(100)
            .clamp(i32::from(MIN_TEXT_PERCENT), i32::from(MAX_TEXT_PERCENT)) as u8
    };
    // Without a saved width, keep the physical size of the old size preset.
    let default_placement = WristPlacement::for_size(size);
    let width_cm = raw_int(VR_OVERLAY_WIDTH_CM_CONFIG_KEY)
        .unwrap_or(i32::from(default_placement.width_cm))
        .clamp(
            i32::from(WristPlacement::MIN_WIDTH_CM),
            i32::from(WristPlacement::MAX_WIDTH_CM),
        ) as u8;
    let wrist_placement = WristPlacement {
        width_cm,
        max_height_cm: raw_int(VR_OVERLAY_MAX_HEIGHT_CM_CONFIG_KEY)
            .unwrap_or(i32::from(width_cm) * 2)
            .clamp(
                i32::from(WristPlacement::MIN_HEIGHT_CM),
                i32::from(WristPlacement::MAX_HEIGHT_CM),
            ) as u8,
        anchor: config
            .get_string(VR_OVERLAY_ANCHOR_CONFIG_KEY, "bottom")
            .map(|value| wrist_anchor_from_config(&value))
            .unwrap_or_default(),
        side_cm: offset_cm(VR_OVERLAY_OFFSET_SIDE_CM_CONFIG_KEY),
        up_cm: offset_cm(VR_OVERLAY_OFFSET_UP_CM_CONFIG_KEY),
        out_cm: offset_cm(VR_OVERLAY_OFFSET_OUT_CM_CONFIG_KEY),
        tilt_degrees: {
            let max = i32::from(WristPlacement::MAX_TILT_DEGREES);
            raw_int(VR_OVERLAY_TILT_DEGREES_CONFIG_KEY)
                .unwrap_or(0)
                .clamp(-max, max) as i8
        },
    };

    VrOverlayRuntimeConfig {
        start_mode,
        backend,
        button,
        hand,
        hmd: HmdNotificationConfig {
            enabled: hmd_enabled,
            start_mode: hmd_start_mode,
            timeout_ms: hmd_timeout_ms,
            opacity_percent: hmd_opacity_percent,
            position: hmd_position,
            style: hmd_style,
            avatars: config
                .get_bool(HMD_NOTIFICATION_AVATARS_CONFIG_KEY, true)
                .unwrap_or(true),
            text_percent: text_percent(HMD_NOTIFICATION_TEXT_PERCENT_CONFIG_KEY),
        },
        render: WristOverlayRenderOptions {
            size,
            canvas_width_px: wrist_placement.canvas_width_px(),
            canvas_max_height_px: wrist_placement.canvas_max_height_px(),
            header_text_percent: text_percent(VR_OVERLAY_HEADER_TEXT_PERCENT_CONFIG_KEY),
            footer_text_percent: text_percent(VR_OVERLAY_FOOTER_TEXT_PERCENT_CONFIG_KEY),
            content_text_percent: text_percent(VR_OVERLAY_CONTENT_TEXT_PERCENT_CONFIG_KEY),
            hide_private_worlds,
            dark_background,
            show_devices,
            show_battery_percent,
        },
        locale,
        dt_hour12,
        show_instance_id_in_location,
        wrist_pages,
        wrist_players_sort,
        wrist_timeout_secs,
        wrist_placement,
    }
}
