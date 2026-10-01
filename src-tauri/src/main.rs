#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

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

fn main() {
    let exe_path = maybe_rename_appimage();
    #[cfg(target_os = "linux")]
    if let Err(error) =
        vrcx_0_platform::autostart::refresh_current_entries("VRCX-0-Nanashi", &exe_path, false)
    {
        eprintln!("Failed to update autostart desktop file: {error}");
    }
    #[cfg(not(target_os = "linux"))]
    let _ = exe_path;

    #[cfg(target_os = "linux")]
    if std::env::args().any(|arg| arg == "--appimage-smoke-test") {
        let environment = tauri::Env::default();
        let relaunch =
            tauri::process::current_binary(&environment).expect("resolve AppImage relaunch path");
        println!(
            "{}",
            serde_json::json!({
                "appimage": environment.appimage.as_ref().map(PathBuf::from),
                "appdir": environment.appdir.as_ref().map(PathBuf::from),
                "executable": std::env::current_exe().expect("resolve mounted executable"),
                "relaunchPath": relaunch,
                "updaterPath": environment.appimage.as_ref().map(PathBuf::from),
            })
        );
        return;
    }

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
