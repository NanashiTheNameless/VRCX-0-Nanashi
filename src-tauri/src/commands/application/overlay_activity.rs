#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_application_activity::notification::{
    ActivityFilterProfile, NotificationActivityFilterProfiles, NotificationActivityFiltersSetInput,
};
use vrcx_0_application_activity::{activity_type_definitions, ActivityTypeDefinition};

use crate::error::AppError;
use crate::state::AppState;

#[tauri::command(async)]
#[specta::specta]
pub fn app__overlay_activity_definitions_get() -> Result<Vec<ActivityTypeDefinition>, AppError> {
    Ok(activity_type_definitions())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__notification_activity_filters_get(
    state: State<'_, AppState>,
) -> NotificationActivityFilterProfiles {
    state.runtime_host().notification_activity_filter_profiles()
}

/// Fork: free store items the opt-in check found, sent to the notification
/// channels. Only item names are passed.
#[tauri::command(async)]
#[specta::specta]
pub fn app__free_store_items_notify(state: State<'_, AppState>, names: Vec<String>) {
    let names: Vec<String> = names
        .into_iter()
        .map(|name| name.trim().chars().take(100).collect::<String>())
        .filter(|name| !name.is_empty())
        .take(20)
        .collect();
    state.runtime_host().notify_free_store_items(&names);
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__notification_test_send(state: State<'_, AppState>, message: String) {
    state.runtime_host().send_test_notification(&message);
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__notification_activity_filters_set(
    state: State<'_, AppState>,
    input: NotificationActivityFiltersSetInput,
) -> Result<ActivityFilterProfile, AppError> {
    state
        .runtime_host()
        .set_notification_activity_filters(input)
        .map_err(AppError::from)
}
