use super::test_support::*;
use vrcx_0_application_core::{HostSessionGameProcessStatus, Result};
use vrcx_0_core::friends::{FriendBaselineEntry, FriendRecord};

fn set_game_running(runtime: &TestRealtimeHostRuntime, running: bool) {
    runtime
        .runtime()
        .deps
        .session
        .apply_game_process_status(HostSessionGameProcessStatus {
            is_game_running: running,
            is_steamvr_running: running,
            changed_at: 1783936740,
        });
}

#[test]
fn automatic_history_uses_the_current_roster_instead_of_cached_friend_flags() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("profile-history-friends")?;
    runtime.sync_friend_baseline(
        &session,
        [(
            "usr_friend".into(),
            FriendBaselineEntry {
                record: FriendRecord {
                    id: "usr_friend".into(),
                    ..Default::default()
                },
                ..Default::default()
            },
        )]
        .into_iter()
        .collect(),
    )?;
    let baseline_rows = runtime.store().take_profile_history("usr_self");
    assert!(!baseline_rows.is_empty());
    assert!(baseline_rows.iter().all(|row| row["id"] == "usr_friend"));
    for id in ["usr_self", "usr_friend", "usr_stranger"] {
        runtime
            .runtime()
            .record_user_profile(&session.endpoint, &json!({"id":id,"bio":"observed"}));
    }
    let rows = runtime.store().take_profile_history("usr_self");
    assert_eq!(
        rows.iter()
            .map(|row| row["id"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["usr_self", "usr_friend"]
    );
    runtime.runtime().ingest_user_facts(vec![json!({
        "user":{"id":"usr_stranger","bio":"background search"},"source":"profile","isFriend":true,
    })]);
    assert!(runtime.store().take_profile_history("usr_self").is_empty());

    runtime.sync_friend_baseline(&session, Default::default())?;
    runtime.store().take_profile_history("usr_self");
    runtime.runtime().record_user_profile(
        &session.endpoint,
        &json!({"id":"usr_friend","bio":"late response after unfriending"}),
    );
    assert!(runtime.store().take_profile_history("usr_self").is_empty());
    Ok(())
}

#[test]
fn leaving_the_instance_ends_automatic_history_and_manual_opens_are_one_observation() -> Result<()>
{
    let (_dir, runtime, session) = runtime_with_active_session("profile-history-instance")?;
    let game = runtime.local_game_context_for_test();
    set_game_running(&runtime, true);
    game.set_location("wrld_current:456");
    game.set_player_user_ids(vec!["usr_player".into()]);
    let automatic = || {
        runtime.runtime().record_user_profile(
            &session.endpoint,
            &json!({"id":"usr_player","pronouns":"they/them"}),
        )
    };
    automatic();
    assert_eq!(runtime.store().take_profile_history("usr_self").len(), 1);

    game.set_player_user_ids(Vec::new());
    automatic();
    assert!(runtime.store().take_profile_history("usr_self").is_empty());
    // An explicit profile request grants only that observation, even outside the instance.
    runtime.runtime().ingest_user_facts(vec![json!({
        "user":{"id":"usr_player","pronouns":"she/her"}, "source":"profile",
        "manualProfileHistory":true, "ownerUserId":"usr_self", "endpoint":session.endpoint,
    })]);
    assert_eq!(runtime.store().take_profile_history("usr_self").len(), 1);
    automatic();
    assert!(runtime.store().take_profile_history("usr_self").is_empty());

    game.set_player_user_ids(vec!["usr_player".into()]);
    game.set_location("traveling");
    automatic();
    assert!(runtime.store().take_profile_history("usr_self").is_empty());
    game.set_location("wrld_current:456");
    set_game_running(&runtime, false);
    automatic();
    assert!(runtime.store().take_profile_history("usr_self").is_empty());
    Ok(())
}

#[test]
fn manual_history_rejects_responses_from_an_old_account_or_endpoint() -> Result<()> {
    let (_dir, runtime, session) = runtime_with_active_session("profile-history-manual-scope")?;
    for (owner, endpoint) in [
        ("usr_other", session.endpoint.as_str()),
        ("usr_self", "https://other.test"),
    ] {
        runtime.runtime().ingest_user_facts(vec![json!({
            "user":{"id":"usr_stranger","status":"busy"}, "source":"profile",
            "manualProfileHistory":true, "ownerUserId":owner, "endpoint":endpoint,
        })]);
    }
    assert!(runtime.store().take_profile_history("usr_self").is_empty());
    runtime.runtime().ingest_user_facts(vec![json!({
        "user":{"id":"usr_self","bio":"My opened profile"}, "source":"profile",
        "isCurrentUser":true, "manualProfileHistory":true,
        "ownerUserId":"usr_self", "endpoint":session.endpoint,
    })]);
    assert_eq!(runtime.store().take_profile_history("usr_self").len(), 1);
    let (_dir, headless, session) =
        runtime_with_unavailable_game_context_active_session("profile-history-no-instance")?;
    headless.runtime().record_user_profile(
        &session.endpoint,
        &json!({"id":"usr_stranger","bio":"unrelated background result"}),
    );
    assert!(headless.store().take_profile_history("usr_self").is_empty());
    Ok(())
}
