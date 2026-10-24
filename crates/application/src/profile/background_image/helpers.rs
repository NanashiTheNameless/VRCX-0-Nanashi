use std::path::Path;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::Value;
use vrcx_0_core::json::text_of;

use super::super::ProfileConfigStore;
use super::{
    BackgroundImageCustomSource, BackgroundImageCustomSourceKind, BackgroundImageMode,
    BackgroundImageProviderId, BackgroundImageSnapshot, KEY_COMMUNITY_THEME_CSS_SNAPSHOT,
    KEY_COMMUNITY_THEME_ENABLED, KEY_COMMUNITY_THEME_INSTALLED_THEMES,
    KEY_COMMUNITY_THEME_INSTALL_METADATA,
};
use vrcx_0_application_core::{Error, Result};

const SNAPSHOT_TTL: chrono::Duration = chrono::Duration::hours(24);
pub(super) const DEFAULT_ROTATION_INTERVAL_MINUTES: u16 = 60;
pub(super) const MIN_ROTATION_INTERVAL_MINUTES: u16 = 1;
pub(super) const MAX_ROTATION_INTERVAL_MINUTES: u16 = 24 * 60;

pub(super) fn community_theme_appearance_active(config: &dyn ProfileConfigStore) -> Result<bool> {
    if !config.get_bool(KEY_COMMUNITY_THEME_ENABLED, false)? {
        return Ok(false);
    }
    let records = config.get_json(KEY_COMMUNITY_THEME_INSTALLED_THEMES, Value::Null)?;
    if records
        .as_array()
        .is_some_and(|records| !records.is_empty())
    {
        return Ok(true);
    }
    let metadata = config.get_json(KEY_COMMUNITY_THEME_INSTALL_METADATA, Value::Null)?;
    if !text_of(metadata.get("themeId")).trim().is_empty() {
        return Ok(true);
    }
    Ok(!config
        .get_string(KEY_COMMUNITY_THEME_CSS_SNAPSHOT, "")?
        .trim()
        .is_empty())
}

pub(super) fn mode_as_str(mode: BackgroundImageMode) -> &'static str {
    match mode {
        BackgroundImageMode::Off => "off",
        BackgroundImageMode::Daily => "daily",
        BackgroundImageMode::Custom => "custom",
    }
}

pub(super) fn normalize_mode(value: &str) -> BackgroundImageMode {
    match value.trim() {
        "daily" => BackgroundImageMode::Daily,
        "custom" => BackgroundImageMode::Custom,
        _ => BackgroundImageMode::Off,
    }
}

pub(super) fn normalize_provider_snapshot(
    value: Option<&Value>,
    expected_provider: BackgroundImageProviderId,
) -> Option<BackgroundImageSnapshot> {
    let value = value?;
    if !value.is_object() {
        return None;
    }
    let provider_id = BackgroundImageProviderId::from_config(&text_of(value.get("providerId")));
    if provider_id != expected_provider {
        return None;
    }
    let image_url = text_of(value.get("imageUrl")).trim().to_string();
    if image_url.is_empty() {
        return None;
    }
    let resolved_for_key = {
        let key = text_of(value.get("resolvedForKey"));
        if key.is_empty() {
            text_of(value.get("resolvedForDate"))
        } else {
            key
        }
    };

    Some(BackgroundImageSnapshot {
        mode: BackgroundImageMode::Daily,
        provider_id: Some(provider_id),
        source_kind: None,
        image_url,
        image_path: None,
        image_count: None,
        title: text_of(value.get("title")),
        author: text_of(value.get("author")),
        license: text_of(value.get("license")),
        source: text_of(value.get("source")),
        resolved_at: value
            .get("resolvedAt")
            .and_then(vrcx_0_core::time::epoch_from_json)
            .unwrap_or_default(),
        resolved_for_key,
    })
}

pub(super) fn is_snapshot_fresh(snapshot: Option<&BackgroundImageSnapshot>) -> bool {
    let Some(snapshot) = snapshot else {
        return false;
    };
    if snapshot.provider_id.is_none() || snapshot.resolved_at == 0 {
        return false;
    }
    let Some(resolved_at) = DateTime::<Utc>::from_timestamp(snapshot.resolved_at, 0) else {
        return false;
    };
    let age = Utc::now().signed_duration_since(resolved_at.with_timezone(&Utc));
    age >= chrono::Duration::zero() && age < SNAPSHOT_TTL
}

pub(super) fn unique_paths(paths: &[String]) -> Vec<String> {
    let mut seen = Vec::new();
    for path in paths {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            continue;
        }
        if !seen.iter().any(|existing: &String| existing == trimmed) {
            seen.push(trimmed.to_string());
        }
    }
    seen
}

