use crate::derived_keys;
use std::collections::HashMap;

use compact_str::CompactString;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};

use crate::text::first_non_empty;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StateBucket {
    Online,
    Active,
    Offline,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OptionalCompactString(Option<Option<CompactString>>);

impl OptionalCompactString {
    pub fn null() -> Self {
        Self(Some(None))
    }

    pub fn is_missing(&self) -> bool {
        self.0.is_none()
    }

    pub fn is_null(&self) -> bool {
        matches!(self.0, Some(None))
    }

    pub fn as_str(&self) -> Option<&str> {
        self.0.as_ref().and_then(Option::as_deref)
    }
}

impl From<&str> for OptionalCompactString {
    fn from(value: &str) -> Self {
        Self(Some(Some(value.into())))
    }
}

impl Serialize for OptionalCompactString {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match &self.0 {
            Some(Some(value)) => serializer.serialize_str(value),
            None | Some(None) => serializer.serialize_none(),
        }
    }
}

impl<'de> Deserialize<'de> for OptionalCompactString {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Option::<CompactString>::deserialize(deserializer).map(|value| Self(Some(value)))
    }
}

impl StateBucket {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Online => "online",
            Self::Active => "active",
            Self::Offline => "offline",
        }
    }

    pub fn from_exact(value: &str) -> Option<Self> {
        match value {
            "online" => Some(Self::Online),
            "active" => Some(Self::Active),
            "offline" => Some(Self::Offline),
            _ => None,
        }
    }

    pub fn normalize(value: &str) -> Option<Self> {
        Self::from_exact(value.trim().to_ascii_lowercase().as_str())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FriendRecord {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    #[specta(type = String)]
    pub display_name: CompactString,
    #[serde(default)]
    pub username: String,
    #[serde(default, alias = "last_platform")]
    #[specta(type = String)]
    pub last_platform: CompactString,
    #[serde(default)]
    #[specta(type = String)]
    pub status: CompactString,
    #[serde(default)]
    #[specta(type = String)]
    pub status_description: CompactString,
    #[serde(default)]
    pub icon_url: String,
    #[serde(
        rename = "date_joined",
        skip_serializing_if = "OptionalCompactString::is_missing",
        default
    )]
    #[specta(optional, type = Option<String>)]
    pub date_joined: OptionalCompactString,
    #[serde(
        rename = "last_activity",
        skip_serializing_if = "OptionalCompactString::is_missing",
        default
    )]
    #[specta(optional, type = Option<String>)]
    pub last_activity: OptionalCompactString,
    #[serde(
        rename = "last_login",
        skip_serializing_if = "OptionalCompactString::is_missing",
        default
    )]
    #[specta(optional, type = Option<String>)]
    pub last_login: OptionalCompactString,
    #[serde(
        rename = "last_mobile",
        skip_serializing_if = "OptionalCompactString::is_missing",
        default
    )]
    #[specta(optional, type = Option<String>)]
    pub last_mobile: OptionalCompactString,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl FriendRecord {
    pub fn normalized(mut self, fallback_user_id: &str) -> Option<Self> {
        self.id = normalize_user_id(first_non_empty([self.id.as_str(), fallback_user_id]));
        if self.id.is_empty() {
            return None;
        }
        Some(self)
    }

    pub fn is_placeholder(&self) -> bool {
        self.extra
            .get(derived_keys::PROFILE_SOURCE)
            .and_then(Value::as_str)
            == Some("placeholder")
    }

    pub fn display_name_or_id(&self) -> String {
        first_non_empty([
            self.display_name.as_str(),
            self.username.as_str(),
            self.id.as_str(),
        ])
        .to_string()
    }
}

pub const FRIEND_PRESENCE_KEYS: &[&str] = &[
    "state",
    "location",
    "travelingToLocation",
    "worldId",
    "instanceId",
    "travelingToWorld",
    "travelingToInstance",
    "platform",
    "pendingOffline",
    "locationUpdatedAt",
    "travelingToTime",
    derived_keys::LOCATION_PROJECTION,
    derived_keys::TRAVELING_TO_LOCATION_PROJECTION,
    derived_keys::LOCATION_UPDATED_AT,
    derived_keys::LOCATION_TAG,
    derived_keys::PREVIOUS_LOCATION,
    derived_keys::PREVIOUS_LOCATION_UPDATED_AT,
    derived_keys::TRAVELING_TO_TIME,
];

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FriendBaselinePresence {
    pub state: CompactString,
    pub location: String,
    pub traveling_to_location: String,
    pub platform: CompactString,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(try_from = "Map<String, Value>")]
