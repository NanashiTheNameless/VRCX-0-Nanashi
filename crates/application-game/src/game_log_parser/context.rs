use std::collections::HashSet;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct LogContext {
    pub(crate) position: u64,
    #[serde(flatten)]
    pub(crate) file_creation: crate::game_log_watcher::FileCreationStamp,
    #[serde(skip)]
    pub(crate) at_end: bool,
    #[serde(skip)]
    pub(crate) read_failed: bool,
    pub(super) recent_world_name: String,
    pub(super) location_destination: String,
    pub(super) video_errors: HashSet<String>,
    pub(super) shader_keywords_limit_reached: bool,
    pub(super) last_audio_device: String,
    pub(super) audio_device_changed: bool,
}

impl LogContext {
    pub(crate) fn new() -> Self {
        Self {
            position: 0,
            file_creation: Default::default(),
            at_end: true,
            read_failed: false,
            recent_world_name: String::new(),
            location_destination: String::new(),
            video_errors: HashSet::with_capacity(50),
            shader_keywords_limit_reached: false,
            last_audio_device: String::new(),
            audio_device_changed: false,
        }
    }
}
