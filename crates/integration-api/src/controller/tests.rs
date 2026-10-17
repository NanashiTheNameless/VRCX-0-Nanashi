use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::*;

#[derive(Default)]
struct MemoryConfig {
    values: Mutex<HashMap<String, String>>,
}

impl IntegrationApiConfigStore for MemoryConfig {
    fn get_bool(&self, key: &str, default: bool) -> Result<bool, IntegrationApiError> {
        Ok(self
            .values
            .lock()
            .map_err(|error| IntegrationApiError::Config(error.to_string()))?
            .get(key)
            .and_then(|value| value.parse().ok())
            .unwrap_or(default))
    }

    fn get_string(&self, key: &str, default: &str) -> Result<String, IntegrationApiError> {
        Ok(self
            .values
            .lock()
            .map_err(|error| IntegrationApiError::Config(error.to_string()))?
            .get(key)
            .cloned()
            .unwrap_or_else(|| default.into()))
    }

    fn set_bool(&self, key: &str, value: bool) -> Result<(), IntegrationApiError> {
        self.set_string(key, if value { "true" } else { "false" })
    }

    fn set_string(&self, key: &str, value: &str) -> Result<(), IntegrationApiError> {
        self.values
            .lock()
            .map_err(|error| IntegrationApiError::Config(error.to_string()))?
            .insert(key.into(), value.into());
        Ok(())
    }
}

fn unused_port() -> u16 {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn controller(config: Arc<MemoryConfig>) -> IntegrationApiController {
    IntegrationApiController::new(config, "1.2.3".into()).unwrap()
}

async fn connect_stream(port: u16, token: &str) -> TcpStream {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let request = format!(
        "GET /v1/stream HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Protocol: vrcx0.integration.v1, vrcx0.integration.token.{token}\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = Vec::new();
    while !response.ends_with(b"\r\n\r\n") {
        let mut byte = [0_u8; 1];
        stream.read_exact(&mut byte).await.unwrap();
        response.push(byte[0]);
    }
    let response = String::from_utf8(response).unwrap().to_ascii_lowercase();
    assert!(response.starts_with("http/1.1 101"));
    assert!(response.contains("sec-websocket-protocol: vrcx0.integration.v1"));
    stream
}

async fn read_server_message(stream: &mut TcpStream) -> Value {
    let mut header = [0_u8; 2];
    stream.read_exact(&mut header).await.unwrap();
    assert_eq!(header[0] & 0x0f, 1);
    let mut length = u64::from(header[1] & 0x7f);
    if length == 126 {
        let mut bytes = [0_u8; 2];
        stream.read_exact(&mut bytes).await.unwrap();
        length = u64::from(u16::from_be_bytes(bytes));
    } else if length == 127 {
        let mut bytes = [0_u8; 8];
        stream.read_exact(&mut bytes).await.unwrap();
        length = u64::from_be_bytes(bytes);
    }
    let mut payload = vec![0_u8; usize::try_from(length).unwrap()];
    stream.read_exact(&mut payload).await.unwrap();
    serde_json::from_slice(&payload).unwrap()
}

async fn send_client_message(stream: &mut TcpStream, payload: &str) {
    let payload = payload.as_bytes();
    assert!(payload.len() < 126);
    let mask = [1_u8, 2, 3, 4];
    let mut frame = vec![0x81, 0x80 | u8::try_from(payload.len()).unwrap()];
    frame.extend_from_slice(&mask);
    frame.extend(
        payload
            .iter()
            .enumerate()
            .map(|(index, byte)| byte ^ mask[index % mask.len()]),
    );
    stream.write_all(&frame).await.unwrap();
}

#[tokio::test]
async fn enabled_service_waits_for_game_and_releases_port_after_stop() {
    let config = Arc::new(MemoryConfig::default());
    let port = unused_port();
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &port.to_string())
        .unwrap();
    let controller = controller(config);

    let waiting = controller.set_enabled(true).await.unwrap();
    assert_eq!(waiting.state, IntegrationApiServerState::WaitingForGame);
    let running = controller.set_game_running(true).await.unwrap();
    assert_eq!(running.state, IntegrationApiServerState::Running);
    let stopped = controller.set_game_running(false).await.unwrap();
    assert_eq!(stopped.state, IntegrationApiServerState::WaitingForGame);
    assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
}

#[tokio::test]
async fn occupied_port_keeps_enabled_false() {
    let occupied = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = occupied.local_addr().unwrap().port();
    let config = Arc::new(MemoryConfig::default());
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &port.to_string())
        .unwrap();
    let controller = controller(config.clone());
    controller.set_game_running(true).await.unwrap();

    assert!(matches!(
        controller.set_enabled(true).await,
        Err(IntegrationApiError::PortInUse { port: error_port }) if error_port == port
    ));
    assert!(!config
        .get_bool(INTEGRATION_API_ENABLED_CONFIG_KEY, false)
        .unwrap());
    let status = controller.status().await.unwrap();
    assert_eq!(status.state, IntegrationApiServerState::Error);
}

