use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_contracts::community_theme_protocol as protocol;
use vrcx_0_contracts::ConfigMutation;

use super::super::ProfileConfigStore;
use vrcx_0_application_core::Result;

use super::types::{CommunityThemeInstallMetadata, CommunityThemeProjection};

const KEY_ENABLED: &str = "VRCX_communityThemeEnabled";
const KEY_ID: &str = "VRCX_communityThemeId";
const KEY_VERSION: &str = "VRCX_communityThemeVersion";
const KEY_CSS_SNAPSHOT: &str = "VRCX_communityThemeCssSnapshot";
const KEY_OVERRIDE_CSS: &str = "VRCX_communityThemeOverrideCss";
pub(super) const KEY_OVERRIDE_ENABLED: &str = "VRCX_communityThemeOverrideEnabled";
const KEY_INSTALL_METADATA: &str = "VRCX_communityThemeInstallMetadata";
const KEY_INSTALLED_THEMES: &str = "VRCX_communityThemeInstalledThemes";
pub(super) const KEY_LEGACY_CATALOG_URL: &str = "VRCX_themeMarketplaceCatalogUrl";
const LEGACY_NASA_APOD_WALLPAPER_THEME_ID: &str = "nasa-apod-wallpaper";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CommunityThemeInstalledRecord {
    #[serde(flatten)]
    pub(super) metadata: CommunityThemeInstallMetadata,
    pub(super) css_snapshot: String,
}

pub(super) struct PersistedCommunityThemeState {
    pub(super) records: Vec<CommunityThemeInstalledRecord>,
    pub(super) active_record: Option<CommunityThemeInstalledRecord>,
    pub(super) override_css: String,
    pub(super) override_css_enabled: bool,
    pub(super) legacy_apod_was_active: bool,
}

pub(super) fn empty_projection() -> CommunityThemeProjection {
    CommunityThemeProjection {
        revision: 0,
        catalog_url: protocol::COMMUNITY_THEME_CATALOG_URL.into(),
        enabled: false,
        installed_theme: None,
        installed_themes: Vec::new(),
        installed_css_snapshot: String::new(),
        override_css: String::new(),
        override_css_enabled: false,
        updates: Vec::new(),
    }
}

pub(super) fn load_persisted_state(
    config: &dyn ProfileConfigStore,
) -> Result<PersistedCommunityThemeState> {
    let enabled = config.get_bool(KEY_ENABLED, false)?;
    let active_theme_id = config.get_string(KEY_ID, "")?;
    let legacy_metadata_value = config.get_json(KEY_INSTALL_METADATA, Value::Null)?;
    let legacy_metadata = normalize_install_metadata(&legacy_metadata_value);
    let legacy_css_snapshot = config.get_string(KEY_CSS_SNAPSHOT, "")?;
    let installed_value = config.get_json(KEY_INSTALLED_THEMES, Value::Null)?;
    let mut records = installed_value
        .as_array()
        .map(|entries| {
            entries
                .iter()
                .filter_map(normalize_install_record)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Some(metadata) = legacy_metadata.clone() {
        if !legacy_css_snapshot.trim().is_empty() {
            merge_install_record(
                &mut records,
                CommunityThemeInstalledRecord {
                    metadata,
                    css_snapshot: legacy_css_snapshot,
                },
            );
        }
    }
    records.retain(is_current_install_record);
    let legacy_apod_was_active = enabled
        && (active_theme_id == LEGACY_NASA_APOD_WALLPAPER_THEME_ID
            || legacy_metadata
                .as_ref()
                .is_some_and(|metadata| metadata.theme_id == LEGACY_NASA_APOD_WALLPAPER_THEME_ID));
    records.retain(|record| record.metadata.theme_id != LEGACY_NASA_APOD_WALLPAPER_THEME_ID);
    let active_record = enabled
        .then(|| {
            records
                .iter()
                .find(|record| record.metadata.theme_id == active_theme_id)
                .or_else(|| {
                    legacy_metadata.as_ref().and_then(|metadata| {
                        records
                            .iter()
                            .find(|record| record.metadata.theme_id == metadata.theme_id)
                    })
                })
                .cloned()
        })
        .flatten();
    let override_css = config.get_string(KEY_OVERRIDE_CSS, "")?;
    let override_css_enabled = !override_css.trim().is_empty()
        && config.get_raw(KEY_OVERRIDE_ENABLED)?.is_none_or(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "true" | "1" | "\"true\""
            )
        });
    Ok(PersistedCommunityThemeState {
        records,
        active_record,
        override_css,
        override_css_enabled,
        legacy_apod_was_active,
    })
}

