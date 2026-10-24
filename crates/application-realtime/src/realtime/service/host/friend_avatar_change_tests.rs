use std::time::Duration;

use vrcx_0_application_core::Result;
use vrcx_0_contracts::feed::{FeedFilter, FeedRowOutput, FeedRowsQueryInput};
use vrcx_0_contracts::FileMetadataOutput;
use vrcx_0_core::OwnerId;

use super::test_support::{
    feed_lookup_input, feed_rows_query, runtime_with_active_session, seed_friend_baseline,
    TestRealtimeHostRuntime,
};
use crate::realtime::{FriendIconChange, FriendProjection, RealtimeFriendOutput};

fn icon_url(file_id: &str) -> String {
    format!("https://api.vrchat.cloud/api/1/image/{file_id}/1/256")
}

fn icon_change(previous_file_id: &str, next_file_id: &str) -> FriendIconChange {
    FriendIconChange {
        user_id: "usr_friend".into(),
        display_name: "Friend".into(),
        previous_icon_url: icon_url(previous_file_id),
        next_icon_url: icon_url(next_file_id),
        created_at: 1789603200,
    }
}

fn avatar_image(file_id: &str, avatar_name: &str, owner_id: &str) -> FileMetadataOutput {
    FileMetadataOutput::new(
        file_id.into(),
        format!("Avatar - {avatar_name} - Image - 2022․3․22f1_1_standalonewindows_Release"),
        owner_id.into(),
    )
}

fn custom_icon(file_id: &str) -> FileMetadataOutput {
    FileMetadataOutput::new(
        file_id.into(),
        format!("{file_id}_camera_user_icon"),
        "usr_friend".into(),
    )
}

fn output_with_icon_change(owner_user_id: &str, change: FriendIconChange) -> RealtimeFriendOutput {
    let mut output = RealtimeFriendOutput::from_projection(
        OwnerId::new(owner_user_id.to_string()),
        FriendProjection::new(7, 0),
    );
    output.icon_changes.push(change);
    output
}

fn persisted_avatar_rows(runtime: &TestRealtimeHostRuntime, user_id: &str) -> Vec<FeedRowOutput> {
    feed_rows_query(
        runtime.database(),
        FeedRowsQueryInput {
            filters: vec![FeedFilter::Avatar],
            ..feed_lookup_input(user_id.into())
        },
    )
    .unwrap()
}

async fn wait_for_avatar_rows(
    runtime: &TestRealtimeHostRuntime,
    user_id: &str,
    expected: usize,
) -> Vec<FeedRowOutput> {
    for _ in 0..200 {
        let rows = persisted_avatar_rows(runtime, user_id);
        if rows.len() >= expected {
            return rows;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    persisted_avatar_rows(runtime, user_id)
}

#[tokio::test]
async fn icon_change_between_avatar_images_writes_an_avatar_feed_row_and_projects_it() -> Result<()>
{
    let (_dir, runtime, active_session) =
        runtime_with_active_session("avatar-change-avatar-images")?;
    seed_friend_baseline(&runtime, &active_session);
    runtime.cache_file_for_test(avatar_image("file_old", "Old Avatar", "usr_author_old"));
    runtime.cache_file_for_test(avatar_image("file_new", "New Avatar", "usr_author_new"));
    runtime.runtime().deps.event_bus.take_events_for_test();

    runtime
        .runtime()
        .apply_friend_output(output_with_icon_change(
            &active_session.user_id,
            icon_change("file_old", "file_new"),
        ));

    let rows = wait_for_avatar_rows(&runtime, &active_session.user_id, 1).await;
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.user_id.as_deref(), Some("usr_friend"));
    assert_eq!(row.avatar_name.as_deref(), Some("New Avatar"));
    assert_eq!(row.owner_id.as_deref(), Some("usr_author_new"));
    assert_eq!(
        row.current_avatar_image_url.as_deref(),
        Some(icon_url("file_new").as_str())
    );
    assert_eq!(
        row.previous_current_avatar_image_url.as_deref(),
        Some(icon_url("file_old").as_str())
    );

    let events = runtime.runtime().deps.event_bus.take_events_for_test();
    let feed_projection = events
        .iter()
        .find(|event| event.name == "realtimeFeedProjection")
        .expect("resolved avatar change should emit a live feed projection");
    assert_eq!(
        feed_projection.payload["upserts"][0]["entry"]["type"],
        "Avatar"
    );
    assert_eq!(
        feed_projection.payload["upserts"][0]["entry"]["avatarName"],
        "New Avatar"
    );
    assert_eq!(
        feed_projection.payload["upserts"][0]["entry"]["previousAvatarName"],
        "Old Avatar"
    );
    assert_eq!(
        runtime.file_resolve_calls_for_test(),
        vec!["file_new".to_string(), "file_old".to_string()]
    );
    Ok(())
}

#[tokio::test]
async fn switching_to_a_custom_icon_is_dropped_before_the_previous_lookup() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("avatar-change-to-icon")?;
    seed_friend_baseline(&runtime, &active_session);
    runtime.cache_file_for_test(avatar_image("file_old", "Old Avatar", "usr_author_old"));
    runtime.cache_file_for_test(custom_icon("file_icon"));

    runtime
        .runtime()
        .apply_friend_output(output_with_icon_change(
            &active_session.user_id,
            icon_change("file_old", "file_icon"),
        ));
    tokio::time::sleep(Duration::from_millis(50)).await;

    assert!(persisted_avatar_rows(&runtime, &active_session.user_id).is_empty());
    assert_eq!(
        runtime.file_resolve_calls_for_test(),
        vec!["file_icon".to_string()]
    );
    Ok(())
}

#[tokio::test]
async fn switching_from_a_custom_icon_or_unknown_file_keeps_the_new_avatar_without_a_previous(
) -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("avatar-change-from-icon")?;
    seed_friend_baseline(&runtime, &active_session);
    runtime.cache_file_for_test(avatar_image("file_new", "New Avatar", "usr_author_new"));
    runtime.cache_file_for_test(custom_icon("file_icon"));

    runtime
        .runtime()
        .apply_friend_output(output_with_icon_change(
            &active_session.user_id,
            icon_change("file_icon", "file_new"),
        ));
    let rows = wait_for_avatar_rows(&runtime, &active_session.user_id, 1).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].avatar_name.as_deref(), Some("New Avatar"));
    assert_eq!(rows[0].owner_id.as_deref(), Some("usr_author_new"));
    assert_eq!(rows[0].previous_current_avatar_image_url, None);

    runtime
        .runtime()
        .apply_friend_output(output_with_icon_change(
            &active_session.user_id,
            icon_change("file_missing", "file_new"),
        ));
    let rows = wait_for_avatar_rows(&runtime, &active_session.user_id, 2).await;
    assert_eq!(rows.len(), 2);
    assert!(rows
        .iter()
        .all(|row| row.previous_current_avatar_image_url.is_none()));
    Ok(())
}

#[tokio::test]
async fn unresolvable_files_are_dropped() -> Result<()> {
    let (_dir, runtime, active_session) = runtime_with_active_session("avatar-change-unresolved")?;
    seed_friend_baseline(&runtime, &active_session);

    runtime
        .runtime()
        .apply_friend_output(output_with_icon_change(
            &active_session.user_id,
            icon_change("file_old", "file_missing"),
        ));
    tokio::time::sleep(Duration::from_millis(50)).await;

    assert!(persisted_avatar_rows(&runtime, &active_session.user_id).is_empty());
    assert_eq!(
        runtime.file_resolve_calls_for_test(),
        vec!["file_missing".to_string()]
    );
    Ok(())
}
