use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use serde_json::{Map, Value};
use vrcx_0_core::json::RawJsonObject;
use vrcx_0_core::user_facts::{
    merge_user_fact_owned, normalize_user_id, user_fact_key, UserFact, UserFactMergeOptions,
};

/// Most entries the saved-details record keeps. They only spare unchanged
/// database writes, so when one fills up it is cleared and the next write per
/// friend just compares against the database again.
const MAX_SAVED_ENTRIES: usize = 8_192;

/// Records `value` for `key` and reports whether it differs from the value
/// recorded before.
fn note_saved<V: PartialEq>(saved: &mut HashMap<String, V>, key: String, value: V) -> bool {
    if saved.get(&key) == Some(&value) {
        return false;
    }
    if saved.len() >= MAX_SAVED_ENTRIES && !saved.contains_key(&key) {
        saved.clear();
    }
    saved.insert(key, value);
    true
}

pub(crate) struct UserFactStore {
    users: Mutex<HashMap<String, UserFact>>,
    saved_profile_details: Mutex<HashMap<String, String>>,
}

pub(crate) struct UserFactOutput {
    pub user: RawJsonObject,
}

impl UserFactStore {
    pub(crate) fn new() -> Self {
        Self {
            users: Mutex::new(HashMap::new()),
            saved_profile_details: Mutex::new(HashMap::new()),
        }
    }

    /// Records `details` as the stored profile details for `key` and reports
    /// whether they differ from what was stored before.
    pub(crate) fn note_saved_profile_details(&self, key: String, details: String) -> bool {
        let mut saved = self
            .saved_profile_details
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        note_saved(&mut saved, key, details)
    }

    pub(crate) fn forget_saved_profile_details(&self, keys: &[String]) {
        let mut saved = self
            .saved_profile_details
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for key in keys {
            saved.remove(key);
        }
    }

    fn lock_users(&self) -> MutexGuard<'_, HashMap<String, UserFact>> {
        self.users
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn clear(&self) {
        self.lock_users().clear();
    }

    pub(crate) fn remove_users(&self, endpoint: &str, user_ids: &[String]) {
        let endpoint = Value::String(endpoint.to_string());
        let mut users = self.lock_users();
        for user_id in user_ids {
            let key = user_fact_key(&endpoint, &Value::String(user_id.clone()));
            users.remove(&key);
        }
    }

    fn extract_user_id(value: &Value) -> String {
        normalize_user_id(
            value
                .get("id")
                .or_else(|| value.get("userId"))
                .or_else(|| value.get("user_id"))
                .unwrap_or(&Value::Null),
        )
    }

    pub(crate) fn record_user(
        &self,
        value: &Value,
        options: &UserFactMergeOptions,
    ) -> Option<UserFactOutput> {
        let user_id = Self::extract_user_id(value);
        if user_id.is_empty() {
            return None;
        }
        let key = user_fact_key(
            &Value::String(options.endpoint.clone()),
            &Value::String(user_id),
        );
        if key.is_empty() {
            return None;
        }

        let mut users = self.lock_users();
        let result = merge_user_fact_owned(users.remove(&key), value, options);
        let pinned = is_pinned(&result.fact);
        let output = result.changed.then(|| UserFactOutput {
            user: result.fact.to_object().into(),
        });
        if pinned {
            users.insert(key, result.fact);
        }
        output
    }

    pub(crate) fn get_user(&self, endpoint: &str, user_id: &str) -> Option<Map<String, Value>> {
        let key = user_fact_key(
            &Value::String(endpoint.to_string()),
            &Value::String(user_id.to_string()),
        );
        if key.is_empty() {
            return None;
        }
        self.lock_users().get(&key).map(UserFact::to_object)
    }

    pub(crate) fn get_users(
        &self,
        endpoint: &str,
        user_ids: &[String],
    ) -> Vec<(String, Map<String, Value>)> {
        let users_by_key = self.lock_users();
        let mut users = Vec::new();
        for user_id in user_ids {
            let key = user_fact_key(
                &Value::String(endpoint.to_string()),
                &Value::String(user_id.to_string()),
            );
            if key.is_empty() {
                continue;
            }
            let Some(fact) = users_by_key.get(&key) else {
                continue;
            };
            let object = fact.to_object();
            users.push((user_id.clone(), object));
        }
        users
    }
}