#[tokio::test]
async fn failed_running_port_change_preserves_listener_and_config() {
    let config = Arc::new(MemoryConfig::default());
    let first_port = unused_port();
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &first_port.to_string())
        .unwrap();
    let controller = controller(config.clone());
    controller.set_game_running(true).await.unwrap();
    let status = controller.set_enabled(true).await.unwrap();
    let mut stream = connect_stream(first_port, &status.token).await;
    assert_eq!(read_server_message(&mut stream).await["type"], "hello");
    assert_eq!(
        read_server_message(&mut stream).await["type"],
        "room.snapshot"
    );
    let occupied = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let occupied_port = occupied.local_addr().unwrap().port();

    assert!(matches!(
        controller.set_port(occupied_port).await,
        Err(IntegrationApiError::PortInUse { .. })
    ));
    assert_eq!(
        config
            .get_string(INTEGRATION_API_PORT_CONFIG_KEY, "")
            .unwrap(),
        first_port.to_string()
    );
    assert_eq!(
        controller.status().await.unwrap().state,
        IntegrationApiServerState::Running
    );
    assert!(std::net::TcpListener::bind(("127.0.0.1", first_port)).is_err());
    send_client_message(&mut stream, r#"{"type":"resync"}"#).await;
    assert_eq!(
        read_server_message(&mut stream).await["type"],
        "room.snapshot"
    );
    controller.set_enabled(false).await.unwrap();
}

#[tokio::test]
async fn successful_running_port_change_releases_old_listener() {
    let config = Arc::new(MemoryConfig::default());
    let first_port = unused_port();
    let second_port = unused_port();
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &first_port.to_string())
        .unwrap();
    let controller = controller(config);
    controller.set_game_running(true).await.unwrap();
    controller.set_enabled(true).await.unwrap();

    let changed = controller.set_port(second_port).await.unwrap();
    assert_eq!(changed.port, second_port);
    assert!(std::net::TcpListener::bind(("127.0.0.1", first_port)).is_ok());
    assert!(std::net::TcpListener::bind(("127.0.0.1", second_port)).is_err());
    controller.set_enabled(false).await.unwrap();
}

#[tokio::test]
async fn same_port_is_a_no_op() {
    let config = Arc::new(MemoryConfig::default());
    let port = unused_port();
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &port.to_string())
        .unwrap();
    let controller = controller(config.clone());

    let status = controller.set_port(port).await.unwrap();
    assert_eq!(status.port, port);
    assert_eq!(
        config
            .get_string(INTEGRATION_API_PORT_CONFIG_KEY, "")
            .unwrap(),
        port.to_string()
    );
}

#[tokio::test]
async fn stopped_port_change_probes_before_writing_config() {
    let config = Arc::new(MemoryConfig::default());
    let occupied = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let occupied_port = occupied.local_addr().unwrap().port();
    let original_port = unused_port();
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &original_port.to_string())
        .unwrap();
    let controller = controller(config.clone());

    assert!(matches!(
        controller.set_port(occupied_port).await,
        Err(IntegrationApiError::PortInUse { port }) if port == occupied_port
    ));
    assert_eq!(
        config
            .get_string(INTEGRATION_API_PORT_CONFIG_KEY, "")
            .unwrap(),
        original_port.to_string()
    );
}

#[tokio::test]
async fn automatic_start_failure_preserves_enabled_intent() {
    let occupied = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = occupied.local_addr().unwrap().port();
    let config = Arc::new(MemoryConfig::default());
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &port.to_string())
        .unwrap();
    config
        .set_bool(INTEGRATION_API_ENABLED_CONFIG_KEY, true)
        .unwrap();
    let controller = controller(config.clone());

    assert!(controller.set_game_running(true).await.is_err());
    assert!(config
        .get_bool(INTEGRATION_API_ENABLED_CONFIG_KEY, false)
        .unwrap());
    assert_eq!(
        controller.status().await.unwrap().state,
        IntegrationApiServerState::Error
    );
}

#[tokio::test]
async fn changing_port_retries_a_failed_automatic_start() {
    let occupied = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let occupied_port = occupied.local_addr().unwrap().port();
    let replacement_port = unused_port();
    let config = Arc::new(MemoryConfig::default());
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &occupied_port.to_string())
        .unwrap();
    config
        .set_bool(INTEGRATION_API_ENABLED_CONFIG_KEY, true)
        .unwrap();
    let controller = controller(config);

    assert!(controller.set_game_running(true).await.is_err());
    let status = controller.set_port(replacement_port).await.unwrap();
    assert_eq!(status.state, IntegrationApiServerState::Running);
    assert_eq!(status.port, replacement_port);
    assert!(std::net::TcpListener::bind(("127.0.0.1", replacement_port)).is_err());
    controller.set_enabled(false).await.unwrap();
}