pub struct FriendBaselineEntry {
    pub record: FriendRecord,
    pub presence: FriendBaselinePresence,
}

impl TryFrom<Map<String, Value>> for FriendBaselineEntry {
    type Error = serde_json::Error;

    fn try_from(mut user: Map<String, Value>) -> Result<Self, Self::Error> {
        let presence = FRIEND_PRESENCE_KEYS
            .iter()
            .filter_map(|key| user.remove_entry(*key))
            .collect();
        Ok(Self {
            presence: serde_json::from_value(Value::Object(presence))?,
            record: serde_json::from_value(Value::Object(user))?,
        })
    }
}

impl FriendBaselineEntry {
    pub fn normalized(self, fallback_user_id: &str) -> Option<Self> {
        Some(Self {
            record: self.record.normalized(fallback_user_id)?,
            presence: self.presence,
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct FriendRosterBaseline {
    pub current_user_id: String,
    pub endpoint: String,
    pub websocket: String,
    pub friends_by_id: HashMap<String, FriendBaselineEntry>,
}

impl FriendRosterBaseline {
    pub fn normalized(mut self) -> Self {
        self.current_user_id = normalize_user_id(&self.current_user_id);
        self.endpoint = self.endpoint.trim().to_string();
        self.websocket = self.websocket.trim().to_string();
        self.friends_by_id = self
            .friends_by_id
            .into_iter()
            .filter_map(|(user_id, entry)| {
                let normalized_user_id = normalize_user_id(&user_id);
                entry
                    .normalized(&normalized_user_id)
                    .map(|entry| (entry.record.id.clone(), entry))
            })
            .collect();
        self
    }
}

pub fn normalize_user_id(value: &str) -> String {
    value.trim().to_string()
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
pub enum UserStatus {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "join me")]
    JoinMe,
    #[serde(rename = "ask me")]
    AskMe,
    #[serde(rename = "busy")]
    Busy,
    #[serde(rename = "offline")]
    Offline,
}

impl UserStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::JoinMe => "join me",
            Self::AskMe => "ask me",
            Self::Busy => "busy",
            Self::Offline => "offline",
        }
    }

    pub fn normalize(value: &str) -> Option<Self> {
        match normalize_user_status(value).as_str() {
            "active" => Some(Self::Active),
            "join me" => Some(Self::JoinMe),
            "ask me" => Some(Self::AskMe),
            "busy" => Some(Self::Busy),
            "offline" => Some(Self::Offline),
            _ => None,
        }
    }
}

pub fn normalize_user_status(value: &str) -> String {
    let status = value.trim().to_ascii_lowercase();
    match status.as_str() {
        "joinme" => "join me".to_string(),
        "askme" => "ask me".to_string(),
        "offline:offline" => "offline".to_string(),
        _ if status.starts_with("offline ") => "offline".to_string(),
        _ => status,
    }
}

