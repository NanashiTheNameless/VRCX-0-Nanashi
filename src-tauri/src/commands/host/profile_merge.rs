#![allow(non_snake_case)]

//! Fork: "Import from VRCX / VRCX-0" (non-destructive merge).

use tauri::State;
use vrcx_0_runtime_host_desktop::profile_merge::{
    DataExportReport, DataImportSummary, ProfileMergeReport, ProfileMergeSourceKind,
    ProfileMergeSources, ProfileSettingsImportReport,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__profile_merge_sources(state: State<'_, AppState>) -> ProfileMergeSources {
    state.runtime_host().profile_merge_sources()
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__profile_merge_run(
    state: State<'_, AppState>,
    source: ProfileMergeSourceKind,
) -> Result<ProfileMergeReport, AppError> {
    Ok(state.runtime_host().run_profile_merge(source).await?)
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__profile_settings_import(
    state: State<'_, AppState>,
    source: ProfileMergeSourceKind,
) -> Result<ProfileSettingsImportReport, AppError> {
    Ok(state
        .runtime_host()
        .run_profile_settings_import(source)
        .await?)
}

/// Fork: export all data and settings to `path` (a level 9 zip).
#[tauri::command(async)]
#[specta::specta]
pub async fn app__data_export(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<DataExportReport, AppError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(AppError::Custom("No export file was chosen.".into()));
    }
    let app_version = app_handle.package_info().version.to_string();
    Ok(state
        .runtime_host()
        .run_data_export(std::path::PathBuf::from(path), app_version)
        .await?)
}

/// Fork: validate a data export and stage it; it is applied on the next start.
#[tauri::command(async)]
#[specta::specta]
pub async fn app__data_import_stage(
    state: State<'_, AppState>,
    path: String,
) -> Result<DataImportSummary, AppError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(AppError::Custom("No data export was chosen.".into()));
    }
    Ok(state
        .runtime_host()
        .stage_data_import(std::path::PathBuf::from(path))
        .await?)
}

/// Fork: cancel a staged data import.
#[tauri::command(async)]
#[specta::specta]
pub fn app__data_import_discard(state: State<'_, AppState>) -> Result<(), AppError> {
    Ok(state.runtime_host().discard_data_import()?)
}
