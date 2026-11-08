#![allow(non_snake_case)]

use tauri::State;

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

use vrcx_0_contracts::friend_log::{
    FriendLogCurrentOutput, FriendLogHistoryEntryInput, FriendLogHistoryOutput,
    FriendLogHistoryQueryInput,
};
use vrcx_0_contracts::profile_bio::ProfileBioOutput;
use vrcx_0_core::OwnerId;

#[tauri::command]
#[specta::specta]
pub async fn app__profile_history_settings_get(
    state: State<'_, AppState>,
) -> Result<vrcx_0_contracts::profile_history::ProfileHistorySettings, AppError> {
    let local = state.runtime_host().local_data().clone();
    run_blocking("profile history settings", move || {
        local.profile_history_settings_get()
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_history_settings_set(
    state: State<'_, AppState>,
    settings: vrcx_0_contracts::profile_history::ProfileHistorySettings,
) -> Result<(), AppError> {
    let local = state.runtime_host().local_data().clone();
    run_blocking("save profile history settings", move || {
        local.profile_history_settings_set(settings)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__profile_history_query(
    state: State<'_, AppState>,
    query: vrcx_0_contracts::profile_history::ProfileHistoryQuery,
) -> Result<Vec<vrcx_0_contracts::profile_history::ProfileHistoryEntry>, AppError> {
    let local = state.runtime_host().local_data().clone();
    run_blocking("profile history query", move || {
        local.profile_history_query(query)
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__friend_log_current_list(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<Vec<FriendLogCurrentOutput>, AppError> {
    state
        .runtime_host()
        .local_data()
        .friend_log_current_list(user_id)
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__friend_log_history_delete(
    state: State<'_, AppState>,
    user_id: String,
    entry: FriendLogHistoryEntryInput,
) -> Result<i64, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("friend log history delete", move || {
        local_data.friend_log_history_delete(user_id, entry)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__friend_log_history_query(
    state: State<'_, AppState>,
    query: FriendLogHistoryQueryInput,
) -> Result<Vec<FriendLogHistoryOutput>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("friend log history query", move || {
        local_data.friend_log_history_query(query)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__friend_profile_bio_list(
    state: State<'_, AppState>,
    owner_user_id: OwnerId,
) -> Result<Vec<ProfileBioOutput>, AppError> {
    let local_data = state.runtime_host().local_data().clone();
    run_blocking("friend profile bio list", move || {
        local_data.profile_bio_list(owner_user_id)
    })
    .await
}
