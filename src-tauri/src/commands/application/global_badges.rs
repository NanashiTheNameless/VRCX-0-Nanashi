#![allow(non_snake_case)]

use vrcx_0_contracts::global_badges::GlobalBadgeCatalog;
use vrcx_0_runtime_host_desktop::global_badges::global_badges_catalog;

#[tauri::command(async)]
#[specta::specta]
pub fn app__global_badges_get() -> GlobalBadgeCatalog {
    global_badges_catalog()
}
