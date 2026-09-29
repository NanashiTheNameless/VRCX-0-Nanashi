#![allow(non_snake_case)]
//! Fork: Settings list of assistant reminders (upstream #479).
use crate::state::AppState;
use tauri::State;
use vrcx_0_contracts::reminders::{Reminder, ReminderTrigger};

use crate::error::AppError;

#[tauri::command(async)]
#[specta::specta]
pub fn app__reminders_list(state: State<'_, AppState>) -> Vec<Reminder> {
    state.runtime_host().reminders().list_current()
}

/// Fork: create a reminder by hand from Settings.
#[tauri::command(async)]
#[specta::specta]
pub fn app__reminders_create(
    state: State<'_, AppState>,
    message: String,
    trigger: ReminderTrigger,
    recurring: bool,
) -> Result<Vec<Reminder>, AppError> {
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err(AppError::Custom("Enter a reminder message.".into()));
    }
    let reminders = state.runtime_host().reminders();
    reminders
        .create_current(message, trigger, recurring)
        .map_err(AppError::Custom)?;
    Ok(reminders.list_current())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__reminders_delete(state: State<'_, AppState>, id: String) -> Vec<Reminder> {
    let reminders = state.runtime_host().reminders();
    reminders.delete_current(&id);
    reminders.list_current()
}

/// Fork: turn a plain-language request into a reminder draft for review.
/// `nowLocal` is the user's local time, e.g. `2026-09-29T21:05 (Tuesday, -05:00)`.
#[tauri::command]
#[specta::specta]
#[allow(non_snake_case)]
pub async fn app__reminders_ai_draft(
    state: State<'_, AppState>,
    text: String,
    nowLocal: String,
) -> Result<vrcx_0_assistant::ReminderDraft, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::Custom("Describe the reminder first.".into()));
    }
    state
        .assistant()
        .await?
        .draft_reminder(text, &nowLocal)
        .await
        .map_err(AppError::from)
}
