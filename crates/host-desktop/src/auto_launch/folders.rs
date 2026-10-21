use super::{
    normalize_app_launcher_entries, picked_app_launcher_target, picked_local_target,
    AppLauncherEntry, AppLauncherRunPolicy, AppLauncherScope, AppLauncherStopPolicy, Deserialize,
    Path, PathBuf, Serialize,
};

pub const APP_LAUNCHER_VRCX_FOLDER_ENABLED_CONFIG_KEY: &str = "VRCX_appLauncherVrcxFolderEnabled";
pub const APP_LAUNCHER_APP_FOLDER_ENABLED_CONFIG_KEY: &str = "VRCX_appLauncherAppFolderEnabled";
/// Not `startup`: data directory migration treats that name as a disposable
/// cache and deletes it.
pub const APP_STARTUP_FOLDER_NAME: &str = "StartupApps";
const VRCX_DATA_DIR_NAME: &str = "VRCX";
const VRCX_STARTUP_FOLDER_NAME: &str = "startup";
const STARTUP_FILE_EXTENSIONS: [&str; 5] = ["exe", "lnk", "url", "bat", "cmd"];
const SCOPED_SUBFOLDERS: [(&str, AppLauncherScope); 2] = [
    ("desktop", AppLauncherScope::Desktop),
    ("vr", AppLauncherScope::Vr),
];

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AppLauncherFolderSource {
    Vrcx,
    App,
}

impl AppLauncherFolderSource {
    fn id_prefix(self) -> &'static str {
        match self {
            Self::Vrcx => "folder-vrcx",
            Self::App => "folder-app",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppLauncherFolderConfig {
    pub source: AppLauncherFolderSource,
    pub path: PathBuf,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherFolder {
    pub source: AppLauncherFolderSource,
    pub path: String,
    pub enabled: bool,
    pub exists: bool,
    pub entries: Vec<AppLauncherEntry>,
}

/// VRCX's AutoAppLaunch folder. Only ever read; this app never creates or
/// changes anything in it.
pub fn vrcx_startup_folder() -> Option<PathBuf> {
    dirs::config_dir().map(|config| {
        config
            .join(VRCX_DATA_DIR_NAME)
            .join(VRCX_STARTUP_FOLDER_NAME)
    })
}

pub fn app_startup_folder(app_data: &Path) -> PathBuf {
    app_data.join(APP_STARTUP_FOLDER_NAME)
}

impl AppLauncherFolderConfig {
    pub(super) fn snapshot(&self) -> AppLauncherFolder {
        AppLauncherFolder {
            source: self.source,
            path: self.path.to_string_lossy().to_string(),
            enabled: self.enabled,
            exists: self.path.is_dir(),
            entries: scan_startup_folder(self.source, &self.path),
        }
    }
}

/// Mirrors VRCX's layout: files in the folder start with every VRChat
/// launch, files in `desktop` only without SteamVR, files in `vr` only with
/// it. Like VRCX, a file is skipped while its process is already running and
/// closed when VRChat exits.
pub fn scan_startup_folder(source: AppLauncherFolderSource, root: &Path) -> Vec<AppLauncherEntry> {
    let mut entries = Vec::new();
    push_folder_entries(&mut entries, source, root, None, AppLauncherScope::All);
    for (name, scope) in SCOPED_SUBFOLDERS {
        push_folder_entries(&mut entries, source, &root.join(name), Some(name), scope);
    }
    normalize_app_launcher_entries(entries)
}

fn push_folder_entries(
    entries: &mut Vec<AppLauncherEntry>,
    source: AppLauncherFolderSource,
    dir: &Path,
    subfolder: Option<&str>,
    scope: AppLauncherScope,
) {
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = read_dir
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_startup_file(path))
        .collect();
    files.sort();
    for path in files {
        entries.push(folder_entry(source, subfolder, scope, path));
    }
}

fn is_startup_file(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            STARTUP_FILE_EXTENSIONS
                .iter()
                .any(|expected| extension.eq_ignore_ascii_case(expected))
        })
}

fn folder_entry(
    source: AppLauncherFolderSource,
    subfolder: Option<&str>,
    scope: AppLauncherScope,
    path: PathBuf,
) -> AppLauncherEntry {
    let file_name = path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let id = match subfolder {
        Some(subfolder) => format!("{}-{subfolder}-{file_name}", source.id_prefix()),
        None => format!("{}-{file_name}", source.id_prefix()),
    };
    let picked =
        picked_app_launcher_target(path.clone()).unwrap_or_else(|_| picked_local_target(path));
    AppLauncherEntry {
        id,
        enabled: true,
        name: picked.name,
        kind: picked.kind,
        scope,
        target: picked.target,
        args: String::new(),
        launch_delay_seconds: 0,
        run_policy: AppLauncherRunPolicy::SkipIfRunning,
        stop_policy: AppLauncherStopPolicy::CloseByVrcx,
        run_as_administrator: false,
        process_name: picked.process_name,
        working_directory: picked.working_directory,
    }
}
