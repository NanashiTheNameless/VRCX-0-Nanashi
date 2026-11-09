use super::*;
use serde_json::json;

struct TestDir(std::path::PathBuf);

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn database() -> (TestDir, DatabaseService) {
    let path = std::env::temp_dir().join(format!(
        "nanashi-profile-history-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&path).unwrap();
    let dir = TestDir(path);
    let db = DatabaseService::new(&dir.0.join("history.sqlite3")).unwrap();
    (dir, db)
}

fn owner() -> OwnerId {
    OwnerId::new("usr_owner")
}

fn record(db: &DatabaseService, user: Value, at: i64) {
    observe(
        db,
        &owner(),
        &[user.as_object().unwrap().clone().into()],
        at,
    )
    .unwrap();
}

fn rows(db: &DatabaseService, field: Option<ProfileHistoryField>) -> Vec<ProfileHistoryEntry> {
    query(
        db,
        &owner(),
        &ProfileHistoryQuery {
            user_id: "usr_friend".into(),
            field,
            before_at: None,
            before_id: None,
            before_field: None,
        },
    )
    .unwrap()
}

#[test]
fn recording_defaults_off_and_sync_defaults_on_for_each_field() {
    let (_dir, db) = database();
    let settings = settings_get(&db).unwrap();
    for field in ProfileHistoryField::ALL {
        assert!(!settings.choice(field).recording);
        assert!(settings.choice(field).sync);
    }
    record(&db, json!({"id":"usr_friend","bio":"before"}), 1);
    record(&db, json!({"id":"usr_friend","bio":"after"}), 2);
    assert!(rows(&db, None).is_empty());
}

fn snapshot(db: &DatabaseService, user: Value, at: i64) {
    observe_snapshot(
        db,
        &owner(),
        &[user.as_object().unwrap().clone().into()],
        at,
    )
    .unwrap();
}

#[test]
fn manual_opens_capture_first_enabled_values_and_skip_previously_saved_versions() {
    let (_dir, db) = database();
    let first =
        json!({"id":"usr_friend","bio":"First bio","pronouns":"they/them","status":"active"});
    snapshot(&db, first.clone(), 1);
    assert!(rows(&db, None).is_empty());
    let mut settings = ProfileHistorySettings::default();
    settings.bio.recording = true;
    settings_set(&db, &settings).unwrap();
    // The native GET may establish the baseline before the manual-open marker arrives.
    record(&db, first.clone(), 2);
    assert!(rows(&db, None).is_empty());
    snapshot(&db, first.clone(), 3);
    let history = rows(&db, None);
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].field, ProfileHistoryField::Bio);
    assert_eq!(history[0].previous_value, "First bio");
    assert_eq!(history[0].value, "First bio");
    assert_eq!(history[0].created_at, 3);
    snapshot(&db, first.clone(), 4);
    snapshot(&db, json!({"id":"usr_friend","bio":"Second bio"}), 5);
    snapshot(&db, first, 6);
    let history = rows(&db, None);
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].previous_value, "Second bio");
    assert_eq!(history[0].value, "Second bio");
    assert_eq!(history[1].created_at, 3);
    // A manual snapshot does not prevent later automatic changes from being recorded.
    record(&db, json!({"id":"usr_friend","bio":"Third bio"}), 7);
    assert_eq!(rows(&db, None)[0].previous_value, "First bio");
    assert_eq!(rows(&db, None)[0].value, "Third bio");
}

#[test]
fn manual_snapshots_reuse_changed_versions_and_preserve_missing_and_cleared_fields() {
    let (_dir, db) = database();
    let mut settings = ProfileHistorySettings::default();
    settings.status.recording = true;
    settings.bio.recording = true;
    settings.pronouns.recording = true;
    settings_set(&db, &settings).unwrap();
    record(&db, json!({"id":"usr_friend","bio":"A"}), 1);
    record(&db, json!({"id":"usr_friend","bio":"B"}), 2);
    snapshot(&db, json!({"id":"usr_friend","bio":"B"}), 3);
    snapshot(&db, json!({"id":"usr_friend","bio":"A"}), 4);
    assert_eq!(rows(&db, None).len(), 1);
    snapshot(
        &db,
        json!({"id":"usr_friend","statusDescription":"","pronouns":null}),
        5,
    );
    let history = rows(&db, None);
    assert_eq!(history.len(), 3);
    assert!(history
        .iter()
        .filter(|row| row.field != ProfileHistoryField::Bio)
        .all(|row| row.value.is_empty() && row.previous_value.is_empty()));
    // Missing fields do not synthesize a blank snapshot or overwrite a known baseline.
    snapshot(&db, json!({"id":"usr_friend","displayName":"Friend"}), 6);
    assert_eq!(rows(&db, None).len(), 3);
    assert!(!history.iter().any(|row| row.property == "status"));
}

