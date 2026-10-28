//! Menu actions forwarded to the frontend. The tray sends `{ "action": ... }`
//! on this event (e.g. "check-updates" opens the updater dialog).

use tauri::{AppHandle, Emitter};

pub(crate) const MENU_ACTION_EVENT: &str = "menuAction";

pub(crate) fn emit_menu_action(app: &AppHandle, action: &str) -> tauri::Result<()> {
    app.emit(MENU_ACTION_EVENT, serde_json::json!({ "action": action }))
}
