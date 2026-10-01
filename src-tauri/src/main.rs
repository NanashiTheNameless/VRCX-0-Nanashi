#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};

fn maybe_rename_appimage() -> PathBuf {
    let executable = std::env::current_exe().unwrap_or_default();
    #[cfg(target_os = "linux")]
    {
        let appimage = std::env::var_os("APPIMAGE")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        let path = vrcx_0_platform::appimage::prepare_executable_path(
            &executable,
            appimage.as_deref(),
            env!("CARGO_PKG_VERSION"),
        );
        if appimage.is_some() {
            std::env::set_var("APPIMAGE", &path);
        }
        path
    }
    #[cfg(not(target_os = "linux"))]
    executable
}

fn update_autostart_desktop(exe_path: &Path) {
    if let Some(config_dir) = dirs::config_dir() {
        let autostart_dir = config_dir.join("autostart");
        let desktop_file = autostart_dir.join("vrcx-0-nanashi.desktop");
        if desktop_file.exists() {
            if let Ok(content) = fs::read_to_string(&desktop_file) {
                // Replace the Exec line with current path
                let new_content = content
                    .lines()
                    .map(|line| {
                        if line.starts_with("Exec=") {
                            format!("Exec={}", exe_path.display())
                        } else if line.starts_with("TryExec=") {
                            format!("TryExec={}", exe_path.display())
                        } else {
                            line.to_string()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                if let Err(e) = fs::write(&desktop_file, new_content) {
                    eprintln!("Failed to update autostart desktop file: {e}");
                }
            }
        }
    }
}

fn main() {
    let exe_path = maybe_rename_appimage();
    // Always update autostart desktop entry to point to current executable
    update_autostart_desktop(&exe_path);

    if std::env::args().any(|arg| arg == "--restore-ytdlp") {
        let result =
            vrcx_0_platform::app_paths::resolve_app_data_dir_from_args(std::env::args_os().skip(1))
                .map_err(|e| e.to_string())
                .and_then(|paths| vrcx_0_ytdlp::restore_for_uninstall(&paths.current_dir));
        if let Err(error) = result {
            eprintln!("Could not restore VRChat tools: {error}");
            std::process::exit(1);
        }
        return;
    }
    vrcx_0::run();
}
