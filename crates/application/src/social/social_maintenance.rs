use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use futures_util::future::BoxFuture;
use vrcx_0_application_core::{RuntimeBackgroundJobs, RuntimeOperationStatus, TaskSupervisor};

use super::PROFILE_BIO_SCAN_INTERVAL;

pub const BACKGROUND_CURRENT_USER_REFRESH_JOB: &str = "backgroundCurrentUserRefresh";
pub const BACKGROUND_GROUP_INSTANCE_REFRESH_JOB: &str = "backgroundGroupInstanceRefresh";
pub const BACKGROUND_GROUP_INSTANCE_NOTIFICATION_REFRESH_JOB: &str =
    "backgroundGroupInstanceNotificationRefresh";
pub const BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB: &str = "backgroundSocialBaselineRefresh";
pub const BACKGROUND_MODERATION_REFRESH_JOB: &str = "backgroundModerationRefresh";
pub const BACKGROUND_PRINT_CLEANUP_JOB: &str = "printAutoCleanup";
pub const BACKGROUND_PROFILE_BIO_SCAN_JOB: &str = "backgroundProfileBioScan";
pub const BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS: u64 = 300;
pub const BACKGROUND_GROUP_INSTANCE_NOTIFICATION_CADENCE_SECONDS: u64 = 120;
pub const BACKGROUND_CURRENT_USER_CADENCE_SECONDS: u64 = 300;
pub const BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS: u64 = 3_600;
pub const BACKGROUND_MODERATION_CADENCE_SECONDS: u64 = 30 * 60;
pub const BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS: u64 = 30 * 60;

const SOCIAL_MAINTENANCE_SLEEP_CHUNK: Duration = Duration::from_secs(1);

pub trait SocialMaintenanceActions: Send + Sync {
    fn active_scope_key(&self) -> Option<String>;

    fn favorite_friend_group_membership(&self) -> Option<HashMap<String, Vec<String>>>;

    fn group_instance_notification_group_ids(&self) -> Vec<String>;

    fn refresh_current_user(&self) -> BoxFuture<'_, ()>;

    fn refresh_group_instances(&self) -> BoxFuture<'_, ()>;

    fn refresh_group_instance_notifications<'a>(
        &'a self,
        group_ids: &'a [String],
    ) -> BoxFuture<'a, ()>;

    fn refresh_social_baseline<'a>(
        &'a self,
        favorite_friend_groups_by_key: &'a mut HashMap<String, Vec<String>>,
    ) -> BoxFuture<'a, ()>;

    fn refresh_moderation(&self) -> BoxFuture<'_, ()>;

    fn schedule_print_cleanup(&self);

    fn scan_profile_bio(&self) -> BoxFuture<'_, ()>;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct SocialMaintenanceTickPlan {
    reset_scope_state: bool,
    initialize_favorite_groups: bool,
    refresh_current_user: bool,
    refresh_group_instances: bool,
    refresh_group_instance_notifications: bool,
    refresh_social_baseline: bool,
    refresh_moderation: bool,
    schedule_print_cleanup: bool,
    scan_profile_bio: bool,
}

struct SocialMaintenanceSchedule {
    active_scope_key: String,
    favorite_groups_initialized: bool,
    next_current_user: Instant,
    next_group_instances: Instant,
    group_instance_notification_group_ids: Vec<String>,
    next_group_instance_notifications: Instant,
    next_social: Instant,
    next_moderation: Instant,
    next_print_cleanup: Instant,
    next_profile_bio: Instant,
}

impl SocialMaintenanceSchedule {
    fn new(
        now: Instant,
        active_scope_key: String,
        group_instance_notification_group_ids: Vec<String>,
    ) -> Self {
        Self {
            active_scope_key,
            favorite_groups_initialized: false,
            next_current_user: now,
            next_group_instances: now,
            group_instance_notification_group_ids,
            next_group_instance_notifications: now,
            next_social: now + Duration::from_secs(BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS),
            next_moderation: now,
            next_print_cleanup: now,
            next_profile_bio: now,
        }
    }