#[test]
fn collector_copy_revision_changes_only_when_a_choice_changes() {
    let (_dir, db) = database();
    let (mut settings, revision) = settings_snapshot(&db).unwrap();
    assert_eq!(revision, 0);
    settings_set(&db, &settings).unwrap();
    assert_eq!(settings_snapshot(&db).unwrap().1, 0);
    settings.pronouns.recording = true;
    settings_set(&db, &settings).unwrap();
    assert_eq!(settings_snapshot(&db).unwrap(), (settings.clone(), 1));
    settings_set(&db, &settings).unwrap();
    assert_eq!(settings_snapshot(&db).unwrap().1, 1);
    settings.bio.sync = false;
    settings_set(&db, &settings).unwrap();
    assert_eq!(settings_snapshot(&db).unwrap(), (settings, 2));
}

#[test]
fn existing_feed_and_self_profile_history_use_the_same_recording_choices() {
    use vrcx_0_contracts::feed_live::FeedLiveEntry;
    use vrcx_0_contracts::realtime::{
        RealtimePersistenceBatch, SelfProfileField, SelfProfileObservation,
    };
    let (_dir, db) = database();
    let batch = |at| RealtimePersistenceBatch {
        feed_entries: vec![
            FeedLiveEntry::Status {
                created_at: at,
                user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                status: "busy".into(),
                status_description: "Away".into(),
                previous_status: "active".into(),
                previous_status_description: "Here".into(),
                owner_user_id: String::new(),
            },
            FeedLiveEntry::Bio {
                created_at: at,
                user_id: "usr_friend".into(),
                display_name: "Friend".into(),
                bio: "After".into(),
                previous_bio: "Before".into(),
                owner_user_id: String::new(),
            },
        ],
        self_profile_observations: vec![
            SelfProfileObservation {
                observed_at: at,
                field: SelfProfileField::Status,
                value: "busy".into(),
            },
            SelfProfileObservation {
                observed_at: at,
                field: SelfProfileField::Bio,
                value: "After".into(),
            },
        ],
        ..Default::default()
    };
    let first = crate::realtime::write_realtime_batch(&db, &owner(), &batch(1)).unwrap();
    assert_eq!(first.affected_count, 0);
    let mut settings = ProfileHistorySettings::default();
    settings.bio.recording = true;
    settings_set(&db, &settings).unwrap();
    let bios = crate::realtime::write_realtime_batch(&db, &owner(), &batch(2)).unwrap();
    assert_eq!(bios.affected_count, 2);
    settings.bio.recording = false;
    settings.status.recording = true;
    settings_set(&db, &settings).unwrap();
    let statuses = crate::realtime::write_realtime_batch(&db, &owner(), &batch(3)).unwrap();
    assert_eq!(statuses.affected_count, 2);
    let prefix = normalize_user_table_prefix(owner().as_str()).unwrap();
    for suffix in ["feed_bio", "feed_status"] {
        assert_eq!(
            db.execute(
                &format!("SELECT COUNT(*) FROM {prefix}_{suffix}"),
                &Default::default()
            )
            .unwrap()[0][0],
            json!(1)
        );
    }
}

#[test]
fn fields_are_independent_and_only_changed_observed_values_are_recorded() {
    let (_dir, db) = database();
    let mut settings = ProfileHistorySettings::default();
    settings.bio.recording = true;
    settings_set(&db, &settings).unwrap();
    record(
        &db,
        json!({"id":"usr_friend","bio":"before","pronouns":"they/them","status":"active"}),
        -100,
    );
    record(
        &db,
        json!({"id":"usr_friend","bio":"after","pronouns":"she/her","status":"busy"}),
        -90,
    );
    record(&db, json!({"id":"usr_friend","bio":"after"}), -90);
    record(&db, json!({"id":"usr_friend","displayName":"Friend"}), -80);
    record(&db, json!({"id":"usr_friend","bio":null}), -70);
    let history = rows(&db, None);
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].field, ProfileHistoryField::Bio);
    assert_eq!(history[0].previous_value, "after");
    assert_eq!(history[0].value, "");
    assert_eq!(history[0].created_at, -70);
    assert_eq!(history[1].previous_value, "before");
    assert_eq!(history[1].value, "after");
    assert!(query(
        &db,
        &OwnerId::new("usr_other"),
        &ProfileHistoryQuery {
            user_id: "usr_friend".into(),
            field: None,
            before_at: None,
            before_id: None,
            before_field: None
        }
    )
    .unwrap()
    .is_empty());
}

#[test]
fn re_enabling_recording_starts_a_new_baseline_and_keeps_history() {
    let (_dir, db) = database();
    let mut settings = ProfileHistorySettings::default();
    settings.status.recording = true;
    settings_set(&db, &settings).unwrap();
    record(&db, json!({"id":"usr_friend","statusDescription":"A"}), 10);
    record(&db, json!({"id":"usr_friend","statusDescription":"B"}), 11);
    settings.status.recording = false;
    settings_set(&db, &settings).unwrap();
    record(&db, json!({"id":"usr_friend","statusDescription":"C"}), 12);
    settings.status.recording = true;
    settings_set(&db, &settings).unwrap();
    record(&db, json!({"id":"usr_friend","statusDescription":"D"}), 13);
    record(&db, json!({"id":"usr_friend","statusDescription":""}), 14);
    let history = rows(&db, None);
    assert_eq!(history.len(), 2);
    assert_eq!(history[0].previous_value, "D");
    assert_eq!(history[0].value, "");
    assert_eq!(history[1].previous_value, "A");
}

