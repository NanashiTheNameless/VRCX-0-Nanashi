#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_runtime_host_desktop::ExternalApiExecuteResponse;

use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    ExternalApiAvatarSearchInput, ExternalApiCodeSearchInput, ExternalApiImageInput,
    ExternalApiUrlInput, ExternalApiYoutubeVideoInput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__external_api_avatar_search_get(
    state: State<'_, AppState>,
    input: ExternalApiAvatarSearchInput,
) -> Result<ExternalApiExecuteResponse, AppError> {
    state
        .runtime_host()
        .external_api()
        .avatar_search(input.url, input.vrcx_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__external_api_youtube_video_metadata_get(
    state: State<'_, AppState>,
    input: ExternalApiYoutubeVideoInput,
) -> Result<ExternalApiExecuteResponse, AppError> {
    state
        .runtime_host()
        .external_api()
        .youtube_video_metadata(input.video_id, input.api_key)
        .await
        .map_err(AppError::from)
}

/// Fork: a Brave Search for VRChat codes, with the user's own key.
#[tauri::command]
#[specta::specta]
pub async fn app__external_api_code_search_get(
    state: State<'_, AppState>,
    input: ExternalApiCodeSearchInput,
) -> Result<ExternalApiExecuteResponse, AppError> {
    state
        .runtime_host()
        .external_api()
        .code_search(
            input.provider,
            input.query,
            input.api_key,
            input.search_engine_id,
            input.endpoint,
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__external_api_github_releases_get(
    state: State<'_, AppState>,
    input: ExternalApiUrlInput,
) -> Result<ExternalApiExecuteResponse, AppError> {
    state
        .runtime_host()
        .external_api()
        .github_releases(input.url, input.headers)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__external_api_github_contributors_get(
    state: State<'_, AppState>,
    input: ExternalApiUrlInput,
) -> Result<ExternalApiExecuteResponse, AppError> {
    state
        .runtime_host()
        .external_api()
        .github_contributors(input.url, input.headers)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__external_api_image_data_url_get(
    state: State<'_, AppState>,
    input: ExternalApiImageInput,
) -> Result<ExternalApiExecuteResponse, AppError> {
    state
        .runtime_host()
        .external_api()
        .image_data_url(input.url)
        .await
        .map_err(AppError::from)
}
