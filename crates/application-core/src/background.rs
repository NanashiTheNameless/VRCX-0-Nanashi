use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::task_supervisor::{TaskStopToken, TaskSupervisor};
use crate::RuntimeOperationStatus;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::Serialize;
use vrcx_0_core::time::{iso_millis, now_iso};

const DATABASE_OPTIMIZE_JOB: &str = "databaseOptimize";
const DATABASE_OPTIMIZE_INITIAL_DELAY_SECONDS: u64 = 3_600;
const DATABASE_OPTIMIZE_INTERVAL_SECONDS: u64 = 86_400;
const DATABASE_CHECKPOINT_JOB: &str = "databaseCheckpoint";
const DATABASE_CHECKPOINT_INTERVAL_SECONDS: u64 = 86_400;
const DATABASE_WAL_TRUNCATE_JOB: &str = "databaseWalTruncate";
const DATABASE_WAL_TRUNCATE_INTERVAL_SECONDS: u64 = 30 * DATABASE_CHECKPOINT_INTERVAL_SECONDS;
const CANCELLABLE_SLEEP_CHUNK: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DatabaseCheckpointResult {
    pub busy: bool,
    pub log_frames: i64,
    pub checkpointed_frames: i64,
}

impl DatabaseCheckpointResult {
    pub fn is_complete(self) -> bool {
        !self.busy && self.log_frames == self.checkpointed_frames
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DatabaseCheckpointKind {
    WalWriteBack,
    WalTruncate,
}

fn maintenance_initial_delay_seconds(
    last_attempt_at: Option<&str>,
    now: DateTime<Utc>,
    interval_seconds: u64,
) -> u64 {
    let Some(last_attempt_at) = last_attempt_at
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
    else {
        return 0;
    };
    if last_attempt_at > now {
        return 0;
    }
    let elapsed_seconds = now
        .signed_duration_since(last_attempt_at)
        .num_seconds()
        .try_into()
        .unwrap_or(0);
    interval_seconds.saturating_sub(elapsed_seconds)
}

pub trait DatabaseMaintenancePort: Send + Sync {
    fn optimize(&self) -> crate::Result<()>;

    fn checkpoint_wal_passive(&self) -> crate::Result<DatabaseCheckpointResult>;

    fn truncate_wal(&self) -> crate::Result<DatabaseCheckpointResult>;

    fn last_checkpoint_attempt_at(&self, kind: DatabaseCheckpointKind) -> Option<String>;

    fn record_checkpoint_attempt_at(&self, kind: DatabaseCheckpointKind, attempted_at: String);
}

pub async fn sleep_until_due_or_stopped(total: Duration, stop_token: &TaskStopToken) -> bool {
    let mut remaining = total;
    while !remaining.is_zero() {
        if stop_token.is_stop_requested() {
            return false;
        }
        let chunk = remaining.min(CANCELLABLE_SLEEP_CHUNK);
        tokio::time::sleep(chunk).await;
        remaining = remaining.saturating_sub(chunk);
    }
    !stop_token.is_stop_requested()
}

fn future_iso(seconds: u64) -> String {
    iso_millis(Utc::now() + ChronoDuration::seconds(seconds as i64))
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBackgroundJobSnapshot {
    pub name: String,
    pub owner: String,
    pub status: RuntimeOperationStatus,
    pub cadence_seconds: Option<u64>,
    pub last_started_at: Option<String>,
    pub last_finished_at: Option<String>,
    pub next_run_at: Option<String>,
    pub last_detail: String,
    pub last_error: Option<String>,
    pub failure_count: u64,
}

#[derive(Default)]
struct RuntimeBackgroundJobsInner {
    jobs: Mutex<BTreeMap<String, RuntimeBackgroundJobSnapshot>>,
    database_optimize_started: AtomicBool,
    database_checkpoint_started: AtomicBool,
    database_wal_truncate_started: AtomicBool,
}

#[derive(Clone, Default)]
pub struct RuntimeBackgroundJobs {
    inner: Arc<RuntimeBackgroundJobsInner>,
}

#[derive(Default)]
struct JobStatusTiming {
    started_at: Option<String>,
    finished_at: Option<String>,
    next_run_at: Option<String>,
}

impl RuntimeBackgroundJobs {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_job(
        &self,
        name: impl Into<String>,
        owner: impl Into<String>,
        cadence_seconds: Option<u64>,
        status: RuntimeOperationStatus,
        detail: impl Into<String>,
    ) {
        let name = name.into();
        let owner = owner.into();
        let detail = detail.into();
        match self.inner.jobs.lock() {
            Ok(mut jobs) => {
                jobs.entry(name.clone())
                    .and_modify(|job| {
                        job.owner = owner.clone();
                        job.cadence_seconds = cadence_seconds;
                        job.status = status;
                        job.last_detail = detail.clone();
                        if job.next_run_at.is_none() {
                            job.next_run_at = cadence_seconds.map(future_iso);
                        }
                    })
                    .or_insert_with(|| RuntimeBackgroundJobSnapshot {
                        name,
                        owner,
                        status,
                        cadence_seconds,
                        last_started_at: None,
                        last_finished_at: None,
                        next_run_at: cadence_seconds.map(future_iso),
                        last_detail: detail,
                        last_error: None,
                        failure_count: 0,
                    });
            }
            Err(error) => tracing::warn!("failed to lock runtime background jobs: {error}"),
        }
    }

    pub fn mark_running(&self, name: &str, detail: impl Into<String>) {
        self.upsert_status(
            name,
            RuntimeOperationStatus::Running,
            JobStatusTiming {
                started_at: Some(now_iso()),
                ..Default::default()
            },
            detail,
            false,
        );
    }

    pub fn mark_completed(&self, name: &str, detail: impl Into<String>) {
        self.upsert_status(
            name,
            RuntimeOperationStatus::Idle,
            JobStatusTiming {
                finished_at: Some(now_iso()),
                ..Default::default()
            },
            detail,
            false,
        );
    }

    pub fn mark_failed(&self, name: &str, detail: impl Into<String>) {
        self.upsert_status(
            name,
            RuntimeOperationStatus::Error,
            JobStatusTiming {
                finished_at: Some(now_iso()),
                ..Default::default()
            },
            detail,
            true,
        );
    }

    pub fn mark_scheduled(&self, name: &str, detail: impl Into<String>, delay_seconds: u64) {
        self.upsert_status(
            name,
            RuntimeOperationStatus::Scheduled,
            JobStatusTiming {
                next_run_at: Some(future_iso(delay_seconds)),
                ..Default::default()
            },
            detail,
            false,
        );
    }

    pub fn snapshot(&self) -> Vec<RuntimeBackgroundJobSnapshot> {
        match self.inner.jobs.lock() {
            Ok(jobs) => jobs.values().cloned().collect(),
            Err(error) => {
                tracing::warn!("failed to lock runtime background jobs: {error}");
                Vec::new()
            }
        }
    }

    pub fn start_database_optimize_loop(
        &self,
        database: Arc<dyn DatabaseMaintenancePort>,
        tasks: TaskSupervisor,
    ) {
        if !tasks.has_executor() {
            self.register_job(
                DATABASE_OPTIMIZE_JOB,
                "rust",
                Some(DATABASE_OPTIMIZE_INTERVAL_SECONDS),
                RuntimeOperationStatus::Unavailable,
                "Scheduled PRAGMA optimize needs a host task executor.",
            );
            return;
        }

        if self
            .inner
            .database_optimize_started
            .swap(true, Ordering::AcqRel)
        {
            self.register_job(
                DATABASE_OPTIMIZE_JOB,
                "rust",
                Some(DATABASE_OPTIMIZE_INTERVAL_SECONDS),
                RuntimeOperationStatus::Scheduled,
                "Scheduled PRAGMA optimize loop is already active.",
            );
            return;
        }

        self.register_job(
            DATABASE_OPTIMIZE_JOB,
            "rust",
            Some(DATABASE_OPTIMIZE_INTERVAL_SECONDS),
            RuntimeOperationStatus::Scheduled,
            "Scheduled PRAGMA optimize is owned by the Rust runtime.",
        );

        let jobs = self.clone();
        tasks.spawn_cancellable(move |stop_token| async move {
            jobs.mark_scheduled(
                DATABASE_OPTIMIZE_JOB,
                "Initial PRAGMA optimize is waiting for startup idle time.",
                DATABASE_OPTIMIZE_INITIAL_DELAY_SECONDS,
            );
            if !sleep_until_due_or_stopped(
                Duration::from_secs(DATABASE_OPTIMIZE_INITIAL_DELAY_SECONDS),
                &stop_token,
            )
            .await
            {
                jobs.mark_scheduled(
                    DATABASE_OPTIMIZE_JOB,
                    "Scheduled PRAGMA optimize loop stopped.",
                    DATABASE_OPTIMIZE_INTERVAL_SECONDS,
                );
                return;
            }
            loop {
                if stop_token.is_stop_requested() {
                    jobs.mark_scheduled(
                        DATABASE_OPTIMIZE_JOB,
                        "Scheduled PRAGMA optimize loop stopped.",
                        DATABASE_OPTIMIZE_INTERVAL_SECONDS,
                    );
                    return;
                }
                jobs.mark_running(DATABASE_OPTIMIZE_JOB, "Running PRAGMA optimize.");
                let database_for_task = Arc::clone(&database);
                match tokio::task::spawn_blocking(move || database_for_task.optimize()).await {
                    Ok(Ok(_)) => {
                        jobs.mark_completed(DATABASE_OPTIMIZE_JOB, "PRAGMA optimize finished.")
                    }
                    Ok(Err(error)) => {
                        tracing::warn!("runtime database optimize failed: {error}");
                        jobs.mark_failed(DATABASE_OPTIMIZE_JOB, error.to_string());
                    }
                    Err(error) => {
                        tracing::warn!("runtime database optimize task failed: {error}");
                        jobs.mark_failed(DATABASE_OPTIMIZE_JOB, error.to_string());
                    }
                }
                jobs.mark_scheduled(
                    DATABASE_OPTIMIZE_JOB,
                    "Next PRAGMA optimize run is scheduled.",
                    DATABASE_OPTIMIZE_INTERVAL_SECONDS,
                );
                if !sleep_until_due_or_stopped(
                    Duration::from_secs(DATABASE_OPTIMIZE_INTERVAL_SECONDS),
                    &stop_token,
                )
                .await
                {
                    jobs.mark_scheduled(
                        DATABASE_OPTIMIZE_JOB,
                        "Scheduled PRAGMA optimize loop stopped.",
                        DATABASE_OPTIMIZE_INTERVAL_SECONDS,
                    );
                    return;
                }
            }
        });
    }

    pub fn start_database_checkpoint_loop(
        &self,
        database: Arc<dyn DatabaseMaintenancePort>,
        tasks: TaskSupervisor,
    ) {
        if !tasks.has_executor() {
            self.register_job(
                DATABASE_CHECKPOINT_JOB,
                "rust",
                Some(DATABASE_CHECKPOINT_INTERVAL_SECONDS),
                RuntimeOperationStatus::Unavailable,
                "Scheduled WAL checkpoint needs a host task executor.",
            );
            return;
        }

        if self
            .inner
            .database_checkpoint_started
            .swap(true, Ordering::AcqRel)
        {
            self.register_job(
                DATABASE_CHECKPOINT_JOB,
                "rust",
                Some(DATABASE_CHECKPOINT_INTERVAL_SECONDS),
                RuntimeOperationStatus::Scheduled,
                "Scheduled WAL checkpoint loop is already active.",
            );
            return;
        }

        self.register_job(
            DATABASE_CHECKPOINT_JOB,
            "rust",
            Some(DATABASE_CHECKPOINT_INTERVAL_SECONDS),
            RuntimeOperationStatus::Scheduled,
            "Scheduled WAL checkpoint is owned by the Rust runtime.",
        );

        let jobs = self.clone();
        tasks.spawn_cancellable(move |stop_token| async move {
            let initial_delay = maintenance_initial_delay_seconds(
                database
                    .last_checkpoint_attempt_at(DatabaseCheckpointKind::WalWriteBack)
                    .as_deref(),
                Utc::now(),
                DATABASE_CHECKPOINT_INTERVAL_SECONDS,
            );
            jobs.mark_scheduled(
                DATABASE_CHECKPOINT_JOB,
                "Daily passive WAL checkpoint is scheduled.",
                initial_delay,
            );
            if !sleep_until_due_or_stopped(
                Duration::from_secs(initial_delay),
                &stop_token,
            )
            .await
            {
                jobs.mark_scheduled(
                    DATABASE_CHECKPOINT_JOB,
                    "Scheduled WAL checkpoint loop stopped.",
                    DATABASE_CHECKPOINT_INTERVAL_SECONDS,
                );
                return;
            }
            loop {
                if stop_token.is_stop_requested() {
                    jobs.mark_scheduled(
                        DATABASE_CHECKPOINT_JOB,
                        "Scheduled WAL checkpoint loop stopped.",
                        DATABASE_CHECKPOINT_INTERVAL_SECONDS,
                    );
                    return;
                }
                jobs.mark_running(
                    DATABASE_CHECKPOINT_JOB,
                    "Running daily passive WAL checkpoint.",
                );
                let database_for_task = Arc::clone(&database);
                match tokio::task::spawn_blocking(move || {
                    database_for_task.record_checkpoint_attempt_at(
                        DatabaseCheckpointKind::WalWriteBack,
                        now_iso(),
                    );
                    database_for_task.checkpoint_wal_passive()
                })
                .await
                {
                    Ok(Ok(result)) if result.is_complete() => jobs.mark_completed(
                        DATABASE_CHECKPOINT_JOB,
                        format!(
                            "Daily passive WAL checkpoint finished ({} frames).",
                            result.checkpointed_frames
                        ),
                    ),
                    Ok(Ok(result)) => jobs.mark_completed(
                        DATABASE_CHECKPOINT_JOB,
                        format!(
                            "Passive WAL checkpoint wrote back {} of {} frames; active readers remain.",
                            result.checkpointed_frames, result.log_frames
                        ),
                    ),
                    Ok(Err(error)) => {
                        tracing::warn!("runtime database checkpoint failed: {error}");
                        jobs.mark_failed(DATABASE_CHECKPOINT_JOB, error.to_string());
                    }
                    Err(error) => {
                        tracing::warn!("runtime database checkpoint task failed: {error}");
                        jobs.mark_failed(DATABASE_CHECKPOINT_JOB, error.to_string());
                    }
                }
                jobs.mark_scheduled(
                    DATABASE_CHECKPOINT_JOB,
                    "Next daily passive WAL checkpoint is scheduled.",
                    DATABASE_CHECKPOINT_INTERVAL_SECONDS,
                );
                if !sleep_until_due_or_stopped(
                    Duration::from_secs(DATABASE_CHECKPOINT_INTERVAL_SECONDS),
                    &stop_token,
                )
                .await
                {
                    jobs.mark_scheduled(
                        DATABASE_CHECKPOINT_JOB,
                        "Scheduled WAL checkpoint loop stopped.",
                        DATABASE_CHECKPOINT_INTERVAL_SECONDS,
                    );
                    return;
                }
            }
        });
    }

    pub fn start_database_wal_truncate_loop(
        &self,
        database: Arc<dyn DatabaseMaintenancePort>,
        tasks: TaskSupervisor,
    ) {
        if !tasks.has_executor() {
            self.register_job(
                DATABASE_WAL_TRUNCATE_JOB,
                "rust",
                Some(DATABASE_WAL_TRUNCATE_INTERVAL_SECONDS),
                RuntimeOperationStatus::Unavailable,
                "Scheduled WAL truncation needs a host task executor.",
            );
            return;
        }

        if self
            .inner
            .database_wal_truncate_started
            .swap(true, Ordering::AcqRel)
        {
            self.register_job(
                DATABASE_WAL_TRUNCATE_JOB,
                "rust",
                Some(DATABASE_WAL_TRUNCATE_INTERVAL_SECONDS),
                RuntimeOperationStatus::Scheduled,
                "Scheduled WAL truncation loop is already active.",
            );
            return;
        }

        self.register_job(
            DATABASE_WAL_TRUNCATE_JOB,
            "rust",
            Some(DATABASE_WAL_TRUNCATE_INTERVAL_SECONDS),
            RuntimeOperationStatus::Scheduled,
            "Monthly WAL truncation is owned by the Rust runtime.",
        );

        let jobs = self.clone();
        tasks.spawn_cancellable(move |stop_token| async move {
            let initial_delay = maintenance_initial_delay_seconds(
                database
                    .last_checkpoint_attempt_at(DatabaseCheckpointKind::WalTruncate)
                    .as_deref(),
                Utc::now(),
                DATABASE_WAL_TRUNCATE_INTERVAL_SECONDS,
            );
            jobs.mark_scheduled(
                DATABASE_WAL_TRUNCATE_JOB,
                "Monthly WAL truncation is scheduled.",
                initial_delay,
            );
            if !sleep_until_due_or_stopped(
                Duration::from_secs(initial_delay),
                &stop_token,
            )
            .await
            {
                jobs.mark_scheduled(
                    DATABASE_WAL_TRUNCATE_JOB,
                    "Scheduled WAL truncation loop stopped.",
                    DATABASE_WAL_TRUNCATE_INTERVAL_SECONDS,
                );
                return;
            }
            loop {
                if stop_token.is_stop_requested() {
                    jobs.mark_scheduled(
                        DATABASE_WAL_TRUNCATE_JOB,
                        "Scheduled WAL truncation loop stopped.",
                        DATABASE_WAL_TRUNCATE_INTERVAL_SECONDS,
                    );
                    return;
                }
                jobs.mark_running(
                    DATABASE_WAL_TRUNCATE_JOB,
                    "Running monthly WAL truncation.",
                );
                let database_for_task = Arc::clone(&database);
                match tokio::task::spawn_blocking(move || {
                    database_for_task.record_checkpoint_attempt_at(
                        DatabaseCheckpointKind::WalTruncate,
                        now_iso(),
                    );
                    database_for_task.truncate_wal()
                })
                .await
                {
                    Ok(Ok(result)) if result.is_complete() => jobs.mark_completed(
                        DATABASE_WAL_TRUNCATE_JOB,
                        "Monthly WAL truncation finished.",
                    ),
                    Ok(Ok(result)) => jobs.mark_completed(
                        DATABASE_WAL_TRUNCATE_JOB,
                        format!(
                            "Monthly WAL truncation skipped because active readers remain ({} of {} frames written back).",
                            result.checkpointed_frames, result.log_frames
                        ),
                    ),
                    Ok(Err(error)) => {
                        tracing::warn!("runtime database WAL truncation failed: {error}");
                        jobs.mark_failed(DATABASE_WAL_TRUNCATE_JOB, error.to_string());
                    }
                    Err(error) => {
                        tracing::warn!("runtime database WAL truncation task failed: {error}");
                        jobs.mark_failed(DATABASE_WAL_TRUNCATE_JOB, error.to_string());
                    }
                }
                jobs.mark_scheduled(
                    DATABASE_WAL_TRUNCATE_JOB,
                    "Next monthly WAL truncation is scheduled.",
                    DATABASE_WAL_TRUNCATE_INTERVAL_SECONDS,
                );
                if !sleep_until_due_or_stopped(
                    Duration::from_secs(DATABASE_WAL_TRUNCATE_INTERVAL_SECONDS),
                    &stop_token,
                )
                .await
                {
                    jobs.mark_scheduled(
                        DATABASE_WAL_TRUNCATE_JOB,
                        "Scheduled WAL truncation loop stopped.",
                        DATABASE_WAL_TRUNCATE_INTERVAL_SECONDS,
                    );
                    return;
                }
            }
        });
    }

    fn upsert_status(
        &self,
        name: &str,
        status: RuntimeOperationStatus,
        timing: JobStatusTiming,
        detail: impl Into<String>,
        failed: bool,
    ) {
        let detail = detail.into();
        match self.inner.jobs.lock() {
            Ok(mut jobs) => {
                let job = match jobs.get_mut(name) {
                    Some(job) => job,
                    None => jobs.entry(name.to_string()).or_insert_with(|| {
                        RuntimeBackgroundJobSnapshot {
                            name: name.to_string(),
                            owner: "rust".into(),
                            status,
                            cadence_seconds: None,
                            last_started_at: None,
                            last_finished_at: None,
                            next_run_at: None,
                            last_detail: String::new(),
                            last_error: None,
                            failure_count: 0,
                        }
                    }),
                };
                job.status = status;
                if let Some(started_at) = timing.started_at {
                    job.last_started_at = Some(started_at);
                }
                if let Some(finished_at) = timing.finished_at {
                    job.last_finished_at = Some(finished_at);
                }
                if let Some(next_run_at) = timing.next_run_at {
                    job.next_run_at = Some(next_run_at);
                } else if matches!(
                    status,
                    RuntimeOperationStatus::Idle | RuntimeOperationStatus::Error
                ) {
                    if job.next_run_at.is_none() {
                        job.next_run_at = job.cadence_seconds.map(future_iso);
                    }
                } else if status == RuntimeOperationStatus::Running {
                    job.next_run_at = None;
                }
                job.last_detail = detail;
                if failed {
                    job.last_error = Some(job.last_detail.clone());
                    job.failure_count = job.failure_count.saturating_add(1);
                } else if matches!(
                    status,
                    RuntimeOperationStatus::Running | RuntimeOperationStatus::Idle
                ) {
                    job.last_error = None;
                }
            }
            Err(error) => tracing::warn!("failed to lock runtime background jobs: {error}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_job_failure_records_last_error_and_retry_state() {
        let jobs = RuntimeBackgroundJobs::new();
        jobs.register_job(
            "sync",
            "rust",
            Some(60),
            RuntimeOperationStatus::Scheduled,
            "waiting",
        );
        jobs.mark_failed("sync", "network failed");

        let failed = jobs
            .snapshot()
            .into_iter()
            .find(|job| job.name == "sync")
            .unwrap();
        assert_eq!(failed.status, RuntimeOperationStatus::Error);
        assert_eq!(failed.last_error.as_deref(), Some("network failed"));
        assert_eq!(failed.failure_count, 1);
        assert!(failed.next_run_at.is_some());

        jobs.mark_running("sync", "retrying");
        let retrying = jobs
            .snapshot()
            .into_iter()
            .find(|job| job.name == "sync")
            .unwrap();
        assert_eq!(retrying.status, RuntimeOperationStatus::Running);
        assert!(retrying.last_error.is_none());
        assert!(retrying.next_run_at.is_none());
    }

    #[test]
    fn persisted_maintenance_time_controls_the_natural_time_delay() {
        let now = DateTime::parse_from_rfc3339("2026-08-23T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            maintenance_initial_delay_seconds(None, now, DATABASE_CHECKPOINT_INTERVAL_SECONDS),
            0
        );
        assert_eq!(
            maintenance_initial_delay_seconds(
                Some("2026-08-22T13:00:00Z"),
                now,
                DATABASE_CHECKPOINT_INTERVAL_SECONDS,
            ),
            3_600
        );
        assert_eq!(
            maintenance_initial_delay_seconds(
                Some("2026-08-22T12:00:00Z"),
                now,
                DATABASE_CHECKPOINT_INTERVAL_SECONDS,
            ),
            0
        );
        assert_eq!(
            maintenance_initial_delay_seconds(
                Some("invalid"),
                now,
                DATABASE_CHECKPOINT_INTERVAL_SECONDS,
            ),
            0
        );
    }
}
