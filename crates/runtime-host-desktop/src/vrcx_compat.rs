//! Fork: VRCX compatibility. The IPC pipe lets programs built for VRCX add
//! custom user tags, Game Log entries and launch commands; Persistent World
//! Info stores the values worlds write with `[VRCX-World]` log lines and
//! serves them back on 127.0.0.1. Both are off by default.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use vrcx_0_application_core::{ConfigStore, RuntimeAuthScope, RuntimeEventBus};
use vrcx_0_application_game::{GameLogEventOrigin, GameLogEventSink};
use vrcx_0_core::game_log_parser::{GameLogEvent, GameLogEventKind};
use vrcx_0_vrcx_compat::{
    IpcHandler, IpcInboundMessage, IpcServer, WorldDataService, DEFAULT_WORLD_DATA_PORT,
};
pub use vrcx_0_vrcx_compat::{
    IpcSettings, IpcStatus, WorldDataEntry, WorldDataImportReport, WorldDataSettings,
    WorldDataStatus, WorldDataWorld,
};

use crate::GameLogHostRuntime;

pub const VRCX_IPC_ENABLED_CONFIG_KEY: &str = "vrcxIpcEnabled";
pub const VRCX_IPC_PIPE_NAME_CONFIG_KEY: &str = "vrcxIpcPipeName";
pub const VRCX_IPC_SOCKET_PATH_CONFIG_KEY: &str = "vrcxIpcSocketPath";
pub const VRCX_WORLD_DATA_ENABLED_CONFIG_KEY: &str = "vrcxWorldDataEnabled";
pub const VRCX_WORLD_DATA_PORT_CONFIG_KEY: &str = "vrcxWorldDataPort";

/// A tag another program asked to show next to a user, drawn as a custom
/// badge. Kept in memory only, like VRCX. `id` is empty for VRCX's one tag
/// per user; `icon` is empty when the program did not choose one.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrcxCustomTag {
    pub user_id: String,
    pub id: String,
    pub tag: String,
    pub colour: String,
    pub icon: String,
}

type TagKey = (String, String);

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VrcxCustomTagsPayload {
    pub tags: Vec<VrcxCustomTag>,
}

vrcx_0_contracts::runtime_event_payload!(VrcxCustomTagsPayload, "vrcxCustomTags");

pub type LaunchCommandHandler = Arc<dyn Fn(String) + Send + Sync>;

struct IpcBridge {
    event_bus: RuntimeEventBus,
    auth_scope: RuntimeAuthScope,
    game_log: OnceLock<Arc<GameLogHostRuntime>>,
    custom_tags: Mutex<BTreeMap<TagKey, VrcxCustomTag>>,
    launch_command: OnceLock<LaunchCommandHandler>,
}

impl IpcBridge {
    fn tags(&self) -> std::sync::MutexGuard<'_, BTreeMap<TagKey, VrcxCustomTag>> {
        self.custom_tags
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    fn snapshot(&self) -> Vec<VrcxCustomTag> {
        self.tags().values().cloned().collect()
    }

    fn publish_tags(&self) {
        self.event_bus.emit(VrcxCustomTagsPayload {
            tags: self.snapshot(),
        });
    }

    fn signed_in(&self) -> bool {
        let scope = self.auth_scope.snapshot();
        scope.active && !scope.current_user_id.trim().is_empty()
    }

    fn ingest(&self, kind: GameLogEventKind) {
        // VRCX ignores these while nobody is signed in.
        if !self.signed_in() {
            return;
        }
        let Some(game_log) = self.game_log.get() else {
            return;
        };
        let event = GameLogEvent {
            file_name: String::new(),
            created_at: vrcx_0_core::time::now_epoch(),
            kind,
        };
        if let Err(error) =
            game_log.ingest_game_log_events_with_origin(&[event], GameLogEventOrigin::Live)
        {
            tracing::warn!(error = %error, "failed to add a VRCX IPC entry to the Game Log");
        }
    }
}