    fn plan(
        &mut self,
        now: Instant,
        scope_key: String,
        group_instance_notification_group_ids: Vec<String>,
    ) -> SocialMaintenanceTickPlan {
        let reset_scope_state = scope_key != self.active_scope_key;
        if reset_scope_state {
            self.active_scope_key = scope_key;
            self.favorite_groups_initialized = false;
            self.next_current_user = now;
            self.next_group_instances = now;
            self.next_group_instance_notifications = now;
            self.next_social =
                now + Duration::from_secs(BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS);
            self.next_moderation = now;
            self.next_print_cleanup = now;
            self.next_profile_bio = now;
        }

        if self.group_instance_notification_group_ids != group_instance_notification_group_ids {
            self.group_instance_notification_group_ids = group_instance_notification_group_ids;
            self.next_group_instance_notifications = now;
        }

        let refresh_current_user = now >= self.next_current_user;
        if refresh_current_user {
            self.next_current_user =
                now + Duration::from_secs(BACKGROUND_CURRENT_USER_CADENCE_SECONDS);
        }
        let refresh_group_instances = now >= self.next_group_instances;
        if refresh_group_instances {
            self.next_group_instances =
                now + Duration::from_secs(BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS);
        }
        let refresh_group_instance_notifications =
            !self.group_instance_notification_group_ids.is_empty()
                && now >= self.next_group_instance_notifications;
        if refresh_group_instance_notifications {
            self.next_group_instance_notifications =
                now + Duration::from_secs(BACKGROUND_GROUP_INSTANCE_NOTIFICATION_CADENCE_SECONDS);
        }
        let refresh_social_baseline = now >= self.next_social;
        if refresh_social_baseline {
            self.next_social =
                now + Duration::from_secs(BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS);
        }
        let refresh_moderation = now >= self.next_moderation;
        if refresh_moderation {
            self.next_moderation = now + Duration::from_secs(BACKGROUND_MODERATION_CADENCE_SECONDS);
        }
        let schedule_print_cleanup = now >= self.next_print_cleanup;
        if schedule_print_cleanup {
            self.next_print_cleanup =
                now + Duration::from_secs(BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS);
        }
        let scan_profile_bio = now >= self.next_profile_bio;
        if scan_profile_bio {
            self.next_profile_bio = now + PROFILE_BIO_SCAN_INTERVAL;
        }

        SocialMaintenanceTickPlan {
            reset_scope_state,
            initialize_favorite_groups: !self.favorite_groups_initialized,
            refresh_current_user,
            refresh_group_instances,
            refresh_group_instance_notifications,
            refresh_social_baseline,
            refresh_moderation,
            schedule_print_cleanup,
            scan_profile_bio,
        }
    }

    fn mark_favorite_groups_initialized(&mut self) {
        self.favorite_groups_initialized = true;
    }
}

pub struct SocialMaintenanceRuntime {
    actions: Arc<dyn SocialMaintenanceActions>,
    background_jobs: RuntimeBackgroundJobs,
    tasks: TaskSupervisor,
    running: Arc<AtomicBool>,
}

