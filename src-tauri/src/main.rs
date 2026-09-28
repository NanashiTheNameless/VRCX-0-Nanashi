#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
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
