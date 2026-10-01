use std::collections::{HashMap, HashSet};

use serde_json::Value;
use vrcx_0_core::friends::StateBucket;

use super::super::{object_field, object_field_string, string_array_field, unique_push};

pub(super) struct CurrentUserSnapshotView {
    pub(super) user_id: String,
    pub(super) state_by_id: HashMap<String, StateBucket>,
    pub(super) state_order_ids: Vec<String>,
    pub(super) has_friend_list: bool,
}

impl CurrentUserSnapshotView {
    pub(super) fn from_raw(snapshot: &Value) -> Self {
        let mut state_by_id = HashMap::new();
        let mut state_order_ids = Vec::new();
        let mut seen = HashSet::new();
        for (key, bucket) in [
            ("friends", StateBucket::Offline),
            ("offlineFriends", StateBucket::Offline),
            ("activeFriends", StateBucket::Active),
            ("onlineFriends", StateBucket::Online),
        ] {
            for user_id in string_array_field(snapshot, key) {
                if user_id.is_empty() {
                    continue;
                }
                unique_push(&mut state_order_ids, &mut seen, user_id.clone());
                state_by_id.insert(user_id, bucket);
            }
        }
        Self {
            user_id: object_field_string(snapshot, &["id"]),
            state_by_id,
            state_order_ids,
            has_friend_list: object_field(snapshot, "friends").is_some_and(Value::is_array),
        }
    }
}
