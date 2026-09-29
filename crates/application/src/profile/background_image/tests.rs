use std::time::Duration;

use chrono::Utc;
use serde_json::json;

use super::*;

fn files_custom_source(paths: &[&str]) -> BackgroundImageCustomSource {
    BackgroundImageCustomSource {
        kind: BackgroundImageCustomSourceKind::Files,
        paths: paths.iter().map(|p| p.to_string()).collect(),
        folder_path: String::new(),
        rotation_interval_minutes: DEFAULT_ROTATION_INTERVAL_MINUTES,
    }
}

fn custom_snapshot(image_path: &str) -> BackgroundImageSnapshot {
    BackgroundImageSnapshot {
        mode: BackgroundImageMode::Custom,
        provider_id: None,
        source_kind: Some(BackgroundImageCustomSourceKind::Files),
        image_url: String::new(),
        image_path: Some(image_path.into()),
        image_count: Some(3),
        title: String::new(),
        author: String::new(),
        license: String::new(),
        source: String::new(),
        resolved_at: String::new(),
        resolved_for_key: String::new(),
    }
}

#[test]
fn custom_source_normalization_drops_empty_sources() {
    assert!(normalize_custom_source_struct(files_custom_source(&[])).is_none());
    assert!(normalize_custom_source_struct(BackgroundImageCustomSource {
        kind: BackgroundImageCustomSourceKind::Folder,
        paths: Vec::new(),
        folder_path: "  ".into(),
        rotation_interval_minutes: DEFAULT_ROTATION_INTERVAL_MINUTES,
    })
    .is_none());
    let normalized =
        normalize_custom_source_struct(files_custom_source(&["a.png", " a.png ", "", "b.png"]))
            .unwrap();
    assert_eq!(normalized.paths, vec!["a.png", "b.png"]);
}

#[test]
fn custom_source_wire_normalization_matches_config_shape() {
    let value = json!({
        "kind": "folder",
        "paths": ["ignored.png"],
        "folderPath": " C:\\wallpapers ",
        "rotationIntervalMinutes": 180
    });
    let source = normalize_custom_source(&value).unwrap();
    assert_eq!(source.kind, BackgroundImageCustomSourceKind::Folder);
    assert!(source.paths.is_empty());
    assert_eq!(source.folder_path, "C:\\wallpapers");
    assert_eq!(source.rotation_interval_minutes, 180);

    let invalid_interval = json!({
        "kind": "folder",
        "folderPath": "C:\\wallpapers",
        "rotationIntervalMinutes": 1441
    });
    assert_eq!(
        normalize_custom_source(&invalid_interval)
            .unwrap()
            .rotation_interval_minutes,
        DEFAULT_ROTATION_INTERVAL_MINUTES
    );
}

#[test]
fn provider_snapshot_normalization_accepts_legacy_resolved_for_date() {
    let value = json!({
        "providerId": "nasa-epic",
        "imageUrl": "https://epic.gsfc.nasa.gov/a.jpg",
        "resolvedAt": "2026-07-30T00:00:00.000Z",
        "resolvedForDate": "2026-07-30"
    });
    let snapshot =
        normalize_provider_snapshot(Some(&value), BackgroundImageProviderId::NasaEpic).unwrap();
    assert_eq!(snapshot.resolved_for_key, "2026-07-30");
    assert!(
        normalize_provider_snapshot(Some(&value), BackgroundImageProviderId::NasaApodSafe)
            .is_none()
    );
}

#[test]
fn snapshot_freshness_uses_24h_ttl() {
    let mut snapshot = BackgroundImageSnapshot {
        mode: BackgroundImageMode::Daily,
        provider_id: Some(BackgroundImageProviderId::NasaEpic),
        source_kind: None,
        image_url: "https://example.com/a.jpg".into(),
        image_path: None,
        image_count: None,
        title: String::new(),
        author: String::new(),
        license: String::new(),
        source: String::new(),
        resolved_at: (Utc::now() - chrono::Duration::hours(23)).to_rfc3339(),
        resolved_for_key: "2026-07-30".into(),
    };
    assert!(is_snapshot_fresh(Some(&snapshot)));
    snapshot.resolved_at = (Utc::now() - chrono::Duration::hours(25)).to_rfc3339();
    assert!(!is_snapshot_fresh(Some(&snapshot)));
    snapshot.resolved_at = String::new();
    assert!(!is_snapshot_fresh(Some(&snapshot)));
    assert!(!is_snapshot_fresh(None));
}

#[test]
fn rotation_delay_uses_relative_minutes() {
    assert_eq!(rotation_delay(1), Duration::from_secs(60));
    assert_eq!(rotation_delay(180), Duration::from_secs(3 * 60 * 60));
    assert_eq!(rotation_delay(1440), Duration::from_secs(24 * 60 * 60));
}

#[test]
fn custom_image_rotation_randomly_excludes_the_current_image() {
    let source = files_custom_source(&["a.png", "b.png", "c.png"]);
    let files = source.paths.clone();
    for _ in 0..32 {
        let index = random_custom_image_index(&source, &files, Some(&custom_snapshot("B.PNG")));
        assert!(index < files.len());
        assert_ne!(index, 1);
    }
    assert!(
        random_custom_image_index(&source, &files, Some(&custom_snapshot("deleted.png")))
            < files.len()
    );
}

#[test]
fn selected_files_assertions_detect_missing_paths() {
    let source = files_custom_source(&["C:\\img\\A.png", "C:\\img\\b.png"]);
    let files = vec!["c:\\img\\a.png".to_string(), "C:\\img\\b.png".to_string()];
    assert!(assert_selected_files_available(&source, &files).is_ok());
    assert!(assert_selected_files_available(&source, &files[..1]).is_err());
}

#[test]
fn automatic_refresh_cannot_overwrite_a_user_operation() {
    assert!(!projection_update_is_current(2, 1, 4, Some(4)));
    assert!(!projection_update_is_current(2, 2, 5, Some(4)));
    assert!(projection_update_is_current(2, 2, 4, Some(4)));
    assert!(projection_update_is_current(2, 2, 5, None));
}
