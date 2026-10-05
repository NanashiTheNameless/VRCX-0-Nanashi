use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(default)]
pub struct WorldCollectionSnapshotWorld {
    pub world_id: String,
    pub name: String,
    pub author_name: String,
    pub image_url: String,
    pub description: String,
    pub comment: String,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
#[serde(default)]
pub struct WorldCollectionSnapshotResponse {
    pub id: String,
    pub title: String,
    pub note: Option<String>,
    pub author_name: String,
    pub author_profile: Option<String>,
    pub category: Option<String>,
    pub listed: bool,
    pub updated_at: i64,
    pub worlds: Vec<WorldCollectionSnapshotWorld>,
}
