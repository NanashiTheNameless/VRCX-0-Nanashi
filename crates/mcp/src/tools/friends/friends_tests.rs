use super::*;
use vrcx_0_contracts::social_aggregates::{FriendChangeEvent, FriendChangeKind};

fn change_event(kind: FriendChangeKind, new_value: &str) -> FriendChangeEvent {
    FriendChangeEvent {
        changed_at: "2026-06-01T10:00:00Z".into(),
        kind,
        previous_value: String::new(),
        new_value: new_value.into(),
    }
}

fn change_summary(kind: &str, events: Vec<FriendChangeEvent>) -> FriendProfileChangeSummary {
    FriendProfileChangeSummary {
        kind: kind.into(),
        change_count: events.len() as i64,
        last_changed_at: "2026-06-01T10:00:00Z".into(),
        recent_events: events,
    }
}

fn relationship(display_name: &str) -> FriendRelationshipProfile {
    FriendRelationshipProfile {
        is_current_friend: false,
        display_name: display_name.into(),
        trust_level: String::new(),
        friend_number: None,
        friended_at: None,
        recent_events: Vec::new(),
        display_name_changes: Vec::new(),
        trust_changes: Vec::new(),
    }
}

#[test]
fn clamped_friend_note_limit_defaults_then_clamps_into_range() {
    let cases = [
        (None, 25),
        (Some(-5), 25),
        (Some(0), 1),
        (Some(5000), 1000),
        (Some(40), 40),
    ];

    for (limit, expected) in cases {
        assert_eq!(
            clamped_friend_note_limit(limit),
            expected,
            "limit: {limit:?}"
        );
    }
}

#[test]
fn parse_friend_note_cursor_rejects_malformed_values() {
    for value in ["", "no_separator_here", "|usr_a", "2026-06-01T10:00:00Z|"] {
        assert!(parse_friend_note_cursor(value).is_err(), "value: {value}");
    }
}

#[test]
fn parse_friend_note_cursor_splits_on_last_separator() {
    let (edited_at, user_id) =
        parse_friend_note_cursor("2026-06-01T10:00:00Z|usr_a|with|pipes").unwrap();

    assert_eq!(edited_at, "2026-06-01T10:00:00Z|usr_a|with");
    assert_eq!(user_id, "pipes");
}

#[test]
fn friend_change_kind_name_maps_all_variants() {
    assert_eq!(friend_change_kind_name(&FriendChangeKind::Status), "status");
    assert_eq!(friend_change_kind_name(&FriendChangeKind::Avatar), "avatar");
    assert_eq!(friend_change_kind_name(&FriendChangeKind::Bio), "bio");
}

#[test]
fn latest_bio_from_changes_returns_none_when_no_bio_kind_present() {
    let rows = vec![change_summary(
        "status",
        vec![change_event(FriendChangeKind::Status, "online")],
    )];

    assert_eq!(latest_bio_from_changes(&rows), None);
}

#[test]
fn latest_bio_from_changes_returns_none_when_bio_kind_has_no_events() {
    let rows = vec![change_summary("bio", vec![])];

    assert_eq!(latest_bio_from_changes(&rows), None);
}

#[test]
fn latest_bio_from_changes_returns_none_when_first_event_value_is_blank() {
    let rows = vec![change_summary(
        "bio",
        vec![change_event(FriendChangeKind::Bio, "   ")],
    )];

    assert_eq!(latest_bio_from_changes(&rows), None);
}

#[test]
fn latest_bio_from_changes_returns_the_most_recent_bio_events_value() {
    let rows = vec![change_summary(
        "bio",
        vec![
            change_event(FriendChangeKind::Bio, "newest bio"),
            change_event(FriendChangeKind::Bio, "older bio"),
        ],
    )];

    assert_eq!(
        latest_bio_from_changes(&rows),
        Some("newest bio".to_string())
    );
}

#[test]
fn latest_bio_from_changes_skips_non_bio_kinds_before_the_bio_entry() {
    let rows = vec![
        change_summary(
            "status",
            vec![change_event(FriendChangeKind::Status, "online")],
        ),
        change_summary("bio", vec![change_event(FriendChangeKind::Bio, "found it")]),
    ];

    assert_eq!(latest_bio_from_changes(&rows), Some("found it".to_string()));
}

#[test]
fn fallback_friend_profile_current_is_none_when_both_display_name_and_bio_are_blank() {
    let result = fallback_friend_profile_current("usr_a", &relationship("   "), Some("  ".into()));

    assert!(result.is_none());
}

#[test]
fn fallback_friend_profile_current_is_none_when_bio_is_absent_and_display_name_blank() {
    let result = fallback_friend_profile_current("usr_a", &relationship(""), None);

    assert!(result.is_none());
}

#[test]
fn fallback_friend_profile_current_builds_from_display_name_only() {
    let result = fallback_friend_profile_current("usr_a", &relationship("Alice"), None)
        .expect("should build fallback profile");

    assert_eq!(result.user_id, "usr_a");
    assert_eq!(result.display_name, "Alice");
    assert_eq!(result.bio, "");
    assert_eq!(result.state, "");
    assert_eq!(result.location, "");
    assert_eq!(result.world_id, "");
    assert_eq!(result.status, "");
    assert_eq!(result.status_description, "");
    assert_eq!(result.platform, "");
}

#[test]
fn fallback_friend_profile_current_builds_from_bio_only() {
    let result =
        fallback_friend_profile_current("usr_a", &relationship(""), Some("hi there".into()))
            .expect("should build fallback profile");

    assert_eq!(result.display_name, "");
    assert_eq!(result.bio, "hi there");
}

#[test]
fn normalize_optional_text_trims_and_filters_blank() {
    assert_eq!(
        normalize_optional_text(Some("  usr_a  ".into())),
        Some("usr_a".into())
    );
    assert_eq!(normalize_optional_text(Some("   ".into())), None);
    assert_eq!(normalize_optional_text(None), None);
}

#[test]
fn friend_note_cursor_round_trips_without_display_name() {
    let row = FriendNoteRow {
        user_id: "usr_b".into(),
        display_name: "Bob".into(),
        memo: "memo".into(),
        edited_at: "2026-06-02T00:00:00Z".into(),
    };

    let cursor = friend_note_cursor(&row);

    assert_eq!(cursor, "2026-06-02T00:00:00Z|usr_b");
    assert_eq!(
        parse_friend_note_cursor(&cursor).unwrap(),
        ("2026-06-02T00:00:00Z".into(), "usr_b".into())
    );
}