fn is_pinned(fact: &UserFact) -> bool {
    fact.fields.get("isFriend").and_then(Value::as_bool) == Some(true)
        || fact.fields.get("isCurrentUser").and_then(Value::as_bool) == Some(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn saved_value_records_stay_bounded() {
        let mut saved = HashMap::new();
        for index in 0..MAX_SAVED_ENTRIES {
            assert!(note_saved(&mut saved, index.to_string(), 0));
        }
        assert_eq!(saved.len(), MAX_SAVED_ENTRIES);
        assert!(!note_saved(&mut saved, "0".into(), 0));
        assert!(note_saved(&mut saved, "0".into(), 1));
        assert_eq!(saved.len(), MAX_SAVED_ENTRIES);
        assert!(note_saved(&mut saved, "new".into(), 0));
        assert_eq!(saved.len(), 1);
    }

    #[test]
    fn saved_profile_details_only_report_real_changes() {
        let store = UserFactStore::new();
        assert!(store.note_saved_profile_details("a".into(), "{}".into()));
        assert!(!store.note_saved_profile_details("a".into(), "{}".into()));
        assert!(store.note_saved_profile_details("a".into(), "{\"x\":1}".into()));
        store.forget_saved_profile_details(&["a".into()]);
        assert!(store.note_saved_profile_details("a".into(), "{\"x\":1}".into()));
    }

    fn opts(is_friend: bool) -> UserFactMergeOptions {
        UserFactMergeOptions {
            endpoint: "https://api.example.test".into(),
            source: if is_friend {
                "realtime".into()
            } else {
                "profile".into()
            },
            received_at: 1781568000,
            is_friend,
            ..Default::default()
        }
    }

    #[test]
    fn non_friend_record_returns_output_without_being_retained() {
        let cache = UserFactStore::new();
        let out = cache.record_user(
            &json!({ "id": "usr_1", "displayName": "Alice" }),
            &opts(false),
        );
        assert!(out.is_some());
        assert_eq!(
            out.unwrap().user.get("displayName").and_then(Value::as_str),
            Some("Alice")
        );
        assert!(cache
            .get_user("https://api.example.test", "usr_1")
            .is_none());
    }

    #[test]
    fn unchanged_friend_record_returns_none() {
        let cache = UserFactStore::new();
        cache.record_user(&json!({ "id": "usr_1", "state": "online" }), &opts(true));
        let again = cache.record_user(&json!({ "id": "usr_1", "state": "online" }), &opts(true));
        assert!(again.is_none());
    }

    #[test]
    fn friends_are_retained_while_non_friends_are_not() {
        let cache = UserFactStore::new();
        cache.record_user(
            &json!({ "id": "usr_friend", "displayName": "F" }),
            &opts(true),
        );
        cache.record_user(&json!({ "id": "usr_x", "displayName": "X" }), &opts(false));
        assert!(cache
            .get_user("https://api.example.test", "usr_friend")
            .is_some());
        assert!(cache
            .get_user("https://api.example.test", "usr_x")
            .is_none());
    }

    #[test]
    fn current_user_is_retained() {
        let cache = UserFactStore::new();
        cache.record_user(
            &json!({ "id": "usr_self", "displayName": "Self" }),
            &UserFactMergeOptions {
                is_current_user: true,
                ..opts(false)
            },
        );
        assert!(cache
            .get_user("https://api.example.test", "usr_self")
            .is_some());
    }

    #[test]
    fn clear_drops_retained_users() {
        let cache = UserFactStore::new();
        cache.record_user(
            &json!({ "id": "usr_friend", "displayName": "F" }),
            &opts(true),
        );
        cache.clear();
        assert!(cache
            .get_user("https://api.example.test", "usr_friend")
            .is_none());
    }
}
