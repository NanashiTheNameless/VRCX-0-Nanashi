mod ports;
mod realtime;
mod social_baseline;
#[cfg(any(test, feature = "test-utils"))]
mod test_store;

mod world_enrich;

#[cfg(any(test, feature = "test-utils"))]
pub mod test_support {
    pub use crate::realtime::service::test_support::{
        feed_lookup_input, runtime_with_active_session, seed_friend_baseline, TestDir,
        TestRealtimeHostRuntime,
    };
}

pub use ports::{RealtimeRemoteRequests, RealtimeStore};
pub use realtime::{
    is_print_created_content_refresh, FriendProfileBulkLoadStatus, FriendProfileLoadStatusPayload,
    FriendProjection, FriendProjectionObserver, FriendProjectionPatch, FriendProjectionSink,
    FriendRosterSnapshot, RealtimeCurrentUserProjection, RealtimeCurrentUserSnapshotSink,
    RealtimeEntryCorrection, RealtimeEntryCorrectionFields, RealtimeEntryCorrectionStream,
    RealtimeFeedProjection, RealtimeFriendRosterSnapshot, RealtimeFriendSnapshot,
    RealtimeHostRuntime, RealtimeHostRuntimeDeps, RealtimeInstanceClosedProjection,
    RealtimeInstanceQueueKind, RealtimeInstanceQueueProjection, RealtimeMessageSink,
    RealtimeNotificationProjection, RealtimeNotificationUpsert, RealtimeSessionContext,
    RealtimeStopRequest, RealtimeTransport, RealtimeTransportFuture,
    RealtimeTransportLifecycleEvent, RealtimeTransportStartResult, RealtimeTransportTermination,
    RealtimeUserProjection, RealtimeWsMessagePayload, RealtimeWsStatus, RealtimeWsStatusPayload,
    SyntheticFriendEventOutcome, UserQueryCachePolicy, UserQueryKind, UserQueryOptions,
};
pub use realtime::{normalize_v1_notification, normalize_v2_notification};
pub use social_baseline::{
    build_favorites_baseline, build_favorites_baseline_from_friend_ids,
    build_synced_friend_roster_baseline, FavoriteBaselineSnapshot, SocialBaselineDeps,
    SocialFavoritesBaselineInput, SocialFavoritesBaselineOutput, SocialFavoritesBaselineRequest,
    SocialFriendRosterBaselineInput, SocialFriendRosterBaselineOutput,
};
