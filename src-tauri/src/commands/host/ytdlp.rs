#![allow(non_snake_case)]
use crate::{error::AppError, state::AppState};
use tauri::State;
use vrcx_0_ytdlp::{Settings, Status};
#[tauri::command(async)]
#[specta::specta]
pub fn app__ytdlp_status(state: State<'_, AppState>) -> Status {
    state.runtime_host().ytdlp().status()
}
#[tauri::command(async)]
#[specta::specta]
pub async fn app__ytdlp_configure(
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Status, AppError> {
    state
        .runtime_host()
        .ytdlp()
        .configure(settings)
        .await
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub async fn app__ytdlp_update(state: State<'_, AppState>) -> Result<Status, AppError> {
    state
        .runtime_host()
        .ytdlp()
        .update()
        .await
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub async fn app__ytdlp_refresh_cookies(
    state: State<'_, AppState>,
    browser: String,
    profile: String,
) -> Result<Status, AppError> {
    state
        .runtime_host()
        .ytdlp()
        .refresh_cookies(browser, profile)
        .await
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub async fn app__ytdlp_import_cookies(
    state: State<'_, AppState>,
    path: String,
) -> Result<Status, AppError> {
    state
        .runtime_host()
        .ytdlp()
        .import_cookies(path)
        .await
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub async fn app__ytdlp_clear_cookies(state: State<'_, AppState>) -> Result<Status, AppError> {
    state
        .runtime_host()
        .ytdlp()
        .clear_cookies()
        .await
        .map_err(AppError::Custom)
}
#[tauri::command(async)]
#[specta::specta]
pub async fn app__ytdlp_test(state: State<'_, AppState>) -> Result<Status, AppError> {
    state
        .runtime_host()
        .ytdlp()
        .test_playback()
        .await
        .map_err(AppError::Custom)
}
