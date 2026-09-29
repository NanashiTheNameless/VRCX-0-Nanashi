#![allow(non_snake_case)]

use std::path::PathBuf;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use vrcx_0_application_game::{
    RegistryBackupMaintenanceMode, RegistryBackupMaintenanceResult, RegistryBackupSnapshot,
};
use vrcx_0_host_desktop::host_capabilities::{require_host_capability, HostCapability};

use crate::commands::blocking::run_blocking;
use crate::error::AppError;
use crate::state::AppState;

#[tauri::command]
#[specta::specta]
pub async fn app__registry_backup_list(
    state: State<'_, AppState>,
) -> Result<Vec<RegistryBackupSnapshot>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let registry_backup = state.runtime_host().registry_backup();
    run_blocking("registry backup list", move || registry_backup.list()).await
}

#[tauri::command]
#[specta::specta]
pub async fn app__registry_backup_create(
    state: State<'_, AppState>,
    name: String,
) -> Result<Vec<RegistryBackupSnapshot>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let registry_backup = state.runtime_host().registry_backup();
    run_blocking("registry backup create", move || {
        registry_backup.create(&name)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__registry_backup_restore(
    state: State<'_, AppState>,
    key: String,
) -> Result<RegistryBackupSnapshot, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let registry_backup = state.runtime_host().registry_backup();
    run_blocking("registry backup restore", move || {
        registry_backup.restore(&key)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__registry_backup_delete(
    state: State<'_, AppState>,
    key: String,
) -> Result<Vec<RegistryBackupSnapshot>, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let registry_backup = state.runtime_host().registry_backup();
    run_blocking("registry backup delete", move || {
        registry_backup.delete(&key)
    })
    .await
}

#[tauri::command]
#[specta::specta]
pub async fn app__registry_backup_export_to_file(
    state: State<'_, AppState>,
    app_handle: AppHandle,
    key: String,
) -> Result<String, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let registry_backup = state.runtime_host().registry_backup();
    let export = run_blocking("registry backup export", move || {
        registry_backup.prepare_export(&key)
    })
    .await?;
    let file_path = crate::commands::host::dialog::save_file(
        app_handle
            .dialog()
            .file()
            .set_file_name(&export.file_name)
            .add_filter("JSON Files", &["json"]),
    )
    .await;
    let Some(file_path) = file_path else {
        return Ok(String::new());
    };
    let path = match file_path {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        other => PathBuf::from(other.to_string()),
    };
    let written_path = path.clone();
    run_blocking("registry backup export write", move || {
        vrcx_0_host_desktop::shell_actions::write_string_file(&written_path, &export.json)
    })
    .await?;
    state.runtime_host().register_host_file_access(&path);
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
#[specta::specta]
pub async fn app__registry_backup_import_from_file(
    state: State<'_, AppState>,
    app_handle: AppHandle,
) -> Result<bool, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let file_path = crate::commands::host::dialog::pick_file(
        app_handle
            .dialog()
            .file()
            .add_filter("JSON Files", &["json"]),
    )
    .await;
    let Some(file_path) = file_path else {
        return Ok(false);
    };
    let path = match file_path {
        tauri_plugin_dialog::FilePath::Path(path) => path,
        other => PathBuf::from(other.to_string()),
    };
    state.runtime_host().register_host_file_access(&path);
    let registry_backup = state.runtime_host().registry_backup();
    run_blocking("registry backup import", move || {
        registry_backup.import_from_file(&path)
    })
    .await?;
    Ok(true)
}

#[tauri::command]
#[specta::specta]
pub async fn app__registry_backup_maintenance_run(
    state: State<'_, AppState>,
    reason: String,
) -> Result<RegistryBackupMaintenanceResult, AppError> {
    require_host_capability(HostCapability::RegistryPrefs)?;
    let registry_backup = state.runtime_host().registry_backup();
    run_blocking("registry backup maintenance", move || {
        registry_backup.maintenance_run(&reason, RegistryBackupMaintenanceMode::Foreground)
    })
    .await
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__registry_backup_restore_prompt_acknowledge(
    state: State<'_, AppState>,
    backup_date: String,
) -> Result<String, AppError> {
    Ok(state
        .runtime_host()
        .acknowledge_registry_backup_restore_prompt(&backup_date)?)
}
