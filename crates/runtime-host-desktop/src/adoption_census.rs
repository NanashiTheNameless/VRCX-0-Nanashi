//! Anonymous adoption count: how many installs of the fork are in use.
//!
//! This is the only thing the app reports to the developer. A report is the
//! SHA-256 of a random install id, the project name, the UTC day and a count
//! of one; the service counts each id once per UTC day. It carries no VRChat account, usage, settings,
//! hardware or crash data, and nothing here may grow to include any.

use std::path::{Path, PathBuf};
use std::time::Duration;

use sha2::{Digest, Sha256};
use vrcx_0_application_core::sleep_until_due_or_stopped;
use vrcx_0_composition::RuntimeHostState;
use vrcx_0_contracts::external_api::{self, ExternalApiScope};
use vrcx_0_core::user_agent::APP_NAME;
use vrcx_0_persistence::config::ConfigRepository;

const ADOPTION_CENSUS_INTERVAL: Duration = Duration::from_secs(2 * 60 * 60);
const ADOPTION_CENSUS_ENABLED_KEY: &str = "adoptionCensusEnabled";
/// Opt out when set to a truthy value. `CI` is here so automated runs are
/// not counted as installs.
const ADOPTION_CENSUS_OPT_OUT_ENVS: [&str; 4] = [
    "VRCX_0_NANASHI_TELEMETRY_OPTOUT",
    "DO_NOT_TRACK",
    "TELEMETRY_OPTOUT",
    "CI",
];
/// Opts out when set to a falsy value, as in `TELEMETRY=0`.
const ADOPTION_CENSUS_SWITCH_ENV: &str = "TELEMETRY";
/// Matched ignoring case, with `-` and `_` interchangeable and an optional
/// leading dot.
const ADOPTION_CENSUS_OPT_OUT_FILES: [&str; 4] = [
    "telemetry_optout",
    "no_telemetry",
    "do_not_track",
    "vrcx_0_nanashi_telemetry_optout",
];
/// Kept as a dot file in the data folder rather than a config key, so history
/// sync and profile merge never see it and data export skips it.
const ADOPTION_CENSUS_ID_FILE: &str = ".adoption-census-id";

pub(crate) fn start_adoption_census_loop(state: &RuntimeHostState) {
    // Development builds are not installs worth counting.
    if cfg!(debug_assertions) {
        return;
    }
    let config = state.desktop_assembly().config().clone();
    let web = state.web_client().clone();
    let id_path = state
        .app_data_dir()
        .current_dir
        .join(ADOPTION_CENSUS_ID_FILE);
    state
        .desktop_assembly()
        .tasks()
        .spawn_cancellable(move |stop_token| async move {
            loop {
                if stop_token.is_stop_requested() {
                    return;
                }
                if adoption_census_enabled(&config) {
                    match install_id_hash(&id_path) {
                        Ok(id_hash) => {
                            let input = external_api::adoption_census_post_input(
                                &id_hash,
                                APP_NAME,
                                &chrono::Utc::now().format("%Y-%m-%d").to_string(),
                            );
                            if let Err(error) = web
                                .execute_external_api(input, ExternalApiScope::AdoptionCensus)
                                .await
                            {
                                tracing::debug!(error = %error, "adoption census ping failed");
                            }
                        }
                        Err(error) => {
                            tracing::debug!(error = %error, "adoption census id unavailable");
                        }
                    }
                } else {
                    forget_install_id(&id_path);
                }
                if !sleep_until_due_or_stopped(ADOPTION_CENSUS_INTERVAL, &stop_token).await {
                    return;
                }
            }
        });
}

fn adoption_census_enabled(config: &ConfigRepository) -> bool {
    #[cfg(windows)]
    if vrcx_0_host_desktop::telemetry_policy::telemetry_disabled_by_policy() {
        return false;
    }
    if environment_opts_out(|name| std::env::var(name).ok())
        || opt_out_file_dirs()
            .iter()
            .any(|dir| opt_out_file_present(dir))
    {
        return false;
    }
    setting_enabled(config)
}

