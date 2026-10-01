use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application_core::{Result, RuntimeVrchatAuthFailurePayload};
use vrcx_0_core::friends::FriendBaselineEntry;

use crate::realtime::friends::SyntheticFriendEvent;
use crate::realtime::RealtimeFriendApplyResult;

use super::fanout::FriendOutputApplyOutcome;
use super::state::{FriendLogMutation, FriendOwnerGuard, ScopedFriendLogMutation};
use super::RealtimeHostRuntime;
use vrcx_0_core::OwnerId;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyntheticFriendEventOutcome {
    Applied,
    PersistFailed,
    MissingBaseline,
    TransportInactive,
    Ignored,
}

impl RealtimeHostRuntime {
    pub fn report_vrchat_auth_failure(&self, payload: RuntimeVrchatAuthFailurePayload) {
        self.deps
            .auth_scope
            .report_vrchat_auth_failure(&self.deps.event_bus, payload);
    }

    pub fn run_scoped_friend_log_removal<T>(
        &self,
        owner_user_id: &OwnerId,
        endpoint: &str,
        target_user_id: &str,
        mutation: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        self.run_friend_log_current_mutation_with_effect(
            mutation,
            Some(ScopedFriendLogMutation::new(
                owner_user_id,
                endpoint,
                FriendLogMutation::Remove {
                    user_id: target_user_id.trim().to_string(),
                },
            )),
        )
    }

    pub fn run_scoped_friend_log_upsert<T>(
        &self,
        owner_user_id: &OwnerId,
        endpoint: &str,
        entry: FriendBaselineEntry,
        mutation: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        self.run_friend_log_current_mutation_with_effect(
            mutation,
            Some(ScopedFriendLogMutation::new(
                owner_user_id,
                endpoint,
                FriendLogMutation::Upsert {
                    entry: Box::new(entry),
                },
            )),
        )
    }

    pub fn apply_synthetic_friend_delete(
        self: &Arc<Self>,
        expected_owner_user_id: &OwnerId,
        expected_endpoint: &str,
        target_user_id: &str,
        received_at: String,
    ) -> SyntheticFriendEventOutcome {
        let owner = self.lock_friend_owner();
        self.apply_synthetic_friend_event_with_owner(
            &owner,
            expected_owner_user_id,
            expected_endpoint,
            SyntheticFriendEvent::Delete {
                user_id: target_user_id.trim().to_string(),
            },
            received_at,
        )
    }

    pub fn apply_synthetic_trusted_friend_add(
        self: &Arc<Self>,
        expected_owner_user_id: &OwnerId,
        expected_endpoint: &str,
        target_user_id: &str,
        profile: Value,
        received_at: String,
    ) -> SyntheticFriendEventOutcome {
        let owner = self.lock_friend_owner();
        self.apply_synthetic_friend_event_with_owner(
            &owner,
            expected_owner_user_id,
            expected_endpoint,
            SyntheticFriendEvent::TrustedAdd {
                user_id: target_user_id.trim().to_string(),
                profile,
            },
            received_at,
        )
    }

    fn apply_synthetic_friend_event_with_owner(
        self: &Arc<Self>,
        owner: &FriendOwnerGuard<'_>,
        expected_owner_user_id: &OwnerId,
        expected_endpoint: &str,
        event: SyntheticFriendEvent,
        received_at: String,
    ) -> SyntheticFriendEventOutcome {
        if !self.is_transport_current() {
            self.friends.apply_scoped_synthetic_event(
                expected_owner_user_id,
                expected_endpoint,
                event,
                &received_at,
            );
            return SyntheticFriendEventOutcome::TransportInactive;
        }
        match self.friends.apply_scoped_synthetic_event(
            expected_owner_user_id,
            expected_endpoint,
            event,
            &received_at,
        ) {
            RealtimeFriendApplyResult::Output(output) => {
                match self.apply_friend_output_owned(owner, *output) {
                    FriendOutputApplyOutcome::Applied {
                        persistence_succeeded: true,
                    } => SyntheticFriendEventOutcome::Applied,
                    FriendOutputApplyOutcome::Applied {
                        persistence_succeeded: false,
                    }
                    | FriendOutputApplyOutcome::Stale => SyntheticFriendEventOutcome::PersistFailed,
                }
            }
            RealtimeFriendApplyResult::MissingBaseline => {
                SyntheticFriendEventOutcome::MissingBaseline
            }
            RealtimeFriendApplyResult::Ignored => SyntheticFriendEventOutcome::Ignored,
        }
    }

    fn is_transport_current(&self) -> bool {
        let Ok(state) = self.state.lock() else {
            return false;
        };
        state
            .connection
            .active_context
            .as_ref()
            .is_some_and(|active| {
                self.is_message_current_locked(
                    &state,
                    active.generation,
                    active.session_generation,
                    &active.session,
                )
            })
    }
}
