#![allow(non_snake_case)]

//! Fork: preview a notification sound file from the settings UI.

use std::path::PathBuf;

use crate::error::AppError;

#[tauri::command(async)]
#[specta::specta]
pub fn app__notification_sound_test(path: String, volume: f32) -> Result<(), AppError> {
    vrcx_0_host_desktop::sound::play_sound_file(&PathBuf::from(path.trim()), volume)
        .map_err(AppError::Custom)
}

/// Fork: names of the built-in sounds, selectable as `bundled:<name>`.
#[tauri::command]
#[specta::specta]
pub fn app__notification_sounds_bundled() -> Vec<String> {
    vrcx_0_host_desktop::sound::bundled_sound_names()
        .into_iter()
        .map(str::to_string)
        .collect()
}
