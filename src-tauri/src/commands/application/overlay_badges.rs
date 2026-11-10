#![allow(non_snake_case)]

use vrcx_0_contracts::overlay_badges::OverlayUserBadges;
use vrcx_0_runtime_host_desktop::overlay_badges::set_overlay_user_badges;

#[tauri::command(async)]
#[specta::specta]
pub fn app__overlay_user_badges_set(badges: OverlayUserBadges) {
    set_overlay_user_badges(badges);
}
