use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessesToUpdate, System};

mod manager;
mod model;
mod picker;
mod process;

#[cfg(test)]
mod tests;

#[cfg(test)]
use manager::new_run;
use manager::Inner;
use model::{
    default_working_directory_for_local_target, display_name_for_path, is_windows_executable_path,
    path_extension_eq,
};
#[cfg(test)]
use process::{
    child_start_time_matches_parent, finish_stop_attempt, is_protected_process_name,
    local_launch_strategy, normalized_process_path_for_platform, process_name_for_run,
    process_name_from_target_for_platform, shell_launch_pid_is_trackable,
    should_close_untracked_matching_processes, should_skip_entry, tracked_shell_process_id,
    tracked_stop_pids, LocalLaunchStrategy, ShellExecuteVerb,
};
use process::{
    launch_entry, now_timestamp, refresh_runs, stop_close_by_vrcx_session, stop_tracked_run,
};

pub use manager::AutoAppLaunchManager;
pub use model::{
    deserialize_app_launcher_entries, normalize_app_launcher_entries, scope_matches,
    split_command_line_args, steam_launch_url, AppLauncherEntry, AppLauncherEntryKind,
    AppLauncherPickedTarget, AppLauncherRun, AppLauncherRunPolicy, AppLauncherRunStatus,
    AppLauncherScope, AppLauncherSession, AppLauncherSnapshot, AppLauncherStopPolicy,
    AppLauncherTargetPickKind, APP_LAUNCHER_ENABLED_CONFIG_KEY, APP_LAUNCHER_ENTRIES_CONFIG_KEY,
};
pub use picker::{picked_app_launcher_target, picked_local_target};
