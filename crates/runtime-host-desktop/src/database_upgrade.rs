use std::path::PathBuf;
use std::sync::Arc;

use vrcx_0_application::profile::{
    DatabaseUpgradePreflight, DatabaseUpgradePreflightStatus, DatabaseUpgradeProgress,
    DatabaseUpgradeRunResult, DatabaseUpgradeRuntime,
};
use vrcx_0_contracts::{LegacyMigrationPaths, LegacyVrcxSource};

use crate::{Error, Result};

pub trait DatabaseUpgradeLifecycle: Send + Sync {
    fn stop_runtime_services(&self);
    fn request_restart(&self);
}

#[derive(Clone)]
pub struct DesktopDatabaseUpgradeRuntime {
    runtime: DatabaseUpgradeRuntime,
    failure_log_path: PathBuf,
}

impl DesktopDatabaseUpgradeRuntime {
    pub fn new(runtime: DatabaseUpgradeRuntime, failure_log_path: PathBuf) -> Self {
        Self {
            runtime,
            failure_log_path,
        }
    }

    pub async fn preflight(&self) -> Result<DatabaseUpgradePreflight> {
        let runtime = self.runtime.clone();
        let preflight = tokio::task::spawn_blocking(move || runtime.preflight())
            .await
            .map_err(|error| {
                Error::Custom(format!("database upgrade preflight task failed: {error}"))
            })??;
        if preflight.status == DatabaseUpgradePreflightStatus::Blocked {
            let failure = preflight.failed_upgrade.as_ref();
            if failure.is_none_or(|failure| failure.failed_at.is_none()) {
                log_interrupted_database_upgrade(
                    failure.and_then(|failure| failure.stage.as_deref()),
                    failure.and_then(|failure| failure.operation.as_deref()),
                    preflight.from_version,
                    preflight.to_version,
                    failure.and_then(|failure| failure.app_version.as_deref()),
                    failure
                        .and_then(|failure| failure.reason.as_deref())
                        .unwrap_or("previous database upgrade did not finish"),
                );
            }
        }
        Ok(preflight)
    }

    pub async fn run(&self) -> Result<DatabaseUpgradeRunResult> {
        let runtime = self.runtime.clone();
        let result = tokio::task::spawn_blocking(move || runtime.run())
            .await
            .map_err(|error| Error::Custom(format!("database upgrade task failed: {error}")))?;
        Ok(result)
    }

    pub fn progress(&self) -> DatabaseUpgradeProgress {
        self.runtime.progress()
    }

    pub async fn retry(&self) -> Result<DatabaseUpgradeRunResult> {
        let runtime = self.runtime.clone();
        let result = tokio::task::spawn_blocking(move || runtime.retry())
            .await
            .map_err(|error| {
                Error::Custom(format!("database upgrade retry task failed: {error}"))
            })??;
        Ok(result)
    }

    pub async fn prepare_legacy_migration(
        &self,
        paths: LegacyMigrationPaths,
        source: LegacyVrcxSource,
    ) -> Result<()> {
        let runtime = self.runtime.clone();
        let result =
            tokio::task::spawn_blocking(move || runtime.prepare_legacy_migration(&paths, &source))
                .await
                .map_err(|error| Error::Custom(format!("legacy migration task failed: {error}")))?
                .map_err(Error::from);
        if let Err(error) = &result {
            tracing::error!(error = %error, "legacy VRCX snapshot preparation failed");
        }
        result
    }

    pub fn failure_log_path(&self) -> String {
        self.failure_log_path.to_string_lossy().into_owned()
    }

    pub async fn start_fresh(
        &self,
        lifecycle: Arc<dyn DatabaseUpgradeLifecycle>,
    ) -> Result<String> {
        lifecycle.stop_runtime_services();
        let runtime = self.runtime.clone();
        let recovery_result = tokio::task::spawn_blocking(move || runtime.start_fresh_database())
            .await
            .map_err(|error| Error::Custom(format!("database fresh-start task failed: {error}")))?;
        let result = finalize_start_fresh(recovery_result.map_err(Error::from), move || {
            lifecycle.request_restart()
        });
        match result {
            Ok(recovery_dir) => {
                tracing::info!(
                    recovery_dir = %recovery_dir.display(),
                    "archived the previous database before starting fresh"
                );
                Ok(recovery_dir.to_string_lossy().into_owned())
            }
            Err(error) => {
                tracing::error!(error = %error, "failed to start with a fresh database");
                Err(error)
            }
        }
    }
}

fn finalize_start_fresh<T>(result: Result<T>, request_restart: impl FnOnce()) -> Result<T> {
    request_restart();
    result
}

fn database_upgrade_failure_token(value: Option<&str>, fallback: &str) -> String {
    let value = value.unwrap_or(fallback);
    let token = value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | ':' | '+' | '-'))
        .take(64)
        .collect::<String>();
    if token.is_empty() {
        fallback.to_string()
    } else {
        token
    }
}

fn log_interrupted_database_upgrade(
    stage: Option<&str>,
    operation: Option<&str>,
    from_version: i64,
    to_version: i64,
    started_app_version: Option<&str>,
    reason: &str,
) {
    let stage = database_upgrade_failure_token(stage, "beforeFirstStage");
    let operation = database_upgrade_failure_token(operation, "unknown");
    let started_app_version = database_upgrade_failure_token(started_app_version, "unknown");
    tracing::error!(
        "database upgrade failure [status=interrupted stage={stage} operation={operation} sqliteCategory=none from={from_version} to={to_version} appVersion={started_app_version}]: {reason}"
    );
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::{database_upgrade_failure_token, finalize_start_fresh};
    use crate::Error;

    #[test]
    fn failure_tokens_preserve_the_existing_diagnostic_sanitization() {
        for (value, fallback, expected) in [
            (Some("copy-db:v1+retry"), "fallback", "copy-db:v1+retry"),
            (Some(" spaces / symbols "), "fallback", "spacessymbols"),
            (Some("///"), "fallback", "fallback"),
            (None, "fallback", "fallback"),
        ] {
            assert_eq!(database_upgrade_failure_token(value, fallback), expected);
        }
        assert_eq!(
            database_upgrade_failure_token(Some(&"a".repeat(80)), "fallback").len(),
            64
        );
    }

    #[test]
    fn fresh_database_completion_always_restarts() {
        for succeeds in [true, false] {
            let restarts = AtomicUsize::new(0);
            let result = if succeeds {
                Ok("recovery")
            } else {
                Err(Error::Custom("failed".into()))
            };

            let result = finalize_start_fresh(result, || {
                restarts.fetch_add(1, Ordering::SeqCst);
            });

            assert_eq!(result.is_ok(), succeeds);
            assert_eq!(restarts.load(Ordering::SeqCst), 1);
        }
    }
}
