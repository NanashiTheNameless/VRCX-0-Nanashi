use std::collections::HashSet;

pub use crate::{CommunityThemeAuthor, CommunityThemeCatalog, CommunityThemeManifest};
use serde_json::Value;
use url::Url;

use crate::external_api::{ExternalHttpMethod, ExternalHttpRequestInput};

pub const COMMUNITY_THEME_REPOSITORY_URL: &str =
    "https://github.com/Map1en/VRCX-0-Community-Themes";
pub const COMMUNITY_THEME_CATALOG_URL: &str =
    "https://raw.githubusercontent.com/Map1en/VRCX-0-Community-Themes/master/themes/index.json";
pub const COMMUNITY_THEME_CSS_FILE_NAME: &str = "theme.css";
pub const COMMUNITY_THEME_MANIFEST_FILE_NAME: &str = "theme.json";
pub const COMMUNITY_THEME_PREVIEW_FILE_NAME: &str = "preview.webp";
pub const COMMUNITY_THEME_README_FILE_NAME: &str = "README.md";

pub const COMMUNITY_THEME_CATALOG_MAX_BYTES: usize = 64 * 1024;
pub const COMMUNITY_THEME_MANIFEST_MAX_BYTES: usize = 64 * 1024;
pub const COMMUNITY_THEME_CSS_MAX_BYTES: usize = 1024 * 1024;
pub const COMMUNITY_THEME_REPORT_MAX_BYTES: usize = 64 * 1024;
pub const COMMUNITY_THEME_MAX_COUNT: usize = 128;

const COMMUNITY_THEME_ID_MAX_LEN: usize = 64;
const COMMUNITY_THEME_TEXT_MAX_LEN: usize = 4096;

#[derive(Debug, thiserror::Error)]
pub enum CommunityThemeProtocolError {
    #[error("{0}")]
    Invalid(String),
}

pub fn is_community_theme_id(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= COMMUNITY_THEME_ID_MAX_LEN
        && value.split('-').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

pub fn community_theme_catalog_input() -> ExternalHttpRequestInput {
    external_request(COMMUNITY_THEME_CATALOG_URL, ExternalHttpMethod::Get)
}

pub fn community_theme_manifest_input(
    theme_id: &str,
) -> Result<ExternalHttpRequestInput, CommunityThemeProtocolError> {
    Ok(external_request(
        &community_theme_asset_url(theme_id, COMMUNITY_THEME_MANIFEST_FILE_NAME)?,
        ExternalHttpMethod::Get,
    ))
}

pub fn community_theme_css_input(
    theme_id: &str,
) -> Result<ExternalHttpRequestInput, CommunityThemeProtocolError> {
    Ok(external_request(
        &community_theme_asset_url(theme_id, COMMUNITY_THEME_CSS_FILE_NAME)?,
        ExternalHttpMethod::Get,
    ))
}

pub fn community_theme_asset_url(
    theme_id: &str,
    file_name: &str,
) -> Result<String, CommunityThemeProtocolError> {
    require_theme_id(theme_id)?;
    if !matches!(
        file_name,
        COMMUNITY_THEME_CSS_FILE_NAME
            | COMMUNITY_THEME_MANIFEST_FILE_NAME
            | COMMUNITY_THEME_PREVIEW_FILE_NAME
            | COMMUNITY_THEME_README_FILE_NAME
    ) {
        return Err(CommunityThemeProtocolError::Invalid(
            "Invalid community theme asset name.".into(),
        ));
    }
    let catalog = Url::parse(COMMUNITY_THEME_CATALOG_URL)
        .map_err(|error| CommunityThemeProtocolError::Invalid(error.to_string()))?;
    catalog
        .join(&format!("{theme_id}/{file_name}"))
        .map(|url| url.to_string())
        .map_err(|error| CommunityThemeProtocolError::Invalid(error.to_string()))
}

pub fn ensure_community_theme_response(
    status: i32,
    body: &str,
    max_bytes: usize,
    context: &str,
) -> Result<(), CommunityThemeProtocolError> {
    if status != 200 {
        return Err(CommunityThemeProtocolError::Invalid(format!(
            "Failed to load community theme {context}: HTTP {status}."
        )));
    }
    if body.len() > max_bytes {
        return Err(CommunityThemeProtocolError::Invalid(format!(
            "Community theme {context} response is too large."
        )));
    }
    Ok(())
}

pub fn parse_community_theme_catalog_index(
    body: &str,
) -> Result<(u32, Vec<String>), CommunityThemeProtocolError> {
    let value: Value = serde_json::from_str(body).map_err(|error| {
        CommunityThemeProtocolError::Invalid(format!(
            "Invalid community theme catalog JSON: {error}"
        ))
    })?;
    let entry = value.as_object().ok_or_else(|| {
        CommunityThemeProtocolError::Invalid(
            "Invalid community theme catalog: expected an object.".into(),
        )
    })?;
    let themes = entry
        .get("themes")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CommunityThemeProtocolError::Invalid(
                "Invalid community theme catalog: missing themes.".into(),
            )
        })?;
    if themes.len() > COMMUNITY_THEME_MAX_COUNT {
        return Err(CommunityThemeProtocolError::Invalid(format!(
            "Community theme catalog exceeds the {COMMUNITY_THEME_MAX_COUNT} theme limit."
        )));
    }

    let mut seen = HashSet::with_capacity(themes.len());
    let mut theme_ids = Vec::with_capacity(themes.len());
    for value in themes {
        let theme_id = value.as_str().map(str::trim).ok_or_else(|| {
            CommunityThemeProtocolError::Invalid(
                "Invalid community theme catalog: theme id must be a string.".into(),
            )
        })?;
        require_theme_id(theme_id)?;
        if !seen.insert(theme_id.to_string()) {
            return Err(CommunityThemeProtocolError::Invalid(format!(
                "Invalid community theme catalog: duplicate theme id {theme_id}."
            )));
        }
        theme_ids.push(theme_id.to_string());
    }

    let schema_version = number_value(entry.get("schemaVersion"))
        .filter(|value| *value >= 0.0)
        .map(|value| value.floor().min(u32::MAX as f64) as u32)
        .filter(|value| *value > 0)
        .unwrap_or(1);
    Ok((schema_version, theme_ids))
}

