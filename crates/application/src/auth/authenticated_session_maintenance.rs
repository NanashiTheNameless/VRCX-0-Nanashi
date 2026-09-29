use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use vrcx_0_application_core::{Result, RuntimeAuthScope, RuntimeAuthScopeSnapshot, TaskSupervisor};

const AUTHENTICATED_SESSION_MAINTENANCE_DELAY: Duration = Duration::from_secs(30);

pub trait AuthenticatedSessionMaintenance: Send + Sync {
    fn run_avatar_cleanup(&self, user_id: &str, now: DateTime<Utc>) -> Result<()>;
}

pub fn run_authenticated_session_maintenance(
    maintenance: &dyn AuthenticatedSessionMaintenance,
    user_id: &str,
) {
    let user_id = user_id.trim();
    if user_id.is_empty() {
        tracing::warn!("authenticated session maintenance skipped without a user id");
        return;
    }
    if let Err(error) = maintenance.run_avatar_cleanup(user_id, Utc::now()) {
        tracing::warn!(user_id, error = %error, "avatar auto-cleanup failed");
    }
}

pub struct AuthenticatedSessionMaintenanceRuntime {
    auth_scope: RuntimeAuthScope,
    tasks: TaskSupervisor,
    maintenance: Arc<dyn AuthenticatedSessionMaintenance>,
}

impl AuthenticatedSessionMaintenanceRuntime {
    pub fn new(
        auth_scope: RuntimeAuthScope,
        tasks: TaskSupervisor,
        maintenance: Arc<dyn AuthenticatedSessionMaintenance>,
    ) -> Self {
        Self {
            auth_scope,
            tasks,
            maintenance,
        }
    }

    pub fn schedule(&self, expected_scope: RuntimeAuthScopeSnapshot) {
        let auth_scope = self.auth_scope.clone();
        let maintenance = Arc::clone(&self.maintenance);
        self.tasks.spawn_cancellable(move |stop_token| async move {
            tokio::time::sleep(AUTHENTICATED_SESSION_MAINTENANCE_DELAY).await;
            if stop_token.is_stop_requested()
                || !authenticated_session_maintenance_scope_matches(&auth_scope, &expected_scope)
            {
                return;
            }
            let blocking_auth_scope = auth_scope.clone();
            if let Err(error) = tokio::task::spawn_blocking(move || {
                if authenticated_session_maintenance_scope_matches(
                    &blocking_auth_scope,
                    &expected_scope,
                ) {
                    run_authenticated_session_maintenance(
                        maintenance.as_ref(),
                        &expected_scope.current_user_id,
                    );
                }
            })
            .await
            {
                tracing::warn!(error = %error, "authenticated session maintenance task failed");
            }
        });
    }
}

fn authenticated_session_maintenance_scope_matches(
    auth_scope: &RuntimeAuthScope,
    expected: &RuntimeAuthScopeSnapshot,
) -> bool {
    auth_scope.snapshot().generation_matches(expected)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maintenance_scope_rejects_account_switches_and_logout() {
        let auth_scope = RuntimeAuthScope::new();
        let first = auth_scope.set("usr_first", "");
        assert!(authenticated_session_maintenance_scope_matches(
            &auth_scope,
            &first
        ));

        auth_scope.set("usr_second", "");
        assert!(!authenticated_session_maintenance_scope_matches(
            &auth_scope,
            &first
        ));

        let second = auth_scope.snapshot();
        auth_scope.set("", "");
        assert!(!authenticated_session_maintenance_scope_matches(
            &auth_scope,
            &second
        ));
    }
}
