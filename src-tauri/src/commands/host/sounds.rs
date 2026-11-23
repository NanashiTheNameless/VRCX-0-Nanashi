#![allow(non_snake_case)]

//! Fork: preview a notification sound file from the settings UI.

use std::path::PathBuf;

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__notification_sound_test(
    state: State<'_, AppState>,
    path: String,
    volume: f32,
) -> Result<(), AppError> {
    let path = path.trim();
    if !path.starts_with(vrcx_0_host_desktop::sound::BUNDLED_PREFIX) {
        state.runtime_host().ensure_host_read_allowed(path)?;
    }
    vrcx_0_host_desktop::sound::play_sound_file(&PathBuf::from(path), volume)
        .map_err(AppError::Custom)
}

/// Fork: names of the built-in sounds, selectable as `bundled:<name>`.
#[tauri::command(async)]
#[specta::specta]
pub fn app__notification_sounds_bundled() -> Vec<String> {
    vrcx_0_host_desktop::sound::bundled_sound_names()
        .into_iter()
        .map(str::to_string)
        .collect()
}
