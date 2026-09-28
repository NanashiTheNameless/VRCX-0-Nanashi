#![allow(non_snake_case)]

use tauri::State;

use crate::error::AppError;
use crate::state::AppState;

/// Whether the app currently holds a keep-the-system-awake lock.
#[tauri::command(async)]
#[specta::specta]
pub fn app__keep_system_awake_get(state: State<'_, AppState>) -> bool {
    state.runtime_host().keep_system_awake_active()
}

/// Persists the keep-awake preference and applies it. Returns whether the hold is active.
#[tauri::command(async)]
#[specta::specta]
pub fn app__keep_system_awake_set(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<bool, AppError> {
    Ok(state.runtime_host().set_keep_system_awake(enabled)?)
}
