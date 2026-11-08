use serde::{Deserialize, Serialize};

pub const SETTINGS_KEY: &str = "profileHistorySettings";
pub const REVISION_KEY: &str = "profileHistorySettingsRevision";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileHistoryField {
    Status,
    Bio,
    Pronouns,
}

impl ProfileHistoryField {
    pub const ALL: [Self; 3] = [Self::Status, Self::Bio, Self::Pronouns];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::Bio => "bio",
            Self::Pronouns => "pronouns",
        }
    }

    pub const fn properties(self) -> &'static [&'static str] {
        match self {
            Self::Status => &["status", "statusDescription"],
            Self::Bio => &["bio"],
            Self::Pronouns => &["pronouns"],
        }
    }

    pub const fn stream(self) -> &'static str {
        match self {
            Self::Status => "profile_history_status",
            Self::Bio => "profile_history_bio",
            Self::Pronouns => "profile_history_pronouns",
        }
    }

    pub fn from_stream(stream: &str) -> Option<Self> {
        match stream {
            "feed_status" | "self_profile_status" => Some(Self::Status),
            "feed_bio" | "profile_bio" | "self_profile_bio" => Some(Self::Bio),
            _ => Self::ALL.into_iter().find(|field| field.stream() == stream),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileHistoryChoice {
    pub recording: bool,
    pub sync: bool,
}

impl Default for ProfileHistoryChoice {
    fn default() -> Self {
        Self {
            recording: false,
            sync: true,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct ProfileHistorySettings {
    pub status: ProfileHistoryChoice,
    pub bio: ProfileHistoryChoice,
    pub pronouns: ProfileHistoryChoice,
}

impl ProfileHistorySettings {
    pub fn choice(&self, field: ProfileHistoryField) -> ProfileHistoryChoice {
        match field {
            ProfileHistoryField::Status => self.status,
            ProfileHistoryField::Bio => self.bio,
            ProfileHistoryField::Pronouns => self.pronouns,
        }
    }
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileHistoryEntry {
    pub id: i64,
    pub field: ProfileHistoryField,
    pub property: String,
    pub created_at: i64,
    pub previous_value: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProfileHistoryQuery {
    pub user_id: String,
    pub field: Option<ProfileHistoryField>,
    pub before_id: Option<i64>,
    pub before_at: Option<i64>,
    pub before_field: Option<ProfileHistoryField>,
}
