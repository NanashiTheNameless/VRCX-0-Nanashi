#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use vrcx_0_host_desktop::auto_launch::{
    picked_app_launcher_target, AppLauncherEntry, AppLauncherEntryKind, AppLauncherPickedTarget,
    AppLauncherSnapshot, AppLauncherTargetPickKind,
};
use vrcx_0_host_desktop::host_capabilities::{
    require_host_capability, require_host_capability_supported, HostCapability,
};

use crate::error::AppError;
use crate::state::AppState;

fn require_app_launcher_supported() -> Result<(), AppError> {
    require_host_capability_supported(HostCapability::GameProcessMonitor)?;
    require_host_capability_supported(HostCapability::GameLaunch)?;
    Ok(())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__app_launcher_snapshot_get(
    state: State<'_, AppState>,
) -> Result<AppLauncherSnapshot, AppError> {
    require_app_launcher_supported()?;
    Ok(state.runtime_host().app_launcher_snapshot())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__app_launcher_enabled_set(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<AppLauncherSnapshot, AppError> {
    require_app_launcher_supported()?;
    Ok(state.runtime_host().set_app_launcher_enabled(enabled)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__app_launcher_entries_set(
    state: State<'_, AppState>,
    entries: Vec<AppLauncherEntry>,
) -> Result<AppLauncherSnapshot, AppError> {
    require_app_launcher_supported()?;
    Ok(state.runtime_host().set_app_launcher_entries(entries)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__app_launcher_entry_enabled_set(
    state: State<'_, AppState>,
    entry_id: String,
    enabled: bool,
) -> Result<AppLauncherSnapshot, AppError> {
    require_app_launcher_supported()?;
    Ok(state
        .runtime_host()
        .set_app_launcher_entry_enabled(&entry_id, enabled)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__app_launcher_entry_test(
    state: State<'_, AppState>,
    entry_id: String,
) -> Result<AppLauncherSnapshot, AppError> {
    require_host_capability(HostCapability::GameLaunch)?;
    Ok(state.runtime_host().test_app_launcher_entry(&entry_id)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__app_launcher_test_run_stop(
    state: State<'_, AppState>,
    run_id: String,
) -> Result<AppLauncherSnapshot, AppError> {
    require_app_launcher_supported()?;
    Ok(state.runtime_host().stop_app_launcher_test_run(&run_id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__app_launcher_target_pick(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    kind: AppLauncherTargetPickKind,
) -> Result<Option<AppLauncherPickedTarget>, AppError> {
    require_app_launcher_supported()?;
    let _ = kind;
    let builder = app_handle.dialog().file();
    #[cfg(target_os = "windows")]
    let builder = builder.add_filter("Applications and shortcuts", &["exe", "lnk", "url"]);

    let result = super::dialog::pick_file(builder).await;
    let Some(file_path) = result else {
        return Ok(None);
    };

    let path = match file_path {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        other => PathBuf::from(other.to_string()),
    };
    let picked = picked_app_launcher_target(path).map_err(AppError::Custom)?;
    if matches!(picked.kind, AppLauncherEntryKind::LocalApp) {
        state
            .runtime_host()
            .register_host_file_access(PathBuf::from(&picked.target));
    }
    Ok(Some(picked))
}
