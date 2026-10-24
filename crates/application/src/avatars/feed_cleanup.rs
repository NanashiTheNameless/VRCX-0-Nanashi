use super::AvatarFeedCleanupStore;
use serde::{Deserialize, Serialize};
use vrcx_0_application_core::Result;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AvatarFeedCleanupStatus {
    Completed,
    OptimizationFailed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AvatarFeedCleanupOutcome {
    pub deleted_rows: i64,
    pub status: AvatarFeedCleanupStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optimization_error: Option<String>,
}

pub fn cleanup_avatar_feed_history(
    store: &dyn AvatarFeedCleanupStore,
    user_id: String,
    cutoff_date: Option<i64>,
) -> Result<AvatarFeedCleanupOutcome> {
    let deleted_rows = store.purge_avatar_feed(user_id, cutoff_date)?;
    let optimization_error = match store.vacuum_if_fragmented() {
        Ok(vacuumed) => {
            tracing::debug!(deleted_rows, vacuumed, "avatar feed cleanup finished");
            None
        }
        Err(error) => Some(error.to_string()),
    };
    Ok(cleanup_outcome(deleted_rows, optimization_error))
}

fn cleanup_outcome(
    deleted_rows: i64,
    optimization_error: Option<String>,
) -> AvatarFeedCleanupOutcome {
    AvatarFeedCleanupOutcome {
        deleted_rows,
        status: if optimization_error.is_some() {
            AvatarFeedCleanupStatus::OptimizationFailed
        } else {
            AvatarFeedCleanupStatus::Completed
        },
        optimization_error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeStore;

    impl AvatarFeedCleanupStore for FakeStore {
        fn purge_avatar_feed(&self, user_id: String, cutoff_date: Option<i64>) -> Result<i64> {
            assert_eq!(user_id, "usr_test");
            assert_eq!(cutoff_date, None);
            Ok(0)
        }

        fn vacuum_if_fragmented(&self) -> Result<bool> {
            Ok(false)
        }
    }

    #[test]
    fn cleanup_owns_purge_and_database_optimization() {
        let outcome = cleanup_avatar_feed_history(&FakeStore, "usr_test".into(), None).unwrap();

        assert_eq!(outcome.deleted_rows, 0);
        assert_eq!(outcome.status, AvatarFeedCleanupStatus::Completed);
        assert_eq!(outcome.optimization_error, None);
    }

    #[test]
    fn optimization_failure_is_reported_as_a_partial_outcome() {
        let outcome = cleanup_outcome(12, Some("vacuum failed".into()));

        assert_eq!(outcome.deleted_rows, 12);
        assert_eq!(outcome.status, AvatarFeedCleanupStatus::OptimizationFailed);
        assert_eq!(outcome.optimization_error.as_deref(), Some("vacuum failed"));
    }
}
