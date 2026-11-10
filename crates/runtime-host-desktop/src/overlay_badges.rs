//! Fork: user badges from the app window for the VR overlay, HMD
//! notifications and the Desktop Overlay. Only kept in memory.

use vrcx_0_contracts::overlay_badges::OverlayUserBadges;

#[cfg(any(windows, target_os = "linux"))]
pub fn set_overlay_user_badges(badges: OverlayUserBadges) {
    vrcx_0_overlay_runtime::set_overlay_user_badges(badges);
}

/// No overlay is built for this platform.
#[cfg(not(any(windows, target_os = "linux")))]
pub fn set_overlay_user_badges(_badges: OverlayUserBadges) {}
