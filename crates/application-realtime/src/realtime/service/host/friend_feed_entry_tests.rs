use vrcx_0_application_core::Result;
use vrcx_0_contracts::feed::{FeedFilter, FeedRowsQueryInput};
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_core::OwnerId;

use super::test_support::{
    feed_lookup_input, feed_rows_query, runtime_with_active_session, seed_friend_baseline,
    TestRealtimeHostRuntime,
};

fn bio_entry() -> FeedLiveEntry {
    FeedLiveEntry::Bio {
        created_at: 1789689600,
        user_id: "usr_friend".into(),
        display_name: "Friend".into(),
        bio: "new bio".into(),
        previous_bio: "old bio".into(),
        owner_user_id: String::new(),
    }
}

fn persisted_bio_rows(runtime: &TestRealtimeHostRuntime, user_id: &str) -> usize {
    feed_rows_query(
        runtime.database(),
        FeedRowsQueryInput {
            filters: vec![FeedFilter::Bio],
            ..feed_lookup_input(user_id.into())
        },
    )
    .unwrap()
    .len()
}

#[test]
fn publishes_a_friend_feed_entry_into_persistence_and_the_live_projection() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("friend-feed-entry")?;
    seed_friend_baseline(&runtime, &active_session);
    runtime.runtime().deps.event_bus.take_events_for_test();

    assert!(runtime
        .runtime()
        .publish_friend_feed_entry(&OwnerId::new(&active_session.user_id), bio_entry()));

    assert_eq!(persisted_bio_rows(&runtime, &active_session.user_id), 1);
    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let feed_projection = events
        .iter()
        .find(|event| event.name == "realtimeFeedProjection")
        .expect("published entry should emit a live feed projection");
    assert_eq!(
        feed_projection.payload["upserts"][0]["entry"]["type"],
        "Bio"
    );
    assert_eq!(
        feed_projection.payload["upserts"][0]["entry"]["previousBio"],
        "old bio"
    );
    Ok(())
}

#[test]
fn rejects_entries_for_another_owner_or_without_a_friend_baseline() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("friend-feed-entry-reject")?;

    assert!(!runtime
        .runtime()
        .publish_friend_feed_entry(&OwnerId::new(&active_session.user_id), bio_entry()));

    seed_friend_baseline(&runtime, &active_session);
    assert!(!runtime
        .runtime()
        .publish_friend_feed_entry(&OwnerId::new("usr_other"), bio_entry()));
    assert_eq!(persisted_bio_rows(&runtime, &active_session.user_id), 0);
    Ok(())
}