fn normalize_install_record(value: &Value) -> Option<CommunityThemeInstalledRecord> {
    let metadata = normalize_install_metadata(value)?;
    let css_snapshot = config_text(value.get("cssSnapshot"));
    if css_snapshot.trim().is_empty() {
        return None;
    }
    Some(CommunityThemeInstalledRecord {
        metadata,
        css_snapshot,
    })
}

fn normalize_install_metadata(value: &Value) -> Option<CommunityThemeInstallMetadata> {
    let entry = value.as_object()?;
    let theme_id = config_text(entry.get("themeId"));
    let theme_name = config_text(entry.get("themeName"));
    let version = config_text(entry.get("version"));
    if theme_id.is_empty()
        || theme_name.is_empty()
        || version.is_empty()
        || !protocol::is_community_theme_id(&theme_id)
    {
        return None;
    }
    Some(CommunityThemeInstallMetadata {
        theme_id,
        theme_name,
        version,
        source_url: config_text(entry.get("sourceUrl")),
        sha256: config_text(entry.get("sha256")),
        installed_at: config_text(entry.get("installedAt")),
        updated_at: config_text(entry.get("updatedAt")),
        dark_mode: entry.get("darkMode").and_then(Value::as_bool) != Some(false),
        accent_mode: entry.get("accentMode").and_then(Value::as_bool) == Some(true)
            || entry.get("accentMode").and_then(Value::as_str) == Some("app"),
    })
}

fn is_current_install_record(record: &CommunityThemeInstalledRecord) -> bool {
    protocol::community_theme_asset_url(
        &record.metadata.theme_id,
        protocol::COMMUNITY_THEME_CSS_FILE_NAME,
    )
    .is_ok_and(|source_url| source_url == record.metadata.source_url)
}

pub(super) fn merge_install_record(
    records: &mut Vec<CommunityThemeInstalledRecord>,
    record: CommunityThemeInstalledRecord,
) {
    if let Some(existing) = records
        .iter_mut()
        .find(|existing| existing.metadata.theme_id == record.metadata.theme_id)
    {
        *existing = record;
    } else {
        records.push(record);
    }
}

pub(super) fn install_state_mutations(
    records: &[CommunityThemeInstalledRecord],
    active_record: Option<&CommunityThemeInstalledRecord>,
) -> Result<Vec<ConfigMutation>> {
    let mut mutations = vec![ConfigMutation::set(
        KEY_ENABLED,
        active_record.is_some().to_string(),
    )];
    if records.is_empty() {
        mutations.push(ConfigMutation::remove(KEY_INSTALLED_THEMES));
    } else {
        mutations.push(ConfigMutation::set(
            KEY_INSTALLED_THEMES,
            serde_json::to_string(records)?,
        ));
    }
    match active_record {
        Some(record) => {
            mutations.extend([
                ConfigMutation::set(KEY_ID, &record.metadata.theme_id),
                ConfigMutation::set(KEY_VERSION, &record.metadata.version),
                ConfigMutation::set(KEY_CSS_SNAPSHOT, &record.css_snapshot),
                ConfigMutation::set(
                    KEY_INSTALL_METADATA,
                    serde_json::to_string(&record.metadata)?,
                ),
            ]);
        }
        None => {
            mutations.extend([
                ConfigMutation::remove(KEY_ID),
                ConfigMutation::remove(KEY_VERSION),
                ConfigMutation::remove(KEY_CSS_SNAPSHOT),
                ConfigMutation::remove(KEY_INSTALL_METADATA),
            ]);
        }
    }
    Ok(mutations)
}

pub(super) fn override_state_mutations(css_text: &str, enabled: bool) -> Vec<ConfigMutation> {
    vec![
        ConfigMutation::set(KEY_OVERRIDE_CSS, css_text),
        ConfigMutation::set(KEY_OVERRIDE_ENABLED, enabled.to_string()),
    ]
}

pub(super) fn projection_from_state(
    state: &PersistedCommunityThemeState,
) -> CommunityThemeProjection {
    CommunityThemeProjection {
        revision: 0,
        catalog_url: protocol::COMMUNITY_THEME_CATALOG_URL.into(),
        enabled: state.active_record.is_some(),
        installed_theme: state
            .active_record
            .as_ref()
            .map(|record| record.metadata.clone()),
        installed_themes: state
            .records
            .iter()
            .map(|record| record.metadata.clone())
            .collect(),
        installed_css_snapshot: state
            .active_record
            .as_ref()
            .map(|record| record.css_snapshot.clone())
            .unwrap_or_default(),
        override_css: state.override_css.clone(),
        override_css_enabled: state.override_css_enabled,
        updates: Vec::new(),
    }
}

fn config_text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}