#[tokio::test]
async fn stale_generation_cannot_publish_into_a_restarted_session() {
    let config = Arc::new(MemoryConfig::default());
    let port = unused_port();
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &port.to_string())
        .unwrap();
    let controller = controller(config);
    controller.set_game_running(true).await.unwrap();
    controller.set_enabled(true).await.unwrap();
    let previous_generation = controller.running_generation().await.unwrap();
    controller.set_enabled(false).await.unwrap();
    let status = controller.set_enabled(true).await.unwrap();

    assert!(
        !controller
            .publish_if_generation(
                previous_generation,
                Some(RoomState {
                    location: "wrld_stale:1".into(),
                    world_id: "wrld_stale".into(),
                    ..RoomState::default()
                }),
            )
            .await
    );
    let mut stream = connect_stream(port, &status.token).await;
    assert_eq!(read_server_message(&mut stream).await["type"], "hello");
    assert!(read_server_message(&mut stream).await["room"].is_null());
    controller.set_enabled(false).await.unwrap();
}

#[tokio::test]
async fn unexpected_listener_exit_moves_the_controller_to_error() {
    let config = Arc::new(MemoryConfig::default());
    let port = unused_port();
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &port.to_string())
        .unwrap();
    let controller = controller(config);
    controller.set_game_running(true).await.unwrap();
    controller.set_enabled(true).await.unwrap();
    let listener_id = controller.state.lock().await.handle.as_ref().unwrap().id;

    IntegrationApiController::record_listener_exit(
        Arc::clone(&controller.state),
        listener_id,
        IntegrationApiFailure {
            code: crate::types::IntegrationApiFailureCode::Io,
            message: "listener failed".into(),
            port: Some(port),
        },
    )
    .await;

    let status = controller.status().await.unwrap();
    assert_eq!(status.state, IntegrationApiServerState::Error);
    assert_eq!(status.last_error.unwrap().message, "listener failed");
    assert!(controller.running_generation().await.is_none());
}

#[tokio::test]
async fn stream_sends_initial_state_delta_resync_and_bye_before_releasing_port() {
    let config = Arc::new(MemoryConfig::default());
    let port = unused_port();
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &port.to_string())
        .unwrap();
    let controller = controller(config);
    controller.set_game_running(true).await.unwrap();
    let status = controller.set_enabled(true).await.unwrap();
    let mut stream = connect_stream(port, &status.token).await;

    assert_eq!(read_server_message(&mut stream).await["type"], "hello");
    let initial = read_server_message(&mut stream).await;
    assert_eq!(initial["type"], "room.snapshot");
    assert!(initial["room"].is_null());

    controller
        .publish(Some(RoomState {
            location: "wrld_a:1".into(),
            world_id: "wrld_a".into(),
            world_name: "World A".into(),
            ..RoomState::default()
        }))
        .await;
    let published = read_server_message(&mut stream).await;
    assert_eq!(published["type"], "room.snapshot");
    assert_eq!(published["room"]["worldId"], "wrld_a");

    controller
        .publish(Some(RoomState {
            location: "wrld_a:1".into(),
            world_id: "wrld_a".into(),
            world_name: "World A".into(),
            members: vec![crate::RoomMemberState {
                user_id: "usr_a".into(),
                display_name: "Alice".into(),
                ..crate::RoomMemberState::default()
            }],
            ..RoomState::default()
        }))
        .await;
    let joined = read_server_message(&mut stream).await;
    assert_eq!(joined["type"], "room.joined");
    assert_eq!(joined["members"][0]["userId"], "usr_a");

    send_client_message(&mut stream, r#"{"type":"resync"}"#).await;
    let resynced = read_server_message(&mut stream).await;
    assert_eq!(resynced["type"], "room.snapshot");
    assert_eq!(resynced["seq"], joined["seq"].as_u64().unwrap() + 1);

    controller.set_game_running(false).await.unwrap();
    assert_eq!(read_server_message(&mut stream).await["type"], "bye");
    assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
}

fn crowded_room(index: usize) -> RoomState {
    RoomState {
        location: format!("wrld_a:{index}"),
        world_id: "wrld_a".into(),
        world_name: "Crowded".into(),
        members: (0..4_000)
            .map(|index| crate::RoomMemberState {
                user_id: format!("usr_{index:08}"),
                display_name: "x".repeat(64),
                note: "y".repeat(128),
                ..crate::RoomMemberState::default()
            })
            .collect(),
        ..RoomState::default()
    }
}

#[tokio::test]
async fn stopping_the_service_drops_a_client_that_stopped_reading() {
    let config = Arc::new(MemoryConfig::default());
    let port = unused_port();
    config
        .set_string(INTEGRATION_API_PORT_CONFIG_KEY, &port.to_string())
        .unwrap();
    let controller = controller(config);
    controller.set_game_running(true).await.unwrap();
    let status = controller.set_enabled(true).await.unwrap();
    let mut stream = connect_stream(port, &status.token).await;
    assert_eq!(read_server_message(&mut stream).await["type"], "hello");
    assert_eq!(controller.active_connections.load(Ordering::Acquire), 1);

    for index in 0..4 {
        controller.publish(Some(crowded_room(index))).await;
    }

    controller.set_enabled(false).await.unwrap();
    assert_eq!(controller.active_connections.load(Ordering::Acquire), 0);
}
