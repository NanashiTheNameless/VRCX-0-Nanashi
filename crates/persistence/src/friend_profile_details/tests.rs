use std::path::PathBuf;

use serde_json::{json, Map, Value};

use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-friend-profile-details-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

const ENDPOINT: &str = "https://api.vrchat.cloud/api/1/";

fn owner() -> OwnerId {
    OwnerId::new("usr_owner")
}

fn user(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

fn observed_at(db: &DatabaseService) -> i64 {
    let prefix = normalize_user_table_prefix(owner().as_str()).unwrap();
    db.execute(
        &format!("SELECT observed_at FROM {prefix}_friend_profile_details"),
        &Default::default(),
    )
    .unwrap()[0][0]
        .as_i64()
        .unwrap()
}

#[test]
fn stores_full_profile_details_and_ignores_friend_list_entries() {
    let dir = TestDir::new("store");
    let db = DatabaseService::new(&dir.path.join("db.sqlite3")).unwrap();
    let friend_list_entry = user(json!({"id": "usr_a", "displayName": "A", "tags": []}));
    let profile = user(json!({
        "id": "usr_b",
        "displayName": "B",
        "date_joined": "2020-01-01",
        "pronouns": "they/them",
        "badges": [{"badgeName": "Supporter"}],
        "location": "wrld_x:1"
    }));
    observe(&db, &owner(), ENDPOINT, [&friend_list_entry, &profile], 10).unwrap();

    assert_eq!(get(&db, &owner(), ENDPOINT, "usr_a").unwrap(), None);
    assert_eq!(
        get(&db, &owner(), ENDPOINT, "usr_b").unwrap(),
        Some(user(json!({
            "id": "usr_b",
            "date_joined": "2020-01-01",
            "pronouns": "they/them",
            "badges": [{"badgeName": "Supporter"}]
        })))
    );
    assert_eq!(
        get(&db, &owner(), "https://other.example/api/1/", "usr_b").unwrap(),
        None
    );
}

#[test]
fn rewrites_only_when_details_change_and_keeps_missing_properties() {
    let dir = TestDir::new("changes");
    let db = DatabaseService::new(&dir.path.join("db.sqlite3")).unwrap();
    let first = user(json!({"id": "usr_b", "date_joined": "2020-01-01", "pronouns": "she/her"}));
    observe(&db, &owner(), ENDPOINT, [&first], 10).unwrap();

    observe(&db, &owner(), ENDPOINT, [&first], 20).unwrap();
    assert_eq!(observed_at(&db), 10);

    let without_pronouns = user(json!({"id": "usr_b", "date_joined": "2020-01-01"}));
    observe(&db, &owner(), ENDPOINT, [&without_pronouns], 30).unwrap();
    assert_eq!(observed_at(&db), 10);

    let changed =
        user(json!({"id": "usr_b", "date_joined": "2020-01-01", "pronouns": "they/them"}));
    observe(&db, &owner(), ENDPOINT, [&changed], 40).unwrap();
    assert_eq!(observed_at(&db), 40);
    assert_eq!(
        get(&db, &owner(), ENDPOINT, "usr_b").unwrap().unwrap()["pronouns"],
        json!("they/them")
    );
}

#[test]
fn legacy_age_verification_rows_move_into_details_once() {
    let dir = TestDir::new("legacy-age");
    let db = DatabaseService::new(&dir.path.join("db.sqlite3")).unwrap();
    let prefix = normalize_user_table_prefix(owner().as_str()).unwrap();
    for sql in [
        format!("CREATE TABLE {prefix}_age_verification (endpoint TEXT NOT NULL, user_id TEXT NOT NULL, age_verified INTEGER NOT NULL DEFAULT -1, status TEXT NOT NULL DEFAULT '', observed_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (endpoint, user_id))"),
        format!("INSERT INTO {prefix}_age_verification VALUES ('{ENDPOINT}', 'usr_old', 1, 'hidden', 5), ('{ENDPOINT}', 'usr_unknown', -1, '', 6)"),
    ] {
        db.execute_non_query(&sql, &Default::default()).unwrap();
    }

    let friends = vec!["usr_old".to_string(), "usr_unknown".to_string()];
    let restored = list(&db, &owner(), ENDPOINT, &friends).unwrap();
    assert_eq!(
        restored,
        vec![user(json!({
            "id": "usr_old",
            "ageVerified": true,
            "ageVerificationStatus": "hidden",
            "observedAt": 5
        }))]
    );
    assert!(db
        .execute(
            &format!("SELECT 1 FROM sqlite_master WHERE name = '{prefix}_age_verification'"),
            &Default::default(),
        )
        .unwrap()
        .is_empty());
}

#[test]
fn friend_list_style_entries_with_only_age_fields_are_kept() {
    let dir = TestDir::new("age-only");
    let db = DatabaseService::new(&dir.path.join("db.sqlite3")).unwrap();
    let entry = user(json!({"id": "usr_a", "displayName": "A", "ageVerificationStatus": "18+"}));
    observe(&db, &owner(), ENDPOINT, [&entry], 7).unwrap();
    assert_eq!(
        get(&db, &owner(), ENDPOINT, "usr_a").unwrap(),
        Some(user(json!({"id": "usr_a", "ageVerificationStatus": "18+"})))
    );
}
