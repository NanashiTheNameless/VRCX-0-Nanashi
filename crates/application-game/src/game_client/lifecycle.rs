use std::time::Duration;

use vrcx_0_core::location::is_real_instance;

const CRASH_RELAUNCH_DEDUPE_MS: i64 = 120_000;
const NOVR_RELAUNCH_DELAY: Duration = Duration::from_secs(2);
const VR_RELAUNCH_DELAY: Duration = Duration::from_secs(8);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrashRelaunchPlan {
    pub location: String,
    pub desktop_mode: bool,
    pub delay: Duration,
    pub launch_arguments: String,
    pub launch_path_override: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrashRelaunchConfig {
    pub enabled: bool,
    pub is_game_no_vr: bool,
    pub launch_arguments: String,
    pub launch_path_override: String,
}

pub fn plan_crash_relaunch(
    config: &CrashRelaunchConfig,
    location: &str,
    closed_gracefully: bool,
    now_ms: i64,
    last_crash_at_ms: Option<i64>,
) -> Option<CrashRelaunchPlan> {
    if !config.enabled || closed_gracefully || !is_real_instance(location) {
        return None;
    }
    if last_crash_at_ms.is_some_and(|last| now_ms - last < CRASH_RELAUNCH_DEDUPE_MS) {
        return None;
    }

    Some(CrashRelaunchPlan {
        location: location.to_string(),
        desktop_mode: config.is_game_no_vr,
        delay: if config.is_game_no_vr {
            NOVR_RELAUNCH_DELAY
        } else {
            VR_RELAUNCH_DELAY
        },
        launch_arguments: build_launch_arguments(
            location,
            &config.launch_arguments,
            config.is_game_no_vr,
        ),
        launch_path_override: config.launch_path_override.clone(),
    })
}

fn build_launch_arguments(location: &str, launch_arguments: &str, desktop_mode: bool) -> String {
    let launch_url = format!("vrchat://launch?id={location}");
    let mut args = vec![launch_url];
    if !launch_arguments.trim().is_empty() {
        args.push(launch_arguments.trim().to_string());
    }
    if desktop_mode {
        args.push("--no-vr".into());
    }
    args.join(" ")
}

#[cfg(test)]
mod tests {
    use super::{plan_crash_relaunch, CrashRelaunchConfig};

    fn config() -> CrashRelaunchConfig {
        CrashRelaunchConfig {
            enabled: true,
            is_game_no_vr: false,
            launch_arguments: "--profile=0".into(),
            launch_path_override: String::new(),
        }
    }

    #[test]
    fn skips_crash_relaunch_when_disabled_or_not_real_location() {
        let mut disabled = config();
        disabled.enabled = false;
        assert!(plan_crash_relaunch(&disabled, "wrld_test:1", false, 10_000, None).is_none());
        assert!(plan_crash_relaunch(&config(), "traveling", false, 10_000, None).is_none());
        assert!(plan_crash_relaunch(&config(), "wrld_test:1", true, 10_000, None).is_none());
    }

    #[test]
    fn preserves_instance_location_in_desktop_relaunch_arguments() {
        let mut cfg = config();
        cfg.is_game_no_vr = true;
        let location = "wrld_4432ea9b-729c-46e3-8eaf-846aa0a37fdd:00001~region(us)";
        let plan = plan_crash_relaunch(&cfg, location, false, 10_000, None).unwrap();
        assert_eq!(
            plan.launch_arguments,
            format!("vrchat://launch?id={location} --profile=0 --no-vr")
        );
        assert_eq!(plan.delay.as_secs(), 2);
    }

    #[test]
    fn dedupes_recent_crash_relaunch_attempts() {
        assert!(
            plan_crash_relaunch(&config(), "wrld_test:1", false, 10_000, Some(9_000)).is_none()
        );
        assert!(
            plan_crash_relaunch(&config(), "wrld_test:1", false, 200_000, Some(9_000)).is_some()
        );
    }
}
