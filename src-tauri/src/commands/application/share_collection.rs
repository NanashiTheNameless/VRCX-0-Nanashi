#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::collections::{
    ImportPreview, SharedCollectionImportStartInput, SharedCollectionImportStatus,
};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__share_collection_preview(
    state: State<'_, AppState>,
    id: String,
) -> Result<ImportPreview, AppError> {
    Ok(state.runtime_host().preview_shared_collection(&id).await?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__shared_collection_import_start(
    state: State<'_, AppState>,
    input: SharedCollectionImportStartInput,
) -> Result<SharedCollectionImportStatus, AppError> {
    Ok(state.runtime_host().start_shared_collection_import(input)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__shared_collection_import_status(
    state: State<'_, AppState>,
) -> SharedCollectionImportStatus {
    state.runtime_host().shared_collection_import_status()
}