#[test]
fn pagination_preserves_same_second_changes_across_fields() {
    let (_dir, db) = database();
    let mut settings = ProfileHistorySettings::default();
    settings.status.recording = true;
    settings.bio.recording = true;
    settings.pronouns.recording = true;
    settings_set(&db, &settings).unwrap();
    record(
        &db,
        json!({"id":"usr_friend","status":"active","bio":"A","pronouns":"they/them"}),
        1,
    );
    record(
        &db,
        json!({"id":"usr_friend","status":"busy","bio":"B","pronouns":"she/her"}),
        2,
    );
    record(&db, json!({"id":"usr_friend","bio":"C"}), 2);
    let history = rows(&db, None);
    assert_eq!(history.len(), 4);
    let cursor = &history[1];
    let next = query(
        &db,
        &owner(),
        &ProfileHistoryQuery {
            user_id: "usr_friend".into(),
            field: None,
            before_at: Some(cursor.created_at),
            before_id: Some(cursor.id),
            before_field: Some(cursor.field),
        },
    )
    .unwrap();
    assert_eq!(next.len(), 2);
    assert_eq!(next[0].value, history[2].value);
    assert_eq!(next[1].value, history[3].value);
    assert_eq!(rows(&db, Some(ProfileHistoryField::Bio)).len(), 2);
}

#[test]
fn list_and_flag_values_are_stored_as_stable_text() {
    assert_eq!(
        history_value(
            "tags",
            &json!(["system_trust_known", "language_eng", "language_eng"])
        ),
        Some("language_eng\nsystem_trust_known".into())
    );
    assert_eq!(
        history_value(
            "bioLinks",
            &json!(["https://b.example", "https://a.example"])
        ),
        Some("https://b.example\nhttps://a.example".into())
    );
    assert_eq!(
        history_value(
            "badges",
            &json!([
                {"badgeId": "bdg_2", "badgeName": "Supporter", "updatedAt": "2026-01-02"},
                {"badgeId": "bdg_1", "badgeName": "Early Adopter", "assignedAt": "2026-01-01"}
            ])
        ),
        Some("Early Adopter\nSupporter".into())
    );
    assert_eq!(
        history_value("ageVerified", &json!(true)),
        Some("true".into())
    );
    assert_eq!(
        history_value("displayName", &json!(null)),
        Some(String::new())
    );
    assert_eq!(history_value("bannerUrl", &json!({"nested": true})), None);
}

#[test]
fn added_fields_record_only_real_changes() {
    let (_dir, db) = database();
    let mut settings = settings_get(&db).unwrap();
    for field in [
        ProfileHistoryField::Badges,
        ProfileHistoryField::Tags,
        ProfileHistoryField::DisplayName,
        ProfileHistoryField::AgeVerification,
    ] {
        settings.choice_mut(field).recording = true;
    }
    settings_set(&db, &settings).unwrap();
    let profile = |badges: Value, tags: Value, name: &str, verified: bool| {
        json!({
            "id": "usr_friend",
            "badges": badges,
            "tags": tags,
            "displayName": name,
            "ageVerified": verified
        })
    };
    let badge = |name: &str, updated: &str| json!({"badgeName": name, "updatedAt": updated});
    record(
        &db,
        profile(
            json!([badge("A", "1"), badge("B", "1")]),
            json!(["t1", "t2"]),
            "Name",
            false,
        ),
        1,
    );
    // Reordered lists, newer badge timestamps and an unchanged name are not changes.
    record(
        &db,
        profile(
            json!([badge("B", "2"), badge("A", "2")]),
            json!(["t2", "t1"]),
            "Name",
            false,
        ),
        2,
    );
    assert!(rows(&db, None).is_empty());

    record(
        &db,
        profile(
            json!([badge("A", "3"), badge("B", "3"), badge("C", "3")]),
            json!(["t2", "t1"]),
            "New Name",
            true,
        ),
        3,
    );
    let mut changes: Vec<(ProfileHistoryField, String, String, String)> = rows(&db, None)
        .into_iter()
        .map(|entry| {
            (
                entry.field,
                entry.property,
                entry.previous_value,
                entry.value,
            )
        })
        .collect();
    changes.sort_by(|a, b| a.1.cmp(&b.1));
    assert_eq!(
        changes,
        vec![
            (
                ProfileHistoryField::AgeVerification,
                "ageVerified".into(),
                "false".into(),
                "true".into()
            ),
            (
                ProfileHistoryField::Badges,
                "badges".into(),
                "A\nB".into(),
                "A\nB\nC".into()
            ),
            (
                ProfileHistoryField::DisplayName,
                "displayName".into(),
                "Name".into(),
                "New Name".into()
            ),
        ]
    );

    // A profile without these properties leaves the remembered values alone.
    record(&db, json!({"id": "usr_friend"}), 4);
    assert_eq!(rows(&db, None).len(), 3);
}
