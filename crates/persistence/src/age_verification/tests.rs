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
            "vrcx-0-age-verification-{name}-{}-{nonce}",
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

fn owner() -> OwnerId {
    OwnerId::new("usr_owner")
}

fn user(value: Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap()
}

fn ids(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

#[test]
fn stored_facts_round_trip_for_requested_users_only() {
    let dir = TestDir::new("round-trip");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
    observe(
        &db,
        &owner(),
        "https://api.vrchat.cloud/api/1",
        &[
            user(json!({"id": "usr_adult", "ageVerificationStatus": "18+"})),
            user(
                json!({"id": "usr_hidden", "ageVerified": true, "ageVerificationStatus": "hidden"}),
            ),
            user(json!({"id": "usr_none", "displayName": "No age data"})),
            user(json!({"id": "usr_other", "ageVerified": false})),
        ],
        100,
    )
    .unwrap();

    let facts = list(
        &db,
        &owner(),
        "https://api.vrchat.cloud/api/1",
        &ids(&["usr_adult", "usr_hidden", "usr_none"]),
    )
    .unwrap();
    let mut facts: Vec<Value> = facts.into_iter().map(Value::Object).collect();
    facts.sort_by_key(|fact| fact["id"].as_str().unwrap_or_default().to_string());
    assert_eq!(
        facts,
        vec![
            json!({"id": "usr_adult", "ageVerificationStatus": "18+", "observedAt": 100}),
            json!({"id": "usr_hidden", "ageVerified": true, "ageVerificationStatus": "hidden", "observedAt": 100}),
        ]
    );
}

#[test]
fn unchanged_values_keep_their_first_observation_time() {
    let dir = TestDir::new("unchanged");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
    let endpoint = "default";
    let adult = user(json!({"id": "usr_a", "ageVerificationStatus": "18+"}));
    observe(&db, &owner(), endpoint, std::slice::from_ref(&adult), 100).unwrap();
    observe(&db, &owner(), endpoint, &[adult], 200).unwrap();
    let facts = list(&db, &owner(), endpoint, &ids(&["usr_a"])).unwrap();
    assert_eq!(facts[0]["observedAt"], json!(100));

    observe(
        &db,
        &owner(),
        endpoint,
        &[user(
            json!({"id": "usr_a", "ageVerificationStatus": "hidden", "ageVerified": true}),
        )],
        300,
    )
    .unwrap();
    let facts = list(&db, &owner(), endpoint, &ids(&["usr_a"])).unwrap();
    assert_eq!(facts[0]["ageVerificationStatus"], json!("hidden"));
    assert_eq!(facts[0]["ageVerified"], json!(true));
    assert_eq!(facts[0]["observedAt"], json!(300));
}

#[test]
fn facts_are_scoped_to_account_and_endpoint() {
    let dir = TestDir::new("scope");
    let db = DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap();
    observe(
        &db,
        &owner(),
        "default",
        &[user(json!({"id": "usr_a", "ageVerificationStatus": "18+"}))],
        100,
    )
    .unwrap();
    assert!(list(&db, &owner(), "other", &ids(&["usr_a"]))
        .unwrap()
        .is_empty());
    assert!(list(
        &db,
        &OwnerId::new("usr_someone_else"),
        "default",
        &ids(&["usr_a"])
    )
    .unwrap()
    .is_empty());
}
