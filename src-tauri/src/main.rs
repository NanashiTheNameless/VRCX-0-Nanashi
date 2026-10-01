#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;

fn maybe_rename_appimage() {
    if let Ok(exe_path) = std::env::current_exe() {
        let file_name = exe_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        // Check if it's an AppImage with version in name: VRCX-0-Nanashi_3.0.0_amd64.AppImage
        // Only rename if the middle part looks like a semantic version (digits and dots)
        // This avoids renaming user-customized names like "VRCX-0-Nanashi.AppImage" or "MyApp.AppImage"
        if file_name.ends_with(".AppImage") && file_name.contains("_") {
            let parts: Vec<&str> = file_name.split('_').collect();
            if parts.len() >= 3 {
                // Expected: [productName, version, arch.AppImage]
                let base_name = parts[0];
                let version_part = parts[parts.len() - 2];
                let arch_part = parts.last().unwrap();

                // Check if version_part looks like a semantic version (e.g., "3.0.0", "3.0.0-beta.1")
                let is_version = version_part.chars().all(|c| {
                    c.is_ascii_digit()
                        || c == '.'
                        || c == '-'
                        || c == '+'
                        || c.is_ascii_alphabetic()
                });
                let has_digits = version_part.chars().any(|c| c.is_ascii_digit());

                if is_version && has_digits {
                    let new_name = format!("{}_{}", base_name, arch_part);
                    let new_path = exe_path.with_file_name(&new_name);
                    // Only rename if target doesn't exist (user hasn't already created it)
                    if !new_path.exists() {
                        if let Err(e) = fs::rename(&exe_path, &new_path) {
                            eprintln!("Failed to rename AppImage: {e}");
                        }
                    }
                }
            }
        }
    }
}

fn main() {
    maybe_rename_appimage();

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