impl IpcHandler for IpcBridge {
    fn on_message(&self, message: IpcInboundMessage) {
        match message {
            IpcInboundMessage::CustomTag {
                user_id,
                tag,
                tag_colour,
                icon,
                tag_id,
            } => {
                {
                    let mut tags = self.tags();
                    let key = (user_id.clone(), tag_id.trim().to_string());
                    if tag.trim().is_empty() {
                        tags.remove(&key);
                    } else {
                        let id = key.1.clone();
                        tags.insert(
                            key,
                            VrcxCustomTag {
                                user_id,
                                id,
                                tag,
                                colour: tag_colour,
                                icon: icon.trim().to_string(),
                            },
                        );
                    }
                }
                self.publish_tags();
            }
            IpcInboundMessage::ClearCustomTags => {
                self.tags().clear();
                self.publish_tags();
            }
            IpcInboundMessage::Noty { data } => {
                self.ingest(GameLogEventKind::Event { data });
            }
            IpcInboundMessage::External {
                data,
                display_name,
                user_id,
                notify,
            } => {
                self.ingest(GameLogEventKind::External {
                    data,
                    display_name,
                    user_id,
                    silent: !notify,
                });
            }
            IpcInboundMessage::LaunchCommand { command } => {
                if !self.signed_in() {
                    return;
                }
                if let Some(handler) = self.launch_command.get() {
                    handler(command);
                }
            }
        }
    }
}

pub struct DesktopVrcxCompatRuntime {
    config: Arc<dyn ConfigStore>,
    bridge: Arc<IpcBridge>,
    ipc: IpcServer,
    world_data: Arc<WorldDataService>,
}

impl DesktopVrcxCompatRuntime {
    pub(crate) fn new(
        config: Arc<dyn ConfigStore>,
        event_bus: RuntimeEventBus,
        auth_scope: RuntimeAuthScope,
        world_data: Arc<WorldDataService>,
    ) -> Self {
        let bridge = Arc::new(IpcBridge {
            event_bus,
            auth_scope,
            game_log: OnceLock::new(),
            custom_tags: Mutex::new(BTreeMap::new()),
            launch_command: OnceLock::new(),
        });
        Self {
            config,
            ipc: IpcServer::new(Arc::clone(&bridge) as Arc<dyn IpcHandler>),
            bridge,
            world_data,
        }
    }

    pub(crate) fn attach_game_log(&self, game_log: Arc<GameLogHostRuntime>) {
        let _ = self.bridge.game_log.set(game_log);
    }

    /// Where IPC launch commands such as `world/wrld_...` go; set once by the
    /// app shell.
    pub fn set_launch_command_handler(&self, handler: LaunchCommandHandler) {
        let _ = self.bridge.launch_command.set(handler);
    }

    fn read_ipc_settings(&self) -> IpcSettings {
        IpcSettings {
            enabled: self
                .config
                .get_bool(VRCX_IPC_ENABLED_CONFIG_KEY, false)
                .unwrap_or(false),
            pipe_name: self
                .config
                .get_string(VRCX_IPC_PIPE_NAME_CONFIG_KEY, "")
                .unwrap_or_default(),
            socket_path: self
                .config
                .get_string(VRCX_IPC_SOCKET_PATH_CONFIG_KEY, "")
                .unwrap_or_default(),
        }
    }

    fn read_world_data_settings(&self) -> WorldDataSettings {
        let port = self
            .config
            .get_string(
                VRCX_WORLD_DATA_PORT_CONFIG_KEY,
                &DEFAULT_WORLD_DATA_PORT.to_string(),
            )
            .ok()
            .and_then(|value| value.trim().parse::<u16>().ok())
            .filter(|port| *port >= 1024)
            .unwrap_or(DEFAULT_WORLD_DATA_PORT);
        WorldDataSettings {
            enabled: self
                .config
                .get_bool(VRCX_WORLD_DATA_ENABLED_CONFIG_KEY, false)
                .unwrap_or(false),
            port,
        }
    }

    pub async fn start_from_config(&self) {
        let ipc = self.read_ipc_settings();
        if ipc.enabled {
            self.ipc.apply_settings(ipc).await;
        }
        let world_data = self.read_world_data_settings();
        if world_data.enabled {
            self.world_data.apply_settings(world_data).await;
        }
    }

    pub async fn stop(&self) {
        self.ipc.stop().await;
        self.world_data.stop().await;
    }

    pub async fn ipc_status(&self) -> IpcStatus {
        let mut status = self.ipc.status().await;
        if !status.running && status.error.is_none() {
            let settings = self.read_ipc_settings();
            status.enabled = settings.enabled;
            status.address = settings.address();
            status.default_socket_path =
                vrcx_0_vrcx_compat::default_ipc_socket_path(&settings.effective_pipe_name());
            status.pipe_name = settings.pipe_name;
            status.socket_path = settings.socket_path;
        }
        status
    }