pub fn parse_community_theme_manifest(
    body: &str,
    expected_theme_id: &str,
) -> Result<CommunityThemeManifest, CommunityThemeProtocolError> {
    require_theme_id(expected_theme_id)?;
    let value: Value = serde_json::from_str(body).map_err(|error| {
        CommunityThemeProtocolError::Invalid(format!(
            "Invalid community theme manifest JSON for {expected_theme_id}: {error}"
        ))
    })?;
    let entry = value.as_object().ok_or_else(|| {
        CommunityThemeProtocolError::Invalid(format!(
            "Invalid community theme manifest: {expected_theme_id}."
        ))
    })?;
    let theme_id = required_string(entry.get("id"), "id", expected_theme_id)?;
    require_theme_id(&theme_id)?;
    if theme_id != expected_theme_id {
        return Err(CommunityThemeProtocolError::Invalid(format!(
            "Invalid community theme {expected_theme_id}: theme.json id does not match directory."
        )));
    }

    let author = entry
        .get("author")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            CommunityThemeProtocolError::Invalid(format!(
                "Invalid community theme {theme_id}: missing author."
            ))
        })?;
    let tags = entry
        .get("tags")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            CommunityThemeProtocolError::Invalid(format!(
                "Invalid community theme {theme_id}: missing tags."
            ))
        })?
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .take(3)
        .map(|tag| tag.chars().take(128).collect())
        .collect();

    Ok(CommunityThemeManifest {
        id: theme_id.clone(),
        name: required_string(entry.get("name"), "name", &theme_id)?,
        version: required_string(entry.get("version"), "version", &theme_id)?,
        author: CommunityThemeAuthor {
            name: required_string(author.get("name"), "name", &format!("{theme_id} author"))?,
            github: required_string(
                author.get("github"),
                "github",
                &format!("{theme_id} author"),
            )?,
            url: optional_string(author.get("url")),
        },
        description: required_string(entry.get("description"), "description", &theme_id)?,
        tags,
        tested_with: required_string(entry.get("testedWith"), "testedWith", &theme_id)?,
        remote_assets: entry.get("remoteAssets").and_then(Value::as_bool) == Some(true),
        dark_mode: entry.get("darkMode").and_then(Value::as_bool) != Some(false),
        accent_mode: entry.get("accentMode").and_then(Value::as_bool) == Some(true),
        preview_url: community_theme_asset_url(&theme_id, COMMUNITY_THEME_PREVIEW_FILE_NAME)?,
        readme_url: community_theme_asset_url(&theme_id, COMMUNITY_THEME_README_FILE_NAME)?,
    })
}

