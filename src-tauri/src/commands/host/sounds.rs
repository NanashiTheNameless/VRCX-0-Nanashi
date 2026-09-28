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