pub(super) fn normalize_custom_source_struct(
    source: BackgroundImageCustomSource,
) -> Option<BackgroundImageCustomSource> {
    let paths = unique_paths(&source.paths);
    let folder_path = source.folder_path.trim().to_string();
    match source.kind {
        BackgroundImageCustomSourceKind::Folder if folder_path.is_empty() => None,
        BackgroundImageCustomSourceKind::Files if paths.is_empty() => None,
        BackgroundImageCustomSourceKind::Folder => Some(BackgroundImageCustomSource {
            kind: BackgroundImageCustomSourceKind::Folder,
            paths: Vec::new(),
            folder_path,
            rotation_interval_minutes: source.rotation_interval_minutes,
        }),
        BackgroundImageCustomSourceKind::Files => Some(BackgroundImageCustomSource {
            kind: BackgroundImageCustomSourceKind::Files,
            paths,
            folder_path: String::new(),
            rotation_interval_minutes: source.rotation_interval_minutes,
        }),
    }
}

pub(super) fn normalize_custom_source(value: &Value) -> Option<BackgroundImageCustomSource> {
    if !value.is_object() {
        return None;
    }
    let kind = if text_of(value.get("kind")) == "folder" {
        BackgroundImageCustomSourceKind::Folder
    } else {
        BackgroundImageCustomSourceKind::Files
    };
    let paths: Vec<String> = value
        .get("paths")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .map(|entry| text_of(Some(entry)))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let rotation_interval_minutes = value
        .get("rotationIntervalMinutes")
        .and_then(Value::as_u64)
        .and_then(|value| u16::try_from(value).ok())
        .filter(|value| {
            (MIN_ROTATION_INTERVAL_MINUTES..=MAX_ROTATION_INTERVAL_MINUTES).contains(value)
        })
        .unwrap_or(DEFAULT_ROTATION_INTERVAL_MINUTES);

    normalize_custom_source_struct(BackgroundImageCustomSource {
        kind,
        paths,
        folder_path: text_of(value.get("folderPath")),
        rotation_interval_minutes,
    })
}

pub(super) fn files_source(
    paths: Vec<String>,
    rotation_interval_minutes: u16,
) -> BackgroundImageCustomSource {
    BackgroundImageCustomSource {
        kind: BackgroundImageCustomSourceKind::Files,
        paths: unique_paths(&paths),
        folder_path: String::new(),
        rotation_interval_minutes,
    }
}

pub(super) fn folder_source(
    folder_path: String,
    rotation_interval_minutes: u16,
) -> BackgroundImageCustomSource {
    BackgroundImageCustomSource {
        kind: BackgroundImageCustomSourceKind::Folder,
        paths: Vec::new(),
        folder_path: folder_path.trim().to_string(),
        rotation_interval_minutes,
    }
}

fn path_key(path: &str) -> String {
    path.trim().to_lowercase()
}

pub(super) fn assert_selected_files_available(
    source: &BackgroundImageCustomSource,
    files: &[String],
) -> Result<()> {
    if source.kind != BackgroundImageCustomSourceKind::Files {
        return Ok(());
    }
    let available: Vec<String> = files.iter().map(|file| path_key(file)).collect();
    if source
        .paths
        .iter()
        .any(|path| !available.contains(&path_key(path)))
    {
        return Err(Error::Custom(
            "A selected background image is no longer available.".into(),
        ));
    }
    Ok(())
}

pub(super) fn source_hash_key(source: &BackgroundImageCustomSource) -> String {
    match source.kind {
        BackgroundImageCustomSourceKind::Folder => format!("folder:{}", source.folder_path),
        BackgroundImageCustomSourceKind::Files => format!("files:{}", source.paths.join("|")),
    }
}

pub(super) fn stable_hash(value: &str) -> u32 {
    let mut hash: u32 = 2166136261;
    for unit in value.encode_utf16() {
        hash ^= unit as u32;
        hash = hash.wrapping_mul(16777619);
    }
    hash
}

pub(super) fn projection_update_is_current(
    current_operation: u64,
    operation: u64,
    current_revision: u64,
    expected_revision: Option<u64>,
) -> bool {
    current_operation == operation
        && expected_revision.is_none_or(|revision| current_revision == revision)
}

pub(super) fn file_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

pub(super) fn current_utc_date_key() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

pub(super) fn random_custom_image_index(
    source: &BackgroundImageCustomSource,
    files: &[String],
    previous: Option<&BackgroundImageSnapshot>,
) -> usize {
    if files.len() <= 1 {
        return 0;
    }
    let previous_index = previous
        .and_then(|snapshot| snapshot.image_path.as_deref())
        .and_then(|previous_path| {
            files
                .iter()
                .position(|file| path_key(file) == path_key(previous_path))
        });
    match (previous, previous_index) {
        (_, Some(index)) => (index + fastrand::usize(1..files.len())) % files.len(),
        (Some(_), None) => fastrand::usize(..files.len()),
        (None, None) => (stable_hash(&source_hash_key(source)) as usize) % files.len(),
    }
}

pub(super) fn rotation_delay(rotation_interval_minutes: u16) -> Duration {
    Duration::from_secs(u64::from(rotation_interval_minutes) * 60)
}
