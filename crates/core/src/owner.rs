use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(
    Clone,
    Debug,
    Default,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Deserialize,
    Serialize,
    specta::Type,
)]
#[serde(transparent)]
pub struct OwnerId(String);

impl OwnerId {
    pub fn new(owner_user_id: impl Into<String>) -> Self {
        Self(owner_user_id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl std::fmt::Display for OwnerId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl From<&OwnerId> for Value {
    fn from(owner_user_id: &OwnerId) -> Self {
        Value::String(owner_user_id.0.clone())
    }
}

impl From<OwnerId> for Value {
    fn from(owner_user_id: OwnerId) -> Self {
        Value::String(owner_user_id.0)
    }
}
