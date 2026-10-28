use std::path::PathBuf;

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegacyMigrationProgress {
    DatabaseCopy {
        completed_pages: u64,
        total_pages: u64,
    },
    Configuration,
    Finalizing,
}

#[derive(Clone, Debug)]
pub struct LegacyMigrationPaths {
    pub app_data: PathBuf,
    pub db_file: PathBuf,
    pub config_file: PathBuf,
}

impl LegacyMigrationPaths {
    pub fn from_app_data(app_data: PathBuf) -> Self {
        Self {
            db_file: app_data.join("VRCX-0-Nanashi.sqlite3"),
            config_file: app_data.join("VRCX-0-Nanashi.json"),
            app_data,
        }
    }
}

#[derive(Clone, Debug)]
pub struct LegacyVrcxSource {
    pub db_path: PathBuf,
    pub config_path: Option<PathBuf>,
    pub version: i64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LegacyVrcxMigrationStatus {
    pub detected: bool,
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub db_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl LegacyVrcxMigrationStatus {
    pub fn unavailable() -> Self {
        Self {
            detected: false,
            available: false,
            version: None,
            db_path: None,
            config_path: None,
            reason: None,
        }
    }

    pub fn from_source(source: &LegacyVrcxSource) -> Self {
        Self {
            detected: true,
            available: true,
            version: Some(source.version),
            db_path: Some(source.db_path.to_string_lossy().into_owned()),
            config_path: source
                .config_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            reason: None,
        }
    }

    pub fn blocked(source: Option<&LegacyVrcxSource>, reason: String) -> Self {
        Self {
            detected: true,
            available: false,
            version: source.map(|source| source.version),
            db_path: source.map(|source| source.db_path.to_string_lossy().into_owned()),
            config_path: source
                .and_then(|source| source.config_path.as_ref())
                .map(|path| path.to_string_lossy().into_owned()),
            reason: Some(reason),
        }
    }
}

#[derive(Clone, Debug)]
pub struct LegacyVrcxDiscovery {
    pub importable_source: Option<LegacyVrcxSource>,
    pub status: LegacyVrcxMigrationStatus,
}

impl LegacyVrcxDiscovery {
    pub fn without_source(status: LegacyVrcxMigrationStatus) -> Self {
        Self {
            importable_source: None,
            status,
        }
    }
}
