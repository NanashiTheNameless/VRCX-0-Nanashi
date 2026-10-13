#![allow(non_snake_case)]

use tauri::{AppHandle, Manager};
use vrcx_0_runtime_host_desktop::desktop_widget::DesktopWidgetSnapshot;

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__desktop_widget_enabled_set(
    app: AppHandle,
    enabled: bool,
) -> Result<DesktopWidgetSnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let widget = state.runtime_host().desktop_widget();
        Ok(widget.set_enabled(enabled)?)
    })
    .await
    .map_err(|error| AppError::Custom(format!("activity window task failed: {error}")))?
}