pub fn meaningful_display_name(
    display_name: &str,
    username: &str,
    user_id: &str,
) -> Option<String> {
    let user_id = user_id.trim();
    for candidate in [display_name, username] {
        let candidate = candidate.trim();
        if !candidate.is_empty()
            && candidate != user_id
            && candidate != "Unknown"
            && !candidate.starts_with("usr_")
        {
            return Some(candidate.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        meaningful_display_name, FriendBaselineEntry, FriendBaselinePresence, FriendRecord,
        FriendRosterBaseline, FRIEND_PRESENCE_KEYS,
    };
    use serde_json::{json, Value};

    #[test]
    fn friend_record_owns_icon_url_as_a_named_field() {
        let record: FriendRecord = serde_json::from_value(json!({
            "id": "usr_friend",
            "iconUrl": "https://api.vrchat.cloud/api/1/image/file_icon/1/256",
            "iconFrame": "invt_frame"
        }))
        .unwrap();

        assert_eq!(
            record.icon_url,
            "https://api.vrchat.cloud/api/1/image/file_icon/1/256"
        );
        assert!(!record.extra.contains_key("iconUrl"));
        assert_eq!(
            record.extra.get("iconFrame"),
            Some(&Value::String("invt_frame".into()))
        );

        let serialized = serde_json::to_value(&record).unwrap();
        assert_eq!(
            serialized["iconUrl"],
            "https://api.vrchat.cloud/api/1/image/file_icon/1/256"
        );
    }

    #[test]
    fn normalizes_baseline_friend_records() {
        let baseline = FriendRosterBaseline {
            current_user_id: " usr_self ".into(),
            endpoint: " https://api.example.test ".into(),
            websocket: " wss://ws.example.test ".into(),
            friends_by_id: [(
                " usr_friend ".to_string(),
                FriendBaselineEntry {
                    record: FriendRecord {
                        display_name: "Friend".into(),
                        ..FriendRecord::default()
                    },
                    presence: FriendBaselinePresence {
                        state: "online".into(),
                        ..FriendBaselinePresence::default()
                    },
                },
            )]
            .into_iter()
            .collect(),
        }
        .normalized();

        assert_eq!(baseline.current_user_id, "usr_self");
        assert_eq!(baseline.endpoint, "https://api.example.test");
        assert_eq!(baseline.websocket, "wss://ws.example.test");
        let friend = baseline.friends_by_id.get("usr_friend").unwrap();
        assert_eq!(friend.record.id, "usr_friend");
        assert_eq!(friend.record.display_name_or_id(), "Friend");
        assert_eq!(friend.presence.state, "online");
    }

    #[test]
    fn baseline_entry_moves_presence_out_of_the_record() {
        let entry: FriendBaselineEntry = serde_json::from_value(json!({
            "id": "usr_friend",
            "displayName": "Friend",
            "state": "online",
            "location": "wrld_a:1",
            "travelingToLocation": "wrld_b:2",
            "worldId": "wrld_a",
            "instanceId": "1",
            "platform": "standalonewindows",
            "$location": { "tag": "wrld_a:1" },
            "last_platform": "android",
            "futureField": "preserved"
        }))
        .unwrap();

        assert_eq!(
            entry.presence,
            FriendBaselinePresence {
                state: "online".into(),
                location: "wrld_a:1".into(),
                traveling_to_location: "wrld_b:2".into(),
                platform: "standalonewindows".into(),
            }
        );
        assert_eq!(entry.record.last_platform, "android");
        let serialized = serde_json::to_value(&entry.record).unwrap();
        for key in FRIEND_PRESENCE_KEYS {
            assert!(serialized.get(*key).is_none(), "{key} leaked");
        }
        assert_eq!(serialized["futureField"], "preserved");
    }

    #[test]
    fn baseline_entry_rejects_non_string_presence_like_the_record_did() {
        assert!(serde_json::from_value::<FriendBaselineEntry>(json!({
            "id": "usr_friend",
            "state": 1
        }))
        .is_err());
    }

    #[test]
    fn compact_friend_fields_keep_string_serialization_and_unknown_fields() {
        let status_description = "a status description longer than twenty-four bytes";
        let record: FriendRecord = serde_json::from_value(json!({
            "id": "usr_friend",
            "displayName": "Friend",
            "last_platform": "android",
            "status": "join me",
            "statusDescription": status_description,
            "futureField": "preserved"
        }))
        .unwrap();

        let serialized = serde_json::to_value(record).unwrap();
        assert_eq!(serialized["displayName"], "Friend");
        assert_eq!(serialized["lastPlatform"], "android");
        assert_eq!(serialized["status"], "join me");
        assert_eq!(serialized["statusDescription"], status_description);
        assert_eq!(serialized["futureField"], "preserved");
    }

    #[test]
    fn compact_friend_dates_preserve_missing_null_and_string_states() {
        let record: FriendRecord = serde_json::from_value(json!({
            "id": "usr_friend",
            "date_joined": "2026-01-01",
            "last_activity": "2026-01-02T03:04:05.000Z",
            "last_login": null,
            "futureField": "preserved"
        }))
        .unwrap();

        assert_eq!(record.date_joined.as_str(), Some("2026-01-01"));
        assert_eq!(
            record.last_activity.as_str(),
            Some("2026-01-02T03:04:05.000Z")
        );
        assert!(record.last_login.is_null());
        assert!(record.last_mobile.is_missing());
        assert!(!record.extra.contains_key("date_joined"));
        assert!(!record.extra.contains_key("last_activity"));
        assert!(!record.extra.contains_key("last_login"));

        let serialized = serde_json::to_value(record).unwrap();
        assert_eq!(serialized["date_joined"], "2026-01-01");
        assert_eq!(serialized["last_activity"], "2026-01-02T03:04:05.000Z");
        assert_eq!(serialized["last_login"], Value::Null);
        assert!(serialized.get("last_mobile").is_none());
        assert_eq!(serialized["futureField"], "preserved");
    }

    #[test]
    fn meaningful_display_name_skips_placeholders() {
        assert_eq!(
            meaningful_display_name("Nagisa", "naginagi", "usr_1"),
            Some("Nagisa".to_string())
        );
        assert_eq!(
            meaningful_display_name("  ", "naginagi", "usr_1"),
            Some("naginagi".to_string())
        );
        assert_eq!(meaningful_display_name("Unknown", "", "usr_1"), None);
        assert_eq!(meaningful_display_name("usr_1", "", "usr_1"), None);
        assert_eq!(meaningful_display_name("usr_other", "", "usr_1"), None);
        assert_eq!(meaningful_display_name("", "", "usr_1"), None);
    }
}

#[cfg(test)]
mod state_bucket_tests {
    use super::*;

    #[test]
    fn from_exact_matches_only_lowercase_known_values() {
        assert_eq!(StateBucket::from_exact("online"), Some(StateBucket::Online));
        assert_eq!(StateBucket::from_exact("active"), Some(StateBucket::Active));
        assert_eq!(
            StateBucket::from_exact("offline"),
            Some(StateBucket::Offline)
        );
        assert_eq!(StateBucket::from_exact("Online"), None);
        assert_eq!(StateBucket::from_exact(""), None);
    }

    #[test]
    fn normalize_trims_and_lowercases_before_matching() {
        assert_eq!(
            StateBucket::normalize(" Online "),
            Some(StateBucket::Online)
        );
        assert_eq!(StateBucket::normalize("ACTIVE"), Some(StateBucket::Active));
        assert_eq!(StateBucket::normalize("sleeping"), None);
    }

    #[test]
    fn as_str_round_trips_through_normalize() {
        for bucket in [
            StateBucket::Online,
            StateBucket::Active,
            StateBucket::Offline,
        ] {
            assert_eq!(StateBucket::normalize(bucket.as_str()), Some(bucket));
        }
    }
}

#[cfg(test)]
mod user_status_tests {
    use super::*;

    #[test]
    fn normalize_resolves_the_five_known_statuses() {
        assert_eq!(UserStatus::normalize("active"), Some(UserStatus::Active));
        assert_eq!(UserStatus::normalize("joinme"), Some(UserStatus::JoinMe));
        assert_eq!(UserStatus::normalize("Ask Me"), Some(UserStatus::AskMe));
        assert_eq!(UserStatus::normalize("busy"), Some(UserStatus::Busy));
        assert_eq!(
            UserStatus::normalize("offline:offline"),
            Some(UserStatus::Offline)
        );
        assert_eq!(UserStatus::normalize("sleeping"), None);
    }

    #[test]
    fn as_str_round_trips_through_normalize() {
        for status in [
            UserStatus::Active,
            UserStatus::JoinMe,
            UserStatus::AskMe,
            UserStatus::Busy,
            UserStatus::Offline,
        ] {
            assert_eq!(UserStatus::normalize(status.as_str()), Some(status));
        }
    }

    #[test]
    fn serde_accepts_only_supported_wire_values() {
        assert_eq!(
            serde_json::from_value::<UserStatus>(serde_json::json!("join me")).unwrap(),
            UserStatus::JoinMe
        );
        assert!(serde_json::from_value::<UserStatus>(serde_json::json!("future")).is_err());
    }
}
