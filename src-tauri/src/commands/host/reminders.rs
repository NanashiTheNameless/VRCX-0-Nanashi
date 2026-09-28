#![allow(non_snake_case)]
//! Fork: Settings list of assistant reminders (upstream #479).
use crate::state::AppState;
use tauri::State;
use vrcx_0_contracts::reminders::Reminder;

#[tauri::command(async)]
#[specta::specta]
pub fn app__reminders_list(state: State<'_, AppState>) -> Vec<Reminder> {
    state.runtime_host().reminders().list_current()
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__reminders_delete(state: State<'_, AppState>, id: String) -> Vec<Reminder> {
    let reminders = state.runtime_host().reminders();
    reminders.delete_current(&id);
    reminders.list_current()
}
