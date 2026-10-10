use std::time::Duration;
use vrcx_0_http_client::{Policy as HttpPolicy, RequestBuilderExt};

pub use vrcx_0_contracts::world_collections::{
    WorldCollectionSnapshotResponse, WorldCollectionSnapshotWorld,
};

/// Public collection reads use the configured RemoteSync API instance.
const WORLD_COLLECTIONS_FETCH_TIMEOUT: Duration = Duration::from_secs(30);
const COLLECTION_SHORTCODE_MIN_LEN: usize = 6;
const COLLECTION_SHORTCODE_MAX_LEN: usize = 12;

#[derive(Debug, thiserror::Error)]
pub enum WorldCollectionShareError {
    #[error("{0}")]
    Custom(String),
}

pub fn validate_collection_shortcode(id: &str) -> Result<String, WorldCollectionShareError> {
    let id = id.trim();
    let valid_len =
        (COLLECTION_SHORTCODE_MIN_LEN..=COLLECTION_SHORTCODE_MAX_LEN).contains(&id.len());
    let valid_chars = !id.is_empty() && id.chars().all(|value| value.is_ascii_alphanumeric());
    if valid_len && valid_chars {
        Ok(id.to_string())
    } else {
        Err(WorldCollectionShareError::Custom(
            "Invalid share collection id.".into(),
        ))
    }
}

pub async fn fetch_world_collection(
    api_origin: &str,
    id: &str,
) -> Result<WorldCollectionSnapshotResponse, WorldCollectionShareError> {
    let id = validate_collection_shortcode(id)?;
    let mut origin = url::Url::parse(api_origin)
        .map_err(|_| WorldCollectionShareError::Custom("Invalid RemoteSync API URL.".into()))?;
    if origin.scheme() != "https"
        || origin.host_str().is_none()
        || !origin.username().is_empty()
        || origin.password().is_some()
        || origin.query().is_some()
        || origin.fragment().is_some()
        || !matches!(origin.path(), "" | "/")
    {
        return Err(WorldCollectionShareError::Custom(
            "RemoteSync API URL must be an HTTPS origin.".into(),
        ));
    }
    origin.set_path("");
    vrcx_0_core::tls::install_crypto_provider();
    let client = vrcx_0_http_client::builder()
        .user_agent(vrcx_0_core::user_agent::app_user_agent())
        .timeout(WORLD_COLLECTIONS_FETCH_TIMEOUT)
        .build()
        .map_err(|error| {
            WorldCollectionShareError::Custom(format!(
                "share collection fetch client failed: {error}"
            ))
        })?;
    let url = format!(
        "{}/public/v1/collections/{id}",
        origin.as_str().trim_end_matches('/')
    );
    let response = client
        .get(url)
        .timeout(WORLD_COLLECTIONS_FETCH_TIMEOUT)
        .send_with_policy(HttpPolicy::public())
        .await
        .map_err(|error| {
            WorldCollectionShareError::Custom(format!("share collection fetch failed: {error}"))
        })?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        let detail = body.trim();
        let message = if detail.is_empty() {
            format!("share collection fetch returned HTTP {status}")
        } else {
            format!("share collection fetch returned HTTP {status}: {detail}")
        };
        return Err(WorldCollectionShareError::Custom(message));
    }
    response.json().await.map_err(|error| {
        WorldCollectionShareError::Custom(format!(
            "share collection fetch response is invalid: {error}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::{validate_collection_shortcode, WorldCollectionSnapshotResponse};

    #[test]
    fn snapshot_accepts_nullable_note_from_public_api() {
        let snapshot: WorldCollectionSnapshotResponse = serde_json::from_value(serde_json::json!({
            "id": "AbC123z",
            "title": "Worlds",
            "note": null,
            "author_name": "Curator",
            "author_profile": null,
            "category": null,
            "listed": false,
            "updated_at": 0,
            "worlds": []
        }))
        .expect("nullable note should match the public API contract");

        assert_eq!(snapshot.note, None);
    }

    #[test]
    fn collection_codes_are_bounded_alphanumeric_values() {
        assert_eq!(validate_collection_shortcode("AbC123z").unwrap(), "AbC123z");
        for code in ["short", "has space", "contains/slash", "toolongcode123"] {
            assert!(validate_collection_shortcode(code).is_err(), "{code}");
        }
    }
}
