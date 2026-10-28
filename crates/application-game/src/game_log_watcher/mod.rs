mod queue;
mod sink;
mod watcher;

pub use sink::{GameLogEventOrigin, GameLogEventSink};
pub use vrcx_0_core::game_log_parser::LogLocationSnapshot;
pub use watcher::{LogLocationSnapshotScanner, LogWatcher, NoopLogLocationSnapshotScanner};

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(from = "StoredFileCreationStamp")]
pub struct FileCreationStamp {
    #[serde(rename = "file_created_at_seconds")]
    pub seconds: Option<i64>,
    #[serde(rename = "file_creation_fraction")]
    pub fraction: Option<u32>,
}

#[derive(serde::Deserialize)]
struct StoredFileCreationStamp {
    file_created_at: Option<u64>,
    file_created_at_seconds: Option<i64>,
    file_creation_fraction: Option<u32>,
}

impl From<StoredFileCreationStamp> for FileCreationStamp {
    fn from(stored: StoredFileCreationStamp) -> Self {
        if let Some(seconds) = stored.file_created_at_seconds {
            Self {
                seconds: Some(seconds),
                fraction: Some(stored.file_creation_fraction.unwrap_or(0)),
            }
        } else if let Some(nanos) = stored.file_created_at {
            Self {
                seconds: Some((nanos / 1_000_000_000) as i64),
                fraction: Some((nanos % 1_000_000_000) as u32),
            }
        } else {
            Self::default()
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct GameLogScanCursor {
    pub file_name: String,
    pub start_position: u64,
    #[serde(flatten)]
    pub file_creation: FileCreationStamp,
    pub(crate) context: crate::game_log_parser::LogContext,
    #[serde(deserialize_with = "vrcx_0_contracts::epoch::de")]
    pub cutoff: i64,
    pub rebuild: bool,
}

#[cfg(test)]
mod tests;