/// An unreadable setting counts as opted out.
fn setting_enabled(config: &ConfigRepository) -> bool {
    matches!(config.get_bool(ADOPTION_CENSUS_ENABLED_KEY, true), Ok(true))
}

fn environment_opts_out(lookup: impl Fn(&str) -> Option<String>) -> bool {
    ADOPTION_CENSUS_OPT_OUT_ENVS
        .iter()
        .any(|name| env_value_is(lookup(name), &["1", "true", "yes", "on"]))
        || env_value_is(
            lookup(ADOPTION_CENSUS_SWITCH_ENV),
            &["0", "false", "no", "off"],
        )
}

fn env_value_is(value: Option<String>, accepted: &[&str]) -> bool {
    value.is_some_and(|value| accepted.contains(&value.trim().to_ascii_lowercase().as_str()))
}

/// The folder holding the executable. An AppImage runs from a temporary
/// mount, so the folder holding the AppImage file counts too.
fn opt_out_file_dirs() -> Vec<PathBuf> {
    let executable = std::env::current_exe().ok();
    let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
    [executable, appimage]
        .into_iter()
        .flatten()
        .filter_map(|path| path.parent().map(Path::to_path_buf))
        .collect()
}

/// The file only has to exist; its contents are not read.
fn opt_out_file_present(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries
        .flatten()
        .any(|entry| is_opt_out_file_name(&entry.file_name().to_string_lossy()))
}

fn is_opt_out_file_name(name: &str) -> bool {
    let name = name
        .strip_prefix('.')
        .unwrap_or(name)
        .to_ascii_lowercase()
        .replace('-', "_");
    ADOPTION_CENSUS_OPT_OUT_FILES.contains(&name.as_str())
}