    pub async fn set_ipc_settings(&self, settings: IpcSettings) -> crate::Result<IpcStatus> {
        let settings = IpcSettings {
            enabled: settings.enabled,
            pipe_name: settings.pipe_name.trim().to_string(),
            socket_path: settings.socket_path.trim().to_string(),
        };
        if settings
            .pipe_name
            .chars()
            .any(|ch| ch == '\\' || ch == '/' || ch.is_control())
        {
            return Err(vrcx_0_application_core::Error::Custom(
                "The pipe name cannot contain slashes.".into(),
            )
            .into());
        }
        self.config
            .set_bool(VRCX_IPC_ENABLED_CONFIG_KEY, settings.enabled)?;
        self.config
            .set_string(VRCX_IPC_PIPE_NAME_CONFIG_KEY, &settings.pipe_name)?;
        self.config
            .set_string(VRCX_IPC_SOCKET_PATH_CONFIG_KEY, &settings.socket_path)?;
        if !settings.enabled {
            self.bridge.tags().clear();
            self.bridge.publish_tags();
        }
        Ok(self.ipc.apply_settings(settings).await)
    }

    pub fn custom_tags(&self) -> Vec<VrcxCustomTag> {
        self.bridge.snapshot()
    }

    pub fn announce_user_dialog(&self, user_id: &str) {
        if !user_id.trim().is_empty() {
            self.ipc.announce_user_dialog(user_id.trim());
        }
    }

    pub async fn world_data_status(&self) -> WorldDataStatus {
        let mut status = self.world_data.status().await;
        if !status.running && status.error.is_none() {
            let settings = self.read_world_data_settings();
            status.enabled = settings.enabled;
            status.port = settings.port;
        }
        status
    }

    pub async fn set_world_data_settings(
        &self,
        settings: WorldDataSettings,
    ) -> crate::Result<WorldDataStatus> {
        if settings.port < 1024 {
            return Err(vrcx_0_application_core::Error::Custom(
                "Choose a port from 1024 to 65535.".into(),
            )
            .into());
        }
        self.config
            .set_bool(VRCX_WORLD_DATA_ENABLED_CONFIG_KEY, settings.enabled)?;
        self.config
            .set_string(VRCX_WORLD_DATA_PORT_CONFIG_KEY, &settings.port.to_string())?;
        Ok(self.world_data.apply_settings(settings).await)
    }

    pub fn world_data_worlds(&self) -> crate::Result<Vec<WorldDataWorld>> {
        self.world_data
            .list_worlds()
            .map_err(|error| vrcx_0_application_core::Error::Custom(error).into())
    }

    pub fn world_data_entries(&self, world_id: &str) -> crate::Result<Vec<WorldDataEntry>> {
        self.world_data
            .list_entries(world_id)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error).into())
    }

    /// VRCX's `VRCX-WorldData.db`, if VRCX's data folder has one.
    pub fn vrcx_world_data_file(&self) -> Option<String> {
        vrcx_0_outbound_adapters::vrcx_world_data_file().map(|path| path.display().to_string())
    }

    /// Merges VRCX's world data file, or `path` when given, into this app's.
    pub async fn import_world_data(
        &self,
        path: Option<String>,
    ) -> crate::Result<WorldDataImportReport> {
        let source = match path.map(|path| path.trim().to_string()) {
            Some(path) if !path.is_empty() => std::path::PathBuf::from(path),
            _ => vrcx_0_outbound_adapters::vrcx_world_data_file().ok_or_else(|| {
                vrcx_0_application_core::Error::Custom("No VRCX world data found.".into())
            })?,
        };
        let world_data = Arc::clone(&self.world_data);
        tokio::task::spawn_blocking(move || world_data.import_file(&source))
            .await
            .map_err(|error| {
                vrcx_0_application_core::Error::Custom(format!("import task failed: {error}"))
            })?
            .map_err(|error| vrcx_0_application_core::Error::Custom(error).into())
    }

    pub fn forget_world_data(&self, world_id: &str) -> crate::Result<()> {
        self.world_data
            .forget_world(world_id)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error).into())
    }
}