fn external_request(url: &str, method: ExternalHttpMethod) -> ExternalHttpRequestInput {
    ExternalHttpRequestInput {
        url: Some(url.to_string()),
        method: Some(method),
        ..Default::default()
    }
}

fn require_theme_id(theme_id: &str) -> Result<(), CommunityThemeProtocolError> {
    if is_community_theme_id(theme_id) {
        return Ok(());
    }
    Err(CommunityThemeProtocolError::Invalid(format!(
        "Invalid community theme id: {}.",
        if theme_id.trim().is_empty() {
            "(empty)"
        } else {
            theme_id.trim()
        }
    )))
}

fn required_string(
    value: Option<&Value>,
    field: &str,
    context: &str,
) -> Result<String, CommunityThemeProtocolError> {
    let value = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            CommunityThemeProtocolError::Invalid(format!(
                "Invalid community theme {context}: missing {field}."
            ))
        })?;
    if value.len() > COMMUNITY_THEME_TEXT_MAX_LEN {
        return Err(CommunityThemeProtocolError::Invalid(format!(
            "Invalid community theme {context}: {field} is too long."
        )));
    }
    Ok(value.to_string())
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(COMMUNITY_THEME_TEXT_MAX_LEN).collect())
}

fn number_value(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(value) => value.as_f64(),
        Value::String(value) => value.trim().parse().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_ids_and_builds_only_fixed_asset_urls() {
        assert!(is_community_theme_id("midnight-blue-2"));
        assert!(!is_community_theme_id("../theme"));
        assert!(!is_community_theme_id("Theme"));
        assert_eq!(
            community_theme_asset_url("midnight-blue", COMMUNITY_THEME_CSS_FILE_NAME).unwrap(),
            "https://raw.githubusercontent.com/Map1en/VRCX-0-Community-Themes/master/themes/midnight-blue/theme.css"
        );
        assert!(community_theme_asset_url("midnight-blue", "../secret").is_err());
    }

    #[test]
    fn parses_catalog_and_rejects_duplicate_or_traversal_ids() {
        assert_eq!(
            parse_community_theme_catalog_index(
                r#"{"schemaVersion":"2","themes":["theme-a","theme-b"]}"#
            )
            .unwrap(),
            (2, vec!["theme-a".to_string(), "theme-b".to_string()])
        );
        assert!(
            parse_community_theme_catalog_index(r#"{"themes":["theme-a","theme-a"]}"#).is_err()
        );
        assert!(parse_community_theme_catalog_index(r#"{"themes":["../theme"]}"#).is_err());
    }

    #[test]
    fn parses_manifest_with_current_compatibility_defaults() {
        let manifest = parse_community_theme_manifest(
            r#"{
                "id":"theme-a",
                "name":"Theme A",
                "version":"1.0.0",
                "author":{"name":"Tester","github":"tester"},
                "description":"Description",
                "tags":["dark",42," compact ","extra"],
                "testedWith":"2.8.0"
            }"#,
            "theme-a",
        )
        .unwrap();
        assert!(manifest.dark_mode);
        assert!(!manifest.accent_mode);
        assert_eq!(manifest.tags, vec!["dark", "compact", "extra"]);
        assert!(manifest.preview_url.ends_with("/theme-a/preview.webp"));
        assert!(parse_community_theme_manifest(
            r#"{
                    "id":"theme-b","name":"Theme A","version":"1",
                    "author":{"name":"Tester","github":"tester"},
                    "description":"Description","tags":[],"testedWith":"2.8.0"
                }"#,
            "theme-a"
        )
        .is_err());
    }

    #[test]
    fn enforces_response_limits() {
        assert!(ensure_community_theme_response(404, "", 10, "catalog").is_err());
        assert!(ensure_community_theme_response(200, "123456", 5, "catalog").is_err());
    }
}
