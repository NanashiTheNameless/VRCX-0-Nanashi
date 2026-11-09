use serde::{Deserialize, Serialize};

pub const SETTINGS_KEY: &str = "profileHistorySettings";
pub const REVISION_KEY: &str = "profileHistorySettingsRevision";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProfileHistoryField {
    Status,
    Bio,
    Pronouns,
    DisplayName,
    BioLinks,
    ProfilePictures,
    ProfileDecorations,
    Badges,
    Tags,
    AgeVerification,
    AvatarCloning,
}

impl ProfileHistoryField {
    pub const ALL: [Self; 11] = [
        Self::Status,
        Self::Bio,
        Self::Pronouns,
        Self::DisplayName,
        Self::BioLinks,
        Self::ProfilePictures,
        Self::ProfileDecorations,
        Self::Badges,
        Self::Tags,
        Self::AgeVerification,
        Self::AvatarCloning,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Status => "status",
            Self::Bio => "bio",
            Self::Pronouns => "pronouns",
            Self::DisplayName => "displayName",
            Self::BioLinks => "bioLinks",
            Self::ProfilePictures => "profilePictures",
            Self::ProfileDecorations => "profileDecorations",
            Self::Badges => "badges",
            Self::Tags => "tags",
            Self::AgeVerification => "ageVerification",
            Self::AvatarCloning => "avatarCloning",
        }
    }

    /// The VRChat profile properties recorded under this field.
    pub const fn properties(self) -> &'static [&'static str] {
        match self {
            Self::Status => &["status", "statusDescription"],
            Self::Bio => &["bio"],
            Self::Pronouns => &["pronouns"],
            Self::DisplayName => &["displayName"],
            Self::BioLinks => &["bioLinks"],
            Self::ProfilePictures => &["userIcon", "profilePicOverride"],
            Self::ProfileDecorations => &[
                "bannerUrl",
                "bannerCustomUrl",
                "bannerType",
                "iconFrame",
                "iconType",
            ],
            Self::Badges => &["badges"],
            Self::Tags => &["tags"],
            Self::AgeVerification => &["ageVerificationStatus", "ageVerified"],
            Self::AvatarCloning => &["allowAvatarCopying"],
        }
    }

    pub const fn stream(self) -> &'static str {
        match self {
            Self::Status => "profile_history_status",
            Self::Bio => "profile_history_bio",
            Self::Pronouns => "profile_history_pronouns",
            Self::DisplayName => "profile_history_display_name",
            Self::BioLinks => "profile_history_bio_links",
            Self::ProfilePictures => "profile_history_profile_pictures",
            Self::ProfileDecorations => "profile_history_profile_decorations",
            Self::Badges => "profile_history_badges",
            Self::Tags => "profile_history_tags",
            Self::AgeVerification => "profile_history_age_verification",
            Self::AvatarCloning => "profile_history_avatar_cloning",
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
    pub display_name: ProfileHistoryChoice,
    pub bio_links: ProfileHistoryChoice,
    pub profile_pictures: ProfileHistoryChoice,
    pub profile_decorations: ProfileHistoryChoice,
    pub badges: ProfileHistoryChoice,
    pub tags: ProfileHistoryChoice,
    pub age_verification: ProfileHistoryChoice,
    pub avatar_cloning: ProfileHistoryChoice,
}

impl ProfileHistorySettings {
    pub fn choice(&self, field: ProfileHistoryField) -> ProfileHistoryChoice {
        match field {
            ProfileHistoryField::Status => self.status,
            ProfileHistoryField::Bio => self.bio,
            ProfileHistoryField::Pronouns => self.pronouns,
            ProfileHistoryField::DisplayName => self.display_name,
            ProfileHistoryField::BioLinks => self.bio_links,
            ProfileHistoryField::ProfilePictures => self.profile_pictures,
            ProfileHistoryField::ProfileDecorations => self.profile_decorations,
            ProfileHistoryField::Badges => self.badges,
            ProfileHistoryField::Tags => self.tags,
            ProfileHistoryField::AgeVerification => self.age_verification,
            ProfileHistoryField::AvatarCloning => self.avatar_cloning,
        }
    }

    pub fn choice_mut(&mut self, field: ProfileHistoryField) -> &mut ProfileHistoryChoice {
        match field {
            ProfileHistoryField::Status => &mut self.status,
            ProfileHistoryField::Bio => &mut self.bio,
            ProfileHistoryField::Pronouns => &mut self.pronouns,
            ProfileHistoryField::DisplayName => &mut self.display_name,
            ProfileHistoryField::BioLinks => &mut self.bio_links,
            ProfileHistoryField::ProfilePictures => &mut self.profile_pictures,
            ProfileHistoryField::ProfileDecorations => &mut self.profile_decorations,
            ProfileHistoryField::Badges => &mut self.badges,
            ProfileHistoryField::Tags => &mut self.tags,
            ProfileHistoryField::AgeVerification => &mut self.age_verification,
            ProfileHistoryField::AvatarCloning => &mut self.avatar_cloning,
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
