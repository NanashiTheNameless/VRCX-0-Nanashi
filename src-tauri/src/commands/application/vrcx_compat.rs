#![allow(non_snake_case)]

//! Fork: VRCX compatibility (IPC pipe and Persistent World Info).

use tauri::State;
use vrcx_0_runtime_host_desktop::vrcx_compat::{
    IpcSettings, IpcStatus, VrcxCustomTag, WorldDataEntry, WorldDataImportReport,
    WorldDataSettings, WorldDataStatus, WorldDataWorld,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_ipc_status(state: State<'_, AppState>) -> Result<IpcStatus, AppError> {
    Ok(state.runtime_host().vrcx_compat().ipc_status().await)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_ipc_set_settings(
    state: State<'_, AppState>,
    settings: IpcSettings,
) -> Result<IpcStatus, AppError> {
    Ok(state
        .runtime_host()
        .vrcx_compat()
        .set_ipc_settings(settings)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_custom_tags(
    state: State<'_, AppState>,
) -> Result<Vec<VrcxCustomTag>, AppError> {
    Ok(state.runtime_host().vrcx_compat().custom_tags())
}

/// VRCX tells programs on the pipe which user dialog is open.
#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_ipc_announce_user_dialog(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<(), AppError> {
    state
        .runtime_host()
        .vrcx_compat()
        .announce_user_dialog(&user_id);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_world_data_status(
    state: State<'_, AppState>,
) -> Result<WorldDataStatus, AppError> {
    Ok(state.runtime_host().vrcx_compat().world_data_status().await)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_world_data_set_settings(
    state: State<'_, AppState>,
    settings: WorldDataSettings,
) -> Result<WorldDataStatus, AppError> {
    Ok(state
        .runtime_host()
        .vrcx_compat()
        .set_world_data_settings(settings)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_world_data_worlds(
    state: State<'_, AppState>,
) -> Result<Vec<WorldDataWorld>, AppError> {
    Ok(state.runtime_host().vrcx_compat().world_data_worlds()?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_world_data_entries(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<Vec<WorldDataEntry>, AppError> {
    Ok(state
        .runtime_host()
        .vrcx_compat()
        .world_data_entries(&world_id)?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_world_data_forget(
    state: State<'_, AppState>,
    world_id: String,
) -> Result<(), AppError> {
    Ok(state
        .runtime_host()
        .vrcx_compat()
        .forget_world_data(&world_id)?)
}

/// VRCX's world data file, if one was found, for the import button.
#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_world_data_import_source(
    state: State<'_, AppState>,
) -> Result<Option<String>, AppError> {
    Ok(state.runtime_host().vrcx_compat().vrcx_world_data_file())
}

/// Merges VRCX's world data, or the chosen file, without overwriting values
/// already saved here. The other file is only read.
#[tauri::command]
#[specta::specta]
pub async fn app__vrcx_world_data_import(
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<WorldDataImportReport, AppError> {
    if let Some(path) = path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        state.runtime_host().ensure_host_read_allowed(path)?;
    }
    Ok(state
        .runtime_host()
        .vrcx_compat()
        .import_world_data(path)
        .await?)
}
