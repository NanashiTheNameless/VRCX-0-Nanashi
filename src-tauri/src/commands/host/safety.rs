#![allow(non_snake_case)]
use crate::{error::AppError, state::AppState};
use tauri::State;
use vrcx_0_runtime_host_desktop::safety::{SafetySettings, SafetyStatus};

#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_settings_get(state: State<'_, AppState>) -> SafetySettings {
    state.runtime_host().safety().settings()
}
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_settings_save(
    state: State<'_, AppState>,
    settings: SafetySettings,
) -> Result<SafetySettings, AppError> {
    state
        .runtime_host()
        .safety()
        .save_settings(settings)
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_watch_set(
    state: State<'_, AppState>,
    kind: String,
    id: String,
    label: String,
    enabled: bool,
) -> Result<SafetySettings, AppError> {
    state
        .runtime_host()
        .safety()
        .set_watch(&kind, id, label, enabled)
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_status(state: State<'_, AppState>) -> SafetyStatus {
    state.runtime_host().safety().status()
}
#[tauri::command(async)]
#[specta::specta]
pub async fn app__safety_sources_refresh(
    state: State<'_, AppState>,
) -> Result<SafetyStatus, AppError> {
    let safety = state.runtime_host().safety().clone();
    safety
        .refresh_sources(true)
        .await
        .map_err(AppError::Custom)?;
    Ok(safety.status())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_entry_sources(
    state: State<'_, AppState>,
    kind: String,
    id: String,
) -> Vec<String> {
    state.runtime_host().safety().entry_sources(&kind, &id)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_rows_inspect(
    state: State<'_, AppState>,
    rows: Vec<vrcx_0_runtime_host_desktop::safety::SafetyLogRow>,
) -> Result<Vec<Vec<String>>, AppError> {
    state
        .runtime_host()
        .safety()
        .inspect_rows(rows)
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_avatar_block_preview(
    state: State<'_, AppState>,
    source_id: String,
    offset: u32,
) -> Result<vrcx_0_runtime_host_desktop::safety::AvatarBlockPreview, AppError> {
    state
        .runtime_host()
        .safety()
        .avatar_block_preview(&source_id, offset)
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub async fn app__safety_avatar_blocks_apply(
    state: State<'_, AppState>,
    token: String,
    ids: Vec<String>,
) -> Result<Vec<vrcx_0_runtime_host_desktop::safety::AvatarBlockResult>, AppError> {
    let safety = state.runtime_host().safety().clone();
    safety
        .block_reviewed_avatars(&token, ids)
        .await
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_avatar_blocks_cancel(state: State<'_, AppState>) {
    state.runtime_host().safety().cancel_avatar_blocks();
}

// Fork: global hide of listed avatars (throttled background job).
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_global_hide_status(
    state: State<'_, AppState>,
) -> vrcx_0_runtime_host_desktop::safety::GlobalHideStatus {
    state.runtime_host().safety().global_hide_status()
}
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_global_hide_set_paused(
    state: State<'_, AppState>,
    paused: bool,
) -> vrcx_0_runtime_host_desktop::safety::GlobalHideStatus {
    state.runtime_host().safety().global_hide_set_paused(paused)
}
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_global_hide_unblock_preview(
    state: State<'_, AppState>,
) -> Result<vrcx_0_runtime_host_desktop::safety::GlobalHideUnblockPreview, AppError> {
    state
        .runtime_host()
        .safety()
        .global_hide_unblock_preview()
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_global_hide_unblock_start(
    state: State<'_, AppState>,
    token: String,
) -> Result<vrcx_0_runtime_host_desktop::safety::GlobalHideStatus, AppError> {
    state
        .runtime_host()
        .safety()
        .global_hide_unblock_start(&token)
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_global_hide_unblock_cancel(
    state: State<'_, AppState>,
) -> vrcx_0_runtime_host_desktop::safety::GlobalHideStatus {
    state.runtime_host().safety().global_hide_unblock_cancel()
}
#[tauri::command(async)]
#[specta::specta]
pub fn app__safety_instance_avatars(
    state: State<'_, AppState>,
) -> Vec<vrcx_0_runtime_host_desktop::safety::InstanceAvatar> {
    state.runtime_host().safety().instance_avatars()
}
