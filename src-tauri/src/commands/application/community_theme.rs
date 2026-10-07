#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application::profile::{
    CommunityThemeCatalog, CommunityThemeConfigureInput, CommunityThemeProjection,
};

use crate::{error::AppError, state::AppState};

#[tauri::command]
#[specta::specta]
pub async fn app__community_theme_state_get(
    state: State<'_, AppState>,
) -> Result<CommunityThemeProjection, AppError> {
    Ok(state.runtime_host().initialize_community_theme().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__community_theme_catalog_get(
    state: State<'_, AppState>,
) -> Result<CommunityThemeCatalog, AppError> {
    Ok(state.runtime_host().community_theme_catalog().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__community_theme_configure(
    state: State<'_, AppState>,
    input: CommunityThemeConfigureInput,
) -> Result<CommunityThemeProjection, AppError> {
    Ok(state
        .runtime_host()
        .configure_community_theme(input)
        .await?)
}
