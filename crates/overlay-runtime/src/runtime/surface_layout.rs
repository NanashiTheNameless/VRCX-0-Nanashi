use vrcx_0_vr_overlay::{OverlaySize, OverlaySurfaceId, MAIN_SURFACE_ID};
use vrcx_0_vr_overlay_backend::{
    OverlayActivationButton, OverlayPlacement, OverlaySurfaceConfig, WristAnchor,
};

use crate::config::{HmdNotificationConfig, VrOverlayRuntimeConfig, WristOverlayHand};
use crate::eligibility::WristOverlayStartMode;

use super::{ActiveOverlaySurfaces, VrOverlayRuntime, HMD_PANEL_WIDTH_PX};

fn start_mode_allows(start_mode: WristOverlayStartMode, game_running: bool) -> bool {
    match start_mode {
        WristOverlayStartMode::SteamVr => true,
        WristOverlayStartMode::Vrchat => game_running,
    }
}

pub(super) fn surface_active_for_start_mode(
    enabled: bool,
    start_mode: WristOverlayStartMode,
    backend_available: bool,
    steamvr_running: bool,
    game_running: bool,
) -> bool {
    enabled && backend_available && steamvr_running && start_mode_allows(start_mode, game_running)
}

pub(super) fn overlay_surface_configs(
    active_surfaces: ActiveOverlaySurfaces,
    config: VrOverlayRuntimeConfig,
    runtime: &VrOverlayRuntime,
) -> Vec<OverlaySurfaceConfig> {
    let force_visible = runtime.is_test_mode();
    let mut configs = Vec::new();
    if active_surfaces.wrist {
        configs.extend(wrist_surface_configs(config, force_visible));
    }
    if active_surfaces.hmd {
        configs.push(hmd_surface_config(config.hmd));
    }
    configs
}

fn wrist_surface_configs(
    config: VrOverlayRuntimeConfig,
    force_visible: bool,
) -> Vec<OverlaySurfaceConfig> {
    wrist_surface_ids(config.hand)
        .into_iter()
        .map(|surface_id| {
            let device_hint = if surface_id.as_str() == "wrist-right" {
                "right-hand"
            } else {
                "left-hand"
            };
            wrist_surface_config(surface_id.as_str(), device_hint, config, force_visible)
        })
        .collect()
}

pub(super) fn wrist_surface_ids(hand: WristOverlayHand) -> Vec<OverlaySurfaceId> {
    let mut surface_ids = Vec::new();
    if matches!(hand, WristOverlayHand::Left | WristOverlayHand::Both) {
        surface_ids.push(OverlaySurfaceId::new("wrist-left"));
    }
    if matches!(hand, WristOverlayHand::Right | WristOverlayHand::Both) {
        surface_ids.push(OverlaySurfaceId::new("wrist-right"));
    }
    surface_ids
}

fn wrist_surface_config(
    surface_id: &str,
    device_hint: &str,
    config: VrOverlayRuntimeConfig,
    force_visible: bool,
) -> OverlaySurfaceConfig {
    let placement = config.wrist_placement;
    let timeout_ms = u64::from(config.wrist_timeout_secs) * 1_000;
    OverlaySurfaceConfig {
        surface_id: OverlaySurfaceId::new(surface_id),
        size: config.render.size.overlay_size(),
        physical_width_meters: placement.physical_width_meters(),
        placement: OverlayPlacement::TrackedDeviceRelative {
            device_hint: device_hint.to_string(),
            adjust: placement.adjust(),
        },
        activation_button: config.button,
        force_visible,
        visible_duration_ms: timeout_ms,
        switch_cooldown_ms: u64::from(config.wrist_switch_cooldown_ms),
    }
}

/// HMD pixel density reference: the original 960px panel was 0.991m wide.
pub(super) const HMD_SURFACE_SIZE: OverlaySize = OverlaySize::new(960, 528);
const HMD_SURFACE_DISTANCE_METERS: f32 = 1.2;
pub(super) const HMD_SURFACE_WIDTH_METERS: f32 = 0.991;
pub(super) const HMD_STACK_INSET_PX: f32 = 20.0;

pub(super) fn hmd_surface_config(hmd: HmdNotificationConfig) -> OverlaySurfaceConfig {
    let HmdNotificationConfig {
        position,
        style,
        text_percent,
        ..
    } = hmd;
    let meters_per_px = HMD_SURFACE_WIDTH_METERS / HMD_SURFACE_SIZE.width as f32;
    let newest_card_y = HMD_SURFACE_DISTANCE_METERS
        * position.newest_card_angle_degrees().to_radians().tan()
        + f32::from(hmd.up_cm) / 100.0;
    // The panel is only as tall as its cards, so the edge holding the newest
    // card is anchored and the stack grows away from it.
    let card_half_height = style.single_card_height_px() * f32::from(text_percent) / 100.0 / 2.0;
    let edge_offset = (HMD_STACK_INSET_PX + card_half_height) * meters_per_px;
    let (offset_y_meters, anchor) = if position.stacks_upward() {
        (newest_card_y - edge_offset, WristAnchor::Bottom)
    } else {
        (newest_card_y + edge_offset, WristAnchor::Top)
    };
    OverlaySurfaceConfig {
        surface_id: OverlaySurfaceId::new(MAIN_SURFACE_ID),
        size: OverlaySize::new(HMD_PANEL_WIDTH_PX, HMD_SURFACE_SIZE.height),
        physical_width_meters: HMD_PANEL_WIDTH_PX as f32 * meters_per_px,
        placement: OverlayPlacement::HeadLocked {
            offset_x_meters: f32::from(hmd.side_cm) / 100.0,
            offset_y_meters,
            distance_meters: HMD_SURFACE_DISTANCE_METERS,
            anchor: Some(anchor),
        },
        activation_button: OverlayActivationButton::Grip,
        force_visible: false,
        // HMD toasts expire per toast; the surface itself does not time out.
        visible_duration_ms: u64::MAX,
        switch_cooldown_ms: 0,
    }
}
