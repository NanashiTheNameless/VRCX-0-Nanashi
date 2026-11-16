use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

/// VRCX ends every packet with a NUL character.
const PACKET_END: u8 = 0;
/// VRCX's packet buffer; a client sending more without a packet end is dropped.
const MAX_PACKET_BYTES: usize = 1024 * 1024;
/// VRCX skips `Noty` packets from external notifiers newer than this version,
/// which deliver their notifications another way.
const NOTIFIER_VERSION_HANDLING_NOTY: u64 = 21;
const START_ANNOUNCE_DELAY: Duration = Duration::from_secs(3);

/// VRCX's pipe name: `vrcx-ipc-` followed by the sum of the user name's
/// UTF-16 code units, so tools that compute it the same way find this app.
pub fn default_ipc_pipe_name() -> String {
    let user = std::env::var(if cfg!(windows) { "USERNAME" } else { "USER" }).unwrap_or_default();
    let hash: u64 = user.encode_utf16().map(u64::from).sum();
    format!("vrcx-ipc-{hash}")
}

/// Where .NET puts a named pipe on Linux and macOS: a Unix socket called
/// `CoreFxPipe_<name>` in the temporary folder.
pub fn default_ipc_socket_path(pipe_name: &str) -> String {
    std::env::temp_dir()
        .join(format!("CoreFxPipe_{pipe_name}"))
        .to_string_lossy()
        .into_owned()
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcSettings {
    pub enabled: bool,
    /// Empty means `default_ipc_pipe_name()`.
    pub pipe_name: String,
    /// Linux and macOS only. Empty means the socket .NET would use for the
    /// pipe name.
    pub socket_path: String,
}

impl IpcSettings {
    pub fn effective_pipe_name(&self) -> String {
        let name = self.pipe_name.trim();
        if name.is_empty() {
            default_ipc_pipe_name()
        } else {
            name.to_string()
        }
    }

    /// The address the server listens on: `\\.\pipe\<name>` on Windows, the
    /// socket path elsewhere.
    pub fn address(&self) -> String {
        if cfg!(windows) {
            format!(r"\\.\pipe\{}", self.effective_pipe_name())
        } else {
            let path = self.socket_path.trim();
            if path.is_empty() {
                default_ipc_socket_path(&self.effective_pipe_name())
            } else {
                path.to_string()
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcStatus {
    pub enabled: bool,
    pub running: bool,
    /// As configured; empty means the default.
    pub pipe_name: String,
    /// As configured; empty means the default.
    pub socket_path: String,
    pub address: String,
    pub default_pipe_name: String,
    pub default_socket_path: String,
    pub connected_clients: u32,
    pub error: Option<String>,
}

/// What another program asked for, in VRCX's terms.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IpcInboundMessage {
    /// Show `tag` next to the user as a badge; an empty tag removes it.
    /// `icon` and `tag_id` are this app's additions: a badge icon, and an id
    /// so one program can give a user several badges. VRCX sends neither.
    CustomTag {
        user_id: String,
        tag: String,
        tag_colour: String,
        icon: String,
        tag_id: String,
    },
    ClearCustomTags,
    /// A Game Log event line, with a notification.
    Noty {
        data: String,
    },
    /// A Game Log entry attributed to a user.
    External {
        data: String,
        display_name: String,
        user_id: String,
        notify: bool,
    },
    /// A VRCX launch command such as `world/wrld_...`.
    LaunchCommand {
        command: String,
    },
}

pub trait IpcHandler: Send + Sync {
    fn on_message(&self, message: IpcInboundMessage);
}

enum ParsedPacket {
    Message(IpcInboundMessage),
    NotifierPing(u64),
    Ignored,
}

/// The first of `keys` that is present, for fields with spelling variants.
fn text_any(object: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    keys.iter()
        .map(|key| text(object, key))
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

fn text(object: &serde_json::Map<String, Value>, key: &str) -> String {
    match object.get(key) {
        Some(Value::String(value)) => value.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn parse_packet(packet: &str) -> ParsedPacket {
    let Ok(Value::Object(object)) = serde_json::from_str::<Value>(packet) else {
        tracing::debug!("ignored an IPC packet that is not a JSON object");
        return ParsedPacket::Ignored;
    };
    let packet_type = {
        let lower = text(&object, "type");
        if lower.is_empty() {
            text(&object, "Type")
        } else {
            lower
        }
    };
    match packet_type.as_str() {
        "VrcxMessage" => parse_vrcx_message(&object),
        "LaunchCommand" => {
            let command = text(&object, "command");
            if command.trim().is_empty() {
                ParsedPacket::Ignored
            } else {
                ParsedPacket::Message(IpcInboundMessage::LaunchCommand { command })
            }
        }
        "MsgPing" => object
            .get("version")
            .and_then(|version| {
                version
                    .as_u64()
                    .or_else(|| version.as_str().and_then(|text| text.trim().parse().ok()))
            })
            .map_or(ParsedPacket::Ignored, ParsedPacket::NotifierPing),
        _ => ParsedPacket::Ignored,
    }
}

fn parse_vrcx_message(object: &serde_json::Map<String, Value>) -> ParsedPacket {
    let message = match text(object, "MsgType").as_str() {
        "CustomTag" => {
            let user_id = text(object, "UserId");
            if user_id.trim().is_empty() {
                return ParsedPacket::Ignored;
            }
            IpcInboundMessage::CustomTag {
                user_id,
                tag: text(object, "Tag"),
                tag_colour: text_any(object, &["TagColour", "TagColor", "Color"]),
                icon: text(object, "Icon"),
                tag_id: text_any(object, &["Id", "TagId"]),
            }
        }
        "ClearCustomTags" => IpcInboundMessage::ClearCustomTags,
        "Noty" => IpcInboundMessage::Noty {
            data: text(object, "Data"),
        },
        "External" => IpcInboundMessage::External {
            data: text(object, "Data"),
            display_name: text(object, "DisplayName"),
            user_id: text(object, "UserId"),
            notify: object
                .get("notify")
                .and_then(Value::as_bool)
                .unwrap_or(true),
        },
        _ => return ParsedPacket::Ignored,
    };
    ParsedPacket::Message(message)
}

/// VRCX's outgoing packet: `Type`, `Data` and `MsgType`, PascalCase.
#[derive(Serialize)]
struct OutboundPacket<'a> {
    #[serde(rename = "Type")]
    packet_type: &'a str,
    #[serde(rename = "Data")]
    data: Option<&'a str>,
    #[serde(rename = "MsgType")]
    msg_type: &'a str,
}

fn encode_packet(packet: &OutboundPacket<'_>) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(packet).unwrap_or_default();
    bytes.push(PACKET_END);
    bytes
}

#[derive(Default)]
struct Clients {
    next_id: AtomicU64,
    senders: Mutex<HashMap<u64, mpsc::UnboundedSender<Vec<u8>>>>,
}

impl Clients {
    fn senders(&self) -> MutexGuard<'_, HashMap<u64, mpsc::UnboundedSender<Vec<u8>>>> {
        self.senders
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    fn add(&self, sender: mpsc::UnboundedSender<Vec<u8>>) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.senders().insert(id, sender);
        id
    }

    fn remove(&self, id: u64) {
        self.senders().remove(&id);
    }

    fn count(&self) -> u32 {
        u32::try_from(self.senders().len()).unwrap_or(u32::MAX)
    }

    fn broadcast(&self, bytes: &[u8]) {
        self.senders()
            .retain(|_, sender| sender.send(bytes.to_vec()).is_ok());
    }

    fn clear(&self) {
        self.senders().clear();
    }
}

struct RunState {
    settings: IpcSettings,
    cancel: Option<CancellationToken>,
    error: Option<String>,
}

/// VRCX's IPC pipe. Off until `apply_settings` turns it on.
pub struct IpcServer {
    handler: Arc<dyn IpcHandler>,
    clients: Arc<Clients>,
    notifier_version: Arc<AtomicU64>,
    state: tokio::sync::Mutex<RunState>,
    /// Set when the pipe stopped accepting connections without being asked.
    listener_stopped: Arc<AtomicBool>,
}

#[derive(Clone)]
struct Connection {
    handler: Arc<dyn IpcHandler>,
    clients: Arc<Clients>,
    notifier_version: Arc<AtomicU64>,
    cancel: CancellationToken,
    listener_stopped: Arc<AtomicBool>,
}

impl Connection {
    fn listener_ended(&self) {
        if !self.cancel.is_cancelled() {
            self.listener_stopped.store(true, Ordering::Release);
            self.clients.clear();
        }
    }
}

impl IpcServer {
    pub fn new(handler: Arc<dyn IpcHandler>) -> Self {
        Self {
            handler,
            clients: Arc::new(Clients::default()),
            notifier_version: Arc::new(AtomicU64::new(0)),
            state: tokio::sync::Mutex::new(RunState {
                settings: IpcSettings::default(),
                cancel: None,
                error: None,
            }),
            listener_stopped: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn status(&self) -> IpcStatus {
        let state = self.state.lock().await;
        let stopped = self.listener_stopped.load(Ordering::Acquire);
        let default_pipe_name = default_ipc_pipe_name();
        IpcStatus {
            enabled: state.settings.enabled,
            running: state.cancel.is_some() && !stopped,
            pipe_name: state.settings.pipe_name.clone(),
            socket_path: state.settings.socket_path.clone(),
            address: state.settings.address(),
            default_socket_path: default_ipc_socket_path(&state.settings.effective_pipe_name()),
            default_pipe_name,
            connected_clients: self.clients.count(),
            error: if stopped && state.cancel.is_some() {
                Some("The pipe stopped accepting connections. Turn it off and on again.".into())
            } else {
                state.error.clone()
            },
        }
    }

    pub async fn apply_settings(&self, settings: IpcSettings) -> IpcStatus {
        let mut state = self.state.lock().await;
        if let Some(cancel) = state.cancel.take() {
            cancel.cancel();
        }
        self.clients.clear();
        state.error = None;
        if settings.enabled {
            let address = settings.address();
            let cancel = CancellationToken::new();
            self.listener_stopped.store(false, Ordering::Release);
            let connection = Connection {
                handler: Arc::clone(&self.handler),
                clients: Arc::clone(&self.clients),
                notifier_version: Arc::clone(&self.notifier_version),
                cancel: cancel.clone(),
                listener_stopped: Arc::clone(&self.listener_stopped),
            };
            match listen(&address, connection) {
                Ok(()) => {
                    tracing::info!(address = %address, "VRCX IPC pipe listening");
                    let clients = Arc::clone(&self.clients);
                    let announce_cancel = cancel.clone();
                    tokio::spawn(async move {
                        tokio::select! {
                            () = announce_cancel.cancelled() => {}
                            () = tokio::time::sleep(START_ANNOUNCE_DELAY) => {
                                clients.broadcast(&encode_packet(&OutboundPacket {
                                    packet_type: "VRCXLaunch",
                                    data: None,
                                    msg_type: "VRCXLaunch",
                                }));
                            }
                        }
                    });
                    state.cancel = Some(cancel);
                }
                Err(error) => {
                    tracing::warn!(address = %address, error = %error, "VRCX IPC pipe could not start");
                    state.error = Some(error);
                }
            }
        }
        state.settings = settings;
        drop(state);
        self.status().await
    }

    /// VRCX tells connected programs which user dialog is open.
    pub fn announce_user_dialog(&self, user_id: &str) {
        self.clients.broadcast(&encode_packet(&OutboundPacket {
            packet_type: "VrcxMessage",
            data: Some(user_id),
            msg_type: "ShowUserDialog",
        }));
    }

    pub async fn stop(&self) {
        if let Some(cancel) = self.state.lock().await.cancel.take() {
            cancel.cancel();
        }
        self.clients.clear();
    }
}

impl Connection {
    fn deliver(&self, packet: &str) {
        match parse_packet(packet) {
            ParsedPacket::NotifierPing(version) => {
                self.notifier_version.store(version, Ordering::Relaxed);
            }
            ParsedPacket::Message(IpcInboundMessage::Noty { .. })
                if self.notifier_version.load(Ordering::Relaxed)
                    > NOTIFIER_VERSION_HANDLING_NOTY => {}
            ParsedPacket::Message(message) => self.handler.on_message(message),
            ParsedPacket::Ignored => {}
        }
    }

    async fn run<S>(self, stream: S)
    where
        S: AsyncRead + AsyncWrite + Send + 'static,
    {
        let (mut reader, mut writer) = tokio::io::split(stream);
        let (sender, mut outbound) = mpsc::unbounded_channel::<Vec<u8>>();
        let id = self.clients.add(sender);
        let write_cancel = self.cancel.clone();
        let write_task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    () = write_cancel.cancelled() => break,
                    bytes = outbound.recv() => {
                        let Some(bytes) = bytes else { break };
                        if writer.write_all(&bytes).await.is_err() || writer.flush().await.is_err() {
                            break;
                        }
                    }
                }
            }
        });

        let mut pending = Vec::new();
        let mut chunk = [0_u8; 8 * 1024];
        loop {
            let read = tokio::select! {
                () = self.cancel.cancelled() => break,
                read = reader.read(&mut chunk) => read,
            };
            let Ok(read) = read else { break };
            if read == 0 {
                break;
            }
            pending.extend_from_slice(&chunk[..read]);
            while let Some(end) = pending.iter().position(|byte| *byte == PACKET_END) {
                let packet: Vec<u8> = pending.drain(..=end).collect();
                let text = String::from_utf8_lossy(&packet[..packet.len() - 1]);
                if !text.trim().is_empty() {
                    self.deliver(&text);
                }
            }
            if pending.len() > MAX_PACKET_BYTES {
                tracing::warn!("dropped an IPC client that sent an oversized packet");
                break;
            }
        }
        self.clients.remove(id);
        write_task.abort();
    }
}

#[cfg(windows)]
fn listen(address: &str, connection: Connection) -> Result<(), String> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let first = ServerOptions::new()
        .first_pipe_instance(true)
        .create(address)
        .map_err(|error| {
            if error.raw_os_error() == Some(5) || error.raw_os_error() == Some(231) {
                format!("{address} is already in use by another program, such as VRCX.")
            } else {
                format!("Could not open {address}: {error}")
            }
        })?;
    let address = address.to_string();
    tokio::spawn(async move {
        let mut server = first;
        loop {
            let connected = tokio::select! {
                () = connection.cancel.cancelled() => break,
                connected = server.connect() => connected,
            };
            if let Err(error) = connected {
                tracing::warn!(error = %error, "VRCX IPC pipe connection failed");
            }
            let next = match ServerOptions::new().create(&address) {
                Ok(next) => next,
                Err(error) => {
                    tracing::warn!(error = %error, "VRCX IPC pipe stopped accepting connections");
                    break;
                }
            };
            let client = std::mem::replace(&mut server, next);
            tokio::spawn(connection.clone().run(client));
        }
        connection.listener_ended();
    });
    Ok(())
}

#[cfg(unix)]
fn listen(address: &str, connection: Connection) -> Result<(), String> {
    use std::os::unix::fs::FileTypeExt;
    use std::path::PathBuf;

    let path = PathBuf::from(address);
    if let Ok(metadata) = std::fs::symlink_metadata(&path) {
        if !metadata.file_type().is_socket() {
            return Err(format!("{address} exists and is not a socket."));
        }
        if std::os::unix::net::UnixStream::connect(&path).is_ok() {
            return Err(format!(
                "{address} is already in use by another program, such as VRCX."
            ));
        }
        std::fs::remove_file(&path)
            .map_err(|error| format!("Could not replace the old socket {address}: {error}"))?;
    }
    let listener =
        bind_private_socket(&path).map_err(|error| format!("Could not open {address}: {error}"))?;
    tokio::spawn(async move {
        loop {
            let accepted = tokio::select! {
                () = connection.cancel.cancelled() => break,
                accepted = listener.accept() => accepted,
            };
            match accepted {
                Ok((stream, _)) => {
                    tokio::spawn(connection.clone().run(stream));
                }
                Err(error) => {
                    tracing::warn!(error = %error, "VRCX IPC socket connection failed");
                }
            }
        }
        connection.listener_ended();
        let _ = std::fs::remove_file(&path);
    });
    Ok(())
}

/// Binds the socket in a new folder only this user can enter, restricts the
/// socket to this user, then moves it to `path`. The socket is never
/// reachable by others, even in a shared folder such as /tmp, while the path
/// stays the one .NET programs look for.
#[cfg(unix)]
fn bind_private_socket(path: &std::path::Path) -> std::io::Result<tokio::net::UnixListener> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    let private_dir = parent.join(format!(".vrcx-ipc-{}", uuid::Uuid::new_v4().simple()));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&private_dir)?;
    let staged = private_dir.join("socket");
    let result = (|| {
        let listener = tokio::net::UnixListener::bind(&staged)?;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o600))?;
        std::fs::rename(&staged, path)?;
        Ok(listener)
    })();
    let _ = std::fs::remove_file(&staged);
    let _ = std::fs::remove_dir(&private_dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(packet: &str) -> Option<IpcInboundMessage> {
        match parse_packet(packet) {
            ParsedPacket::Message(message) => Some(message),
            _ => None,
        }
    }

    #[test]
    fn pipe_name_matches_vrcx() {
        let name = default_ipc_pipe_name();
        assert!(name.starts_with("vrcx-ipc-"));
        assert!(name["vrcx-ipc-".len()..].parse::<u64>().is_ok());
        assert!(default_ipc_socket_path("vrcx-ipc-1").ends_with("CoreFxPipe_vrcx-ipc-1"));
    }

    #[test]
    fn settings_fall_back_to_vrcx_defaults() {
        let settings = IpcSettings::default();
        assert_eq!(settings.effective_pipe_name(), default_ipc_pipe_name());
        let custom = IpcSettings {
            enabled: true,
            pipe_name: " my-pipe ".into(),
            socket_path: String::new(),
        };
        assert_eq!(custom.effective_pipe_name(), "my-pipe");
        if !cfg!(windows) {
            assert!(custom.address().ends_with("CoreFxPipe_my-pipe"));
            let with_path = IpcSettings {
                socket_path: "/run/user/1000/vrcx.sock".into(),
                ..custom
            };
            assert_eq!(with_path.address(), "/run/user/1000/vrcx.sock");
        }
    }

    #[test]
    fn parses_vrcx_messages() {
        assert_eq!(
            message(
                r##"{"type":"VrcxMessage","MsgType":"CustomTag","UserId":"usr_a","Tag":"Mod","TagColour":"#ff0000"}"##
            ),
            Some(IpcInboundMessage::CustomTag {
                user_id: "usr_a".into(),
                tag: "Mod".into(),
                tag_colour: "#ff0000".into(),
                icon: String::new(),
                tag_id: String::new(),
            })
        );
        assert_eq!(
            message(
                r##"{"type":"VrcxMessage","MsgType":"CustomTag","UserId":"usr_a","Tag":"Host","TagColor":"#00ff00","Icon":"Star","Id":"event"}"##
            ),
            Some(IpcInboundMessage::CustomTag {
                user_id: "usr_a".into(),
                tag: "Host".into(),
                tag_colour: "#00ff00".into(),
                icon: "Star".into(),
                tag_id: "event".into(),
            })
        );
        assert_eq!(
            message(r#"{"type":"VrcxMessage","MsgType":"ClearCustomTags"}"#),
            Some(IpcInboundMessage::ClearCustomTags)
        );
        assert_eq!(
            message(r#"{"Type":"VrcxMessage","MsgType":"Noty","Data":"hello"}"#),
            Some(IpcInboundMessage::Noty {
                data: "hello".into()
            })
        );
        assert_eq!(
            message(
                r#"{"type":"VrcxMessage","MsgType":"External","Data":"hi","DisplayName":"A","UserId":"usr_a","notify":false}"#
            ),
            Some(IpcInboundMessage::External {
                data: "hi".into(),
                display_name: "A".into(),
                user_id: "usr_a".into(),
                notify: false,
            })
        );
        assert_eq!(
            message(r#"{"type":"VrcxMessage","MsgType":"External","Data":"hi"}"#),
            Some(IpcInboundMessage::External {
                data: "hi".into(),
                display_name: String::new(),
                user_id: String::new(),
                notify: true,
            })
        );
        assert_eq!(
            message(r#"{"type":"LaunchCommand","command":"world/wrld_1"}"#),
            Some(IpcInboundMessage::LaunchCommand {
                command: "world/wrld_1".into()
            })
        );
    }

    #[test]
    fn ignores_photon_and_unknown_packets() {
        for packet in [
            r#"{"type":"OnEvent","OnEventData":{}}"#,
            r#"{"type":"Ping"}"#,
            r#"{"type":"VrcxMessage","MsgType":"Unknown"}"#,
            r#"{"type":"VrcxMessage","MsgType":"CustomTag","Tag":"no user"}"#,
            "[1,2,3]",
            "not json",
        ] {
            assert_eq!(message(packet), None, "{packet}");
        }
        assert!(matches!(
            parse_packet(r#"{"type":"MsgPing","version":22}"#),
            ParsedPacket::NotifierPing(22)
        ));
    }

    #[test]
    fn outbound_packets_use_vrcx_field_names() {
        let bytes = encode_packet(&OutboundPacket {
            packet_type: "VrcxMessage",
            data: Some("usr_a"),
            msg_type: "ShowUserDialog",
        });
        assert_eq!(bytes.last(), Some(&0));
        let value: Value = serde_json::from_slice(&bytes[..bytes.len() - 1]).unwrap();
        assert_eq!(value["Type"], "VrcxMessage");
        assert_eq!(value["Data"], "usr_a");
        assert_eq!(value["MsgType"], "ShowUserDialog");
    }

    #[derive(Default)]
    struct Recorder(Mutex<Vec<IpcInboundMessage>>);

    impl IpcHandler for Recorder {
        fn on_message(&self, message: IpcInboundMessage) {
            self.0.lock().unwrap().push(message);
        }
    }

    #[tokio::test]
    async fn connection_splits_packets_and_honors_notifier_version() {
        let recorder = Arc::new(Recorder::default());
        let connection = Connection {
            handler: recorder.clone(),
            clients: Arc::new(Clients::default()),
            notifier_version: Arc::new(AtomicU64::new(0)),
            cancel: CancellationToken::new(),
            listener_stopped: Arc::new(AtomicBool::new(false)),
        };
        let (mut client, server) = tokio::io::duplex(1024);
        let task = tokio::spawn(connection.clone().run(server));
        client
            .write_all(
                b"{\"type\":\"VrcxMessage\",\"MsgType\":\"Noty\",\"Data\":\"one\"}\0{\"type\":\"VrcxMes",
            )
            .await
            .unwrap();
        client
            .write_all(b"sage\",\"MsgType\":\"ClearCustomTags\"}\0{\"type\":\"MsgPing\",\"version\":30}\0{\"type\":\"VrcxMessage\",\"MsgType\":\"Noty\",\"Data\":\"two\"}\0")
            .await
            .unwrap();
        drop(client);
        task.await.unwrap();
        assert_eq!(
            *recorder.0.lock().unwrap(),
            vec![
                IpcInboundMessage::Noty { data: "one".into() },
                IpcInboundMessage::ClearCustomTags,
            ]
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_socket_is_only_for_this_user_and_accepts_clients() {
        use std::os::unix::fs::PermissionsExt;
        use tokio::io::AsyncWriteExt;

        let dir = std::env::temp_dir().join(format!("vrcx-ipc-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("CoreFxPipe_test");
        let recorder = Arc::new(Recorder::default());
        let server = IpcServer::new(recorder.clone());
        let status = server
            .apply_settings(IpcSettings {
                enabled: true,
                pipe_name: "test".into(),
                socket_path: path.to_string_lossy().into_owned(),
            })
            .await;
        assert!(status.running, "{:?}", status.error);
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);

        let mut client = tokio::net::UnixStream::connect(&path).await.unwrap();
        client
            .write_all(b"{\"type\":\"VrcxMessage\",\"MsgType\":\"ClearCustomTags\"}\0")
            .await
            .unwrap();
        for _ in 0..100 {
            if !recorder.0.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(
            *recorder.0.lock().unwrap(),
            vec![IpcInboundMessage::ClearCustomTags]
        );
        server.stop().await;
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[tokio::test]
    async fn announcements_reach_connected_clients() {
        let clients = Arc::new(Clients::default());
        let connection = Connection {
            handler: Arc::new(Recorder::default()),
            clients: Arc::clone(&clients),
            notifier_version: Arc::new(AtomicU64::new(0)),
            cancel: CancellationToken::new(),
            listener_stopped: Arc::new(AtomicBool::new(false)),
        };
        let (mut client, server) = tokio::io::duplex(1024);
        tokio::spawn(connection.run(server));
        while clients.count() == 0 {
            tokio::task::yield_now().await;
        }
        let server = IpcServer {
            handler: Arc::new(Recorder::default()),
            clients,
            notifier_version: Arc::new(AtomicU64::new(0)),
            state: tokio::sync::Mutex::new(RunState {
                settings: IpcSettings::default(),
                cancel: None,
                error: None,
            }),
            listener_stopped: Arc::new(AtomicBool::new(false)),
        };
        server.announce_user_dialog("usr_a");
        let mut buffer = vec![0_u8; 256];
        let read = client.read(&mut buffer).await.unwrap();
        let value: Value = serde_json::from_slice(&buffer[..read - 1]).unwrap();
        assert_eq!(value["MsgType"], "ShowUserDialog");
        assert_eq!(value["Data"], "usr_a");
    }
}
