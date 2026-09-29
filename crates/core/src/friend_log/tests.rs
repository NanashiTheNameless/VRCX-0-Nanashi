use super::{plan_friend_log_upsert, FriendLogCurrent, FriendLogHistoryPlan, FriendLogUpsertInput};

fn upsert<'a>(display_name: &'a str, trust_level: &'a str) -> FriendLogUpsertInput<'a> {
    FriendLogUpsertInput {
        target_user_id: " usr_friend ",
        display_name,
        trust_level,
        friend_number: 0,
        force_history: false,
    }
}

fn current<'a>(display_name: &'a str, trust_level: &'a str) -> FriendLogCurrent<'a> {
    FriendLogCurrent {
        display_name,
        trust_level,
        friend_number: 7,
    }
}

fn history(
    entry_type: &'static str,
    previous_display_name: &str,
    previous_trust_level: &str,
) -> FriendLogHistoryPlan {
    FriendLogHistoryPlan {
        entry_type,
        previous_display_name: previous_display_name.into(),
        previous_trust_level: previous_trust_level.into(),
    }
}

#[test]
fn a_new_friend_gets_a_friend_row_with_visitor_and_unknown_defaults() {
    let plan = plan_friend_log_upsert(upsert("", ""), None, || Ok::<i64, ()>(12))
        .unwrap()
        .unwrap();

    assert_eq!(plan.user_id, "usr_friend");
    assert_eq!(plan.display_name, "Unknown");
    assert_eq!(plan.trust_level, "Visitor");
    assert_eq!(plan.friend_number, 12);
    assert_eq!(plan.history, vec![history("Friend", "", "")]);
}

#[test]
fn a_rename_and_trust_change_record_their_previous_values() {
    let plan = plan_friend_log_upsert(
        upsert("New Name", "Trusted User"),
        Some(current("Old Name", "Known User")),
        || Ok::<i64, ()>(99),
    )
    .unwrap()
    .unwrap();

    assert_eq!(plan.friend_number, 7);
    assert_eq!(
        plan.history,
        vec![
            history("DisplayName", "Old Name", ""),
            history("TrustLevel", "", "Known User"),
        ]
    );
}

#[test]
fn unknown_names_and_blank_trust_keep_the_existing_values() {
    let plan = plan_friend_log_upsert(
        upsert("Unknown", ""),
        Some(current("Kept Name", "")),
        || Ok::<i64, ()>(99),
    )
    .unwrap()
    .unwrap();

    assert_eq!(plan.display_name, "Kept Name");
    assert_eq!(plan.trust_level, "Visitor");
    assert!(plan.history.is_empty());
}

#[test]
fn a_name_resolved_from_unknown_is_not_a_rename() {
    let plan = plan_friend_log_upsert(
        upsert("Resolved", "Visitor"),
        Some(current("Unknown", "Visitor")),
        || Ok::<i64, ()>(99),
    )
    .unwrap()
    .unwrap();

    assert_eq!(plan.display_name, "Resolved");
    assert!(plan.history.is_empty());
}

#[test]
fn forced_history_appends_a_friend_row_for_an_existing_friend() {
    let mut entry = upsert("Name", "Visitor");
    entry.force_history = true;

    let plan = plan_friend_log_upsert(entry, Some(current("Name", "Visitor")), || {
        Ok::<i64, ()>(99)
    })
    .unwrap()
    .unwrap();

    assert_eq!(plan.history, vec![history("Friend", "", "")]);
}

#[test]
fn a_blank_target_has_no_plan() {
    let mut entry = upsert("Name", "Visitor");
    entry.target_user_id = "  ";

    assert!(plan_friend_log_upsert(entry, None, || Ok::<i64, ()>(1))
        .unwrap()
        .is_none());
}
