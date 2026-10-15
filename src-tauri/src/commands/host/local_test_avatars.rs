#![allow(non_snake_case)]

use vrcx_0_host_desktop::local_test_avatars::{self, LocalTestAvatarOutput};

use crate::commands::blocking::run_blocking;
use crate::error::AppError;

#[tauri::command]
#[specta::specta]
pub async fn app__local_test_avatars_list() -> Result<Vec<LocalTestAvatarOutput>, AppError> {
    run_blocking("local test avatars list", local_test_avatars::list).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__local_test_avatar_delete(file_name: String) -> Result<(), AppError> {
    run_blocking("local test avatar delete", move || {
        local_test_avatars::delete(&file_name)
    })
    .await
}
