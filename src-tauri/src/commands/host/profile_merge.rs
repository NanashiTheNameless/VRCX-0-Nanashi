#![allow(non_snake_case)]

//! Fork: "Import from VRCX / VRCX-0" (non-destructive merge).

use tauri::State;
use vrcx_0_outbound_adapters::{
    ProfileMergeReport, ProfileMergeSourceKind, ProfileMergeSources, ProfileSettingsImportReport,
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