/// Without a stored id every ping would count as a new install, so a failed
/// write skips the ping instead of sending a throwaway id.
fn install_id_hash(path: &Path) -> std::io::Result<String> {
    let id = match read_install_id(path) {
        Some(id) => id,
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            std::fs::write(path, &id)?;
            id
        }
    };
    Ok(Sha256::digest(id.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn read_install_id(path: &Path) -> Option<String> {
    let id = std::fs::read_to_string(path).ok()?;
    uuid::Uuid::parse_str(id.trim())
        .ok()
        .map(|id| id.to_string())
}

fn forget_install_id(path: &Path) {
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use vrcx_0_persistence::DatabaseService;

    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-adoption-census-{name}-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn install_id_is_random_stored_once_and_reported_only_as_a_hash() {
        let dir = TestDir::new("id");
        let path = dir.0.join(ADOPTION_CENSUS_ID_FILE);

        let first = install_id_hash(&path).unwrap();
        let stored = std::fs::read_to_string(&path).unwrap();
        assert!(uuid::Uuid::parse_str(&stored).is_ok());
        assert_eq!(first.len(), 64);
        assert!(first
            .chars()
            .all(|ch| ch.is_ascii_digit() || ('a'..='f').contains(&ch)));
        assert!(!first.contains(&stored.replace('-', "")));
        assert_eq!(install_id_hash(&path).unwrap(), first);

        let other = TestDir::new("id-other");
        assert_ne!(
            install_id_hash(&other.0.join(ADOPTION_CENSUS_ID_FILE)).unwrap(),
            first
        );
    }

    #[test]
    fn install_id_hash_is_plain_sha256_of_the_stored_id() {
        let dir = TestDir::new("known");
        let path = dir.0.join(ADOPTION_CENSUS_ID_FILE);
        std::fs::write(&path, "00000000-0000-4000-8000-000000000000\n").unwrap();
        assert_eq!(
            install_id_hash(&path).unwrap(),
            "db8055e0e0307d5a016bec4dc338d69875eb0fb7e614a8b125b08fb082095d98"
        );
    }

    #[test]
    fn damaged_id_file_is_replaced_and_missing_folder_skips_the_ping() {
        let dir = TestDir::new("damaged");
        let path = dir.0.join(ADOPTION_CENSUS_ID_FILE);
        std::fs::write(&path, "not an id").unwrap();
        install_id_hash(&path).unwrap();
        assert!(uuid::Uuid::parse_str(&std::fs::read_to_string(&path).unwrap()).is_ok());

        assert!(install_id_hash(&dir.0.join("missing").join(ADOPTION_CENSUS_ID_FILE)).is_err());
    }

    #[test]
    fn opting_out_disables_the_ping_and_forgets_the_id() {
        let dir = TestDir::new("opt-out");
        let db = Arc::new(DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap());
        let config = ConfigRepository::new(db);
        assert!(setting_enabled(&config));

        config.set_bool(ADOPTION_CENSUS_ENABLED_KEY, false).unwrap();
        assert!(!setting_enabled(&config));
        assert!(!adoption_census_enabled(&config));

        let path = dir.0.join(ADOPTION_CENSUS_ID_FILE);
        install_id_hash(&path).unwrap();
        forget_install_id(&path);
        assert!(!path.exists());
    }

    #[test]
    fn any_opt_out_file_next_to_the_executable_opts_out() {
        let empty = TestDir::new("no-flag");
        std::fs::write(empty.0.join("telemetry-optout.txt"), "").unwrap();
        assert!(!opt_out_file_present(&empty.0));

        for name in [
            "telemetry-optout",
            ".telemetry-optout",
            "no-telemetry",
            ".no-telemetry",
            "DO_NOT_TRACK",
            ".DO_NOT_TRACK",
            "VRCX_0_NANASHI_TELEMETRY_OPTOUT",
            ".VRCX_0_NANASHI_TELEMETRY_OPTOUT",
            "Telemetry_OptOut",
            ".NO_TELEMETRY",
            "do-not-track",
            ".vrcx-0-nanashi-telemetry-optout",
            "Do_Not-Track",
        ] {
            let dir = TestDir::new("flag");
            std::fs::write(dir.0.join(name), "").unwrap();
            assert!(opt_out_file_present(&dir.0), "{name}");
        }

        for name in [
            "telemetry-optout.txt",
            "..no-telemetry",
            "telemetryoptout",
            "do not track",
            "my-no-telemetry",
        ] {
            assert!(!is_opt_out_file_name(name), "{name}");
        }

        let executable_dir = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        assert!(opt_out_file_dirs().contains(&executable_dir));
    }

    fn opts_out_with(name: &str, value: &str) -> bool {
        environment_opts_out(|asked| (asked == name).then(|| value.to_string()))
    }

    #[test]
    fn each_opt_out_environment_variable_opts_out_when_truthy() {
        assert!(!environment_opts_out(|_| None));
        for name in [
            "VRCX_0_NANASHI_TELEMETRY_OPTOUT",
            "DO_NOT_TRACK",
            "TELEMETRY_OPTOUT",
            "CI",
        ] {
            for value in ["1", "true", " YES ", "on"] {
                assert!(opts_out_with(name, value), "{name}={value}");
            }
            for value in ["", "0", "false", "no", "off"] {
                assert!(!opts_out_with(name, value), "{name}={value}");
            }
        }
        assert!(!opts_out_with("NEXT_TELEMETRY_DISABLED", "1"));
    }

    #[test]
    fn telemetry_switch_opts_out_only_when_falsy() {
        for value in ["0", "false", " NO ", "off"] {
            assert!(opts_out_with("TELEMETRY", value), "{value}");
        }
        for value in ["", "1", "true", "yes", "on"] {
            assert!(!opts_out_with("TELEMETRY", value), "{value}");
        }
    }
}