impl SocialMaintenanceRuntime {
    pub fn new(
        actions: Arc<dyn SocialMaintenanceActions>,
        background_jobs: RuntimeBackgroundJobs,
        tasks: TaskSupervisor,
    ) -> Self {
        Self {
            actions,
            background_jobs,
            tasks,
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(&self) {
        let Some(active_scope_key) = self.actions.active_scope_key() else {
            return;
        };
        if self.running.swap(true, Ordering::AcqRel) {
            return;
        }

        register_social_maintenance_jobs(&self.background_jobs);

        let actions = Arc::clone(&self.actions);
        let background_jobs = self.background_jobs.clone();
        let running = Arc::clone(&self.running);
        self.tasks.spawn_cancellable(move |stop_token| async move {
            let mut favorite_friend_groups_by_key = HashMap::new();
            let mut schedule = SocialMaintenanceSchedule::new(
                Instant::now(),
                active_scope_key,
                actions.group_instance_notification_group_ids(),
            );

            while !stop_token.is_stop_requested() {
                let Some(scope_key) = actions.active_scope_key() else {
                    break;
                };

                let notification_group_ids = actions.group_instance_notification_group_ids();
                let plan = schedule.plan(Instant::now(), scope_key, notification_group_ids.clone());
                if plan.reset_scope_state {
                    favorite_friend_groups_by_key.clear();
                }
                if plan.refresh_current_user {
                    actions.refresh_current_user().await;
                }
                if plan.refresh_group_instances {
                    actions.refresh_group_instances().await;
                }
                if plan.refresh_group_instance_notifications {
                    actions
                        .refresh_group_instance_notifications(&notification_group_ids)
                        .await;
                }
                if plan.initialize_favorite_groups {
                    if let Some(groups) = actions.favorite_friend_group_membership() {
                        favorite_friend_groups_by_key = groups;
                        schedule.mark_favorite_groups_initialized();
                    }
                }
                if plan.refresh_social_baseline {
                    actions
                        .refresh_social_baseline(&mut favorite_friend_groups_by_key)
                        .await;
                }
                if plan.refresh_moderation {
                    actions.refresh_moderation().await;
                }
                if plan.schedule_print_cleanup {
                    actions.schedule_print_cleanup();
                }
                if plan.scan_profile_bio {
                    actions.scan_profile_bio().await;
                }

                tokio::time::sleep(SOCIAL_MAINTENANCE_SLEEP_CHUNK).await;
            }

            running.store(false, Ordering::Release);
            mark_social_maintenance_jobs_stopped(&background_jobs);
        });
    }
}

fn register_social_maintenance_jobs(background_jobs: &RuntimeBackgroundJobs) {
    for (name, cadence, detail) in [
        (
            BACKGROUND_CURRENT_USER_REFRESH_JOB,
            BACKGROUND_CURRENT_USER_CADENCE_SECONDS,
            "Background current user refresh is scheduled.",
        ),
        (
            BACKGROUND_GROUP_INSTANCE_REFRESH_JOB,
            BACKGROUND_GROUP_INSTANCE_CADENCE_SECONDS,
            "Background group instance refresh is scheduled.",
        ),
        (
            BACKGROUND_GROUP_INSTANCE_NOTIFICATION_REFRESH_JOB,
            BACKGROUND_GROUP_INSTANCE_NOTIFICATION_CADENCE_SECONDS,
            "Saved group instance notification refresh is scheduled.",
        ),
        (
            BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
            BACKGROUND_SOCIAL_BASELINE_CADENCE_SECONDS,
            "Background social baseline refresh is scheduled.",
        ),
        (
            BACKGROUND_MODERATION_REFRESH_JOB,
            BACKGROUND_MODERATION_CADENCE_SECONDS,
            "Background moderation refresh is scheduled.",
        ),
        (
            BACKGROUND_PRINT_CLEANUP_JOB,
            BACKGROUND_PRINT_CLEANUP_CADENCE_SECONDS,
            "Print auto cleanup fallback is scheduled.",
        ),
        (
            BACKGROUND_PROFILE_BIO_SCAN_JOB,
            PROFILE_BIO_SCAN_INTERVAL.as_secs(),
            "Background profile bio scan is scheduled.",
        ),
    ] {
        background_jobs.register_job(
            name,
            "rust-host",
            Some(cadence),
            RuntimeOperationStatus::Scheduled,
            detail,
        );
    }
}

fn mark_social_maintenance_jobs_stopped(background_jobs: &RuntimeBackgroundJobs) {
    for (name, detail) in [
        (
            BACKGROUND_CURRENT_USER_REFRESH_JOB,
            "Background current user refresh stopped.",
        ),
        (
            BACKGROUND_GROUP_INSTANCE_REFRESH_JOB,
            "Background group instance refresh stopped.",
        ),
        (
            BACKGROUND_GROUP_INSTANCE_NOTIFICATION_REFRESH_JOB,
            "Saved group instance notification refresh stopped.",
        ),
        (
            BACKGROUND_SOCIAL_BASELINE_REFRESH_JOB,
            "Background social baseline refresh stopped.",
        ),
        (
            BACKGROUND_MODERATION_REFRESH_JOB,
            "Background moderation refresh stopped.",
        ),
        (
            BACKGROUND_PRINT_CLEANUP_JOB,
            "Print auto cleanup fallback stopped.",
        ),
        (
            BACKGROUND_PROFILE_BIO_SCAN_JOB,
            "Background profile bio scan stopped.",
        ),
    ] {
        background_jobs.mark_completed(name, detail);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_schedule_runs_fast_refreshes_and_delays_social_baseline() {
        let now = Instant::now();
        let mut schedule = SocialMaintenanceSchedule::new(now, "scope-a".into(), Vec::new());

        let plan = schedule.plan(now, "scope-a".into(), Vec::new());

        assert_eq!(
            plan,
            SocialMaintenanceTickPlan {
                initialize_favorite_groups: true,
                refresh_current_user: true,
                refresh_group_instances: true,
                refresh_moderation: true,
                schedule_print_cleanup: true,
                scan_profile_bio: true,
                ..Default::default()
            }
        );
    }

    #[test]
    fn profile_bio_scan_ticks_every_few_seconds() {
        let now = Instant::now();
        let mut schedule = SocialMaintenanceSchedule::new(now, "scope-a".into(), Vec::new());
        assert!(
            schedule
                .plan(now, "scope-a".into(), Vec::new())
                .scan_profile_bio
        );
        assert!(
            !schedule
                .plan(now + Duration::from_secs(2), "scope-a".into(), Vec::new())
                .scan_profile_bio
        );
        assert!(
            schedule
                .plan(
                    now + PROFILE_BIO_SCAN_INTERVAL,
                    "scope-a".into(),
                    Vec::new()
                )
                .scan_profile_bio
        );
    }

    #[test]
    fn each_refresh_keeps_its_existing_independent_cadence() {
        let now = Instant::now();
        let mut schedule = SocialMaintenanceSchedule::new(now, "scope-a".into(), Vec::new());
        let _ = schedule.plan(now, "scope-a".into(), Vec::new());

        let five_minutes =
            schedule.plan(now + Duration::from_secs(300), "scope-a".into(), Vec::new());
        assert!(five_minutes.refresh_current_user);
        assert!(five_minutes.refresh_group_instances);
        assert!(!five_minutes.refresh_social_baseline);
        assert!(!five_minutes.refresh_moderation);
        assert!(!five_minutes.schedule_print_cleanup);
        assert!(five_minutes.scan_profile_bio);

        let one_hour = schedule.plan(
            now + Duration::from_secs(3_600),
            "scope-a".into(),
            Vec::new(),
        );
        assert!(one_hour.refresh_social_baseline);
        assert!(one_hour.refresh_moderation);
        assert!(one_hour.schedule_print_cleanup);
    }

    #[test]
    fn scope_switch_resets_cached_membership_and_fast_refreshes() {
        let now = Instant::now();
        let mut schedule = SocialMaintenanceSchedule::new(now, "scope-a".into(), Vec::new());
        let _ = schedule.plan(now, "scope-a".into(), Vec::new());
        schedule.mark_favorite_groups_initialized();

        let switched = schedule.plan(now + Duration::from_secs(10), "scope-b".into(), Vec::new());

        assert!(switched.reset_scope_state);
        assert!(switched.initialize_favorite_groups);
        assert!(switched.refresh_current_user);
        assert!(switched.refresh_group_instances);
        assert!(!switched.refresh_social_baseline);
        assert!(switched.refresh_moderation);
        assert!(switched.schedule_print_cleanup);
    }

    #[test]
    fn favorite_membership_initialization_is_not_repeated_until_scope_changes() {
        let now = Instant::now();
        let mut schedule = SocialMaintenanceSchedule::new(now, "scope-a".into(), Vec::new());
        assert!(
            schedule
                .plan(now, "scope-a".into(), Vec::new())
                .initialize_favorite_groups
        );
        schedule.mark_favorite_groups_initialized();

        assert!(
            !schedule
                .plan(now + Duration::from_secs(1), "scope-a".into(), Vec::new())
                .initialize_favorite_groups
        );
    }

    #[test]
    fn saved_groups_have_a_separate_two_minute_notification_cadence() {
        let now = Instant::now();
        let mut schedule = SocialMaintenanceSchedule::new(now, "scope-a".into(), Vec::new());
        let initial = schedule.plan(now, "scope-a".into(), Vec::new());
        assert!(initial.refresh_group_instances);
        assert!(!initial.refresh_group_instance_notifications);

        let enabled = schedule.plan(
            now + Duration::from_secs(1),
            "scope-a".into(),
            vec!["grp_saved".into()],
        );
        assert!(!enabled.refresh_group_instances);
        assert!(enabled.refresh_group_instance_notifications);

        assert!(
            !schedule
                .plan(
                    now + Duration::from_secs(120),
                    "scope-a".into(),
                    vec!["grp_saved".into()]
                )
                .refresh_group_instance_notifications
        );
        assert!(
            schedule
                .plan(
                    now + Duration::from_secs(121),
                    "scope-a".into(),
                    vec!["grp_saved".into()]
                )
                .refresh_group_instance_notifications
        );
    }

    #[test]
    fn changing_the_notification_group_ids_triggers_an_immediate_scan() {
        let now = Instant::now();
        let mut schedule =
            SocialMaintenanceSchedule::new(now, "scope-a".into(), vec!["grp_one".into()]);
        let _ = schedule.plan(now, "scope-a".into(), vec!["grp_one".into()]);

        assert!(
            schedule
                .plan(
                    now + Duration::from_secs(10),
                    "scope-a".into(),
                    vec!["grp_two".into()]
                )
                .refresh_group_instance_notifications
        );
    }
}
