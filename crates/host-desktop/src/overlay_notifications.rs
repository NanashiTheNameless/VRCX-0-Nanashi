use std::net::UdpSocket;
use std::path::Path;
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

pub struct OvrToolkit {
    worker: Mutex<Option<OvrWorker>>,
}

struct OvrWorker {
    queue: mpsc::Sender<Vec<serde_json::Value>>,
    shutdown: oneshot::Sender<()>,
    thread: JoinHandle<()>,
}

type WsSender =
    futures_util::stream::SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

struct OvrConnection {
    sender: WsSender,
    reader: tokio::task::JoinHandle<()>,
}

const MAX_UDP_PAYLOAD_BYTES: usize = 65_507;
const XSOVERLAY_UDP_ADDR: &str = "127.0.0.1:42069";
const OVRTOOLKIT_WS_URL: &str = "ws://127.0.0.1:11450/api";
const XS_BUILTIN_DEFAULT_ICON: &str = "default";
const OVR_QUEUE_CAPACITY: usize = 64;
const OVR_CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const OVR_SEND_TIMEOUT: Duration = Duration::from_secs(1);

impl OvrToolkit {
    pub fn new() -> Self {
        Self {
            worker: Mutex::new(None),
        }
    }

    pub fn send_notification(
        &self,
        hud_notification: bool,
        wrist_notification: bool,
        title: &str,
        body: &str,
        image: Option<&str>,
    ) {
        let messages =
            ovr_notification_messages(hud_notification, wrist_notification, title, body, image);
        if messages.is_empty() {
            return;
        }
        self.enqueue(messages);
    }

    fn enqueue(&self, messages: Vec<serde_json::Value>) {
        let Ok(mut slot) = self.worker.lock() else {
            tracing::warn!("[OVR Toolkit] worker lock poisoned; notification dropped");
            return;
        };
        if slot
            .as_ref()
            .is_some_and(|worker| worker.thread.is_finished())
        {
            if let Some(worker) = slot.take() {
                worker.shutdown();
            }
        }
        if slot.is_none() {
            match OvrWorker::spawn() {
                Ok(worker) => *slot = Some(worker),
                Err(error) => {
                    tracing::warn!("[OVR Toolkit] worker start failed: {error}");
                    return;
                }
            }
        }
        let Some(worker) = slot.as_ref() else {
            return;
        };
        match worker.queue.try_send(messages) {
            Ok(()) => {}
            Err(mpsc::error::TrySendError::Full(_)) => {
                tracing::warn!("[OVR Toolkit] notification queue full; notification dropped");
            }
            Err(mpsc::error::TrySendError::Closed(messages)) => {
                if let Some(worker) = slot.take() {
                    worker.shutdown();
                }
                let Ok(worker) = OvrWorker::spawn() else {
                    tracing::warn!("[OVR Toolkit] worker restart failed; notification dropped");
                    return;
                };
                match worker.queue.try_send(messages) {
                    Ok(()) => *slot = Some(worker),
                    Err(_) => {
                        worker.shutdown();
                        tracing::warn!(
                            "[OVR Toolkit] restarted worker rejected notification; notification dropped"
                        );
                    }
                }
            }
        }
    }
}

impl Drop for OvrToolkit {
    fn drop(&mut self) {
        if let Ok(slot) = self.worker.get_mut() {
            if let Some(worker) = slot.take() {
                worker.shutdown();
            }
        }
    }
}

impl OvrWorker {
    fn spawn() -> Result<Self, String> {
        let (queue, receiver) = mpsc::channel(OVR_QUEUE_CAPACITY);
        let (shutdown, shutdown_rx) = oneshot::channel();
        let thread = std::thread::Builder::new()
            .name("ovr-toolkit-notifications".into())
            .spawn(move || {
                let runtime = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        tracing::warn!("[OVR Toolkit] runtime start failed: {error}");
                        return;
                    }
                };
                runtime.block_on(run_ovr_worker(receiver, shutdown_rx));
            })
            .map_err(|error| format!("thread: {error}"))?;
        Ok(Self {
            queue,
            shutdown,
            thread,
        })
    }

    fn shutdown(self) {
        let Self {
            queue,
            shutdown,
            thread,
        } = self;
        let _ = shutdown.send(());
        drop(queue);
        if thread.join().is_err() {
            tracing::warn!("[OVR Toolkit] worker thread panicked");
        }
    }
}

impl Default for OvrToolkit {
    fn default() -> Self {
        Self::new()
    }
}

pub fn send_xs_notification(
    title: &str,
    content: &str,
    timeout: i32,
    opacity: f64,
    image: Option<&str>,
) -> Result<(), String> {
    let payload = xs_notification_payload(title, content, timeout, opacity, image);
    let bytes = serde_json::to_vec(&payload).map_err(|error| format!("serialize: {error}"))?;
    if bytes.len() > MAX_UDP_PAYLOAD_BYTES {
        return Err(format!(
            "payload too large: {} bytes exceeds UDP datagram limit",
            bytes.len()
        ));
    }
    let socket = UdpSocket::bind("127.0.0.1:0").map_err(|error| format!("bind: {error}"))?;
    socket
        .send_to(&bytes, XSOVERLAY_UDP_ADDR)
        .map_err(|error| format!("send: {error}"))?;
    Ok(())
}

fn xs_notification_payload(
    title: &str,
    content: &str,
    timeout: i32,
    opacity: f64,
    image: Option<&str>,
) -> serde_json::Value {
    let icon = image
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(XS_BUILTIN_DEFAULT_ICON);
    let height = xs_notification_height(content);
    serde_json::json!({
        "messageType": 1,
        "title": title,
        "content": content,
        "height": height,
        "sourceApp": "VRCX-0-Nanashi",
        "timeout": timeout,
        "volume": 0.0,
        "audioPath": "",
        "useBase64Icon": false,
        "icon": icon,
        "opacity": opacity
    })
}

fn xs_notification_height(content: &str) -> f32 {
    match content.chars().count() {
        length if length > 300 => 250.0,
        length if length > 200 => 200.0,
        length if length > 100 => 150.0,
        _ => 110.0,
    }
}

fn ovr_toolkit_icon_base64(image: Option<&str>) -> String {
    image
        .map(str::trim)
        .filter(|path| !path.is_empty() && Path::new(path).exists())
        .and_then(|path| std::fs::read(path).ok())
        .map(|bytes| B64.encode(bytes))
        .unwrap_or_default()
}

fn ovr_notification_messages(
    hud_notification: bool,
    wrist_notification: bool,
    title: &str,
    body: &str,
    image: Option<&str>,
) -> Vec<serde_json::Value> {
    let mut messages = Vec::new();
    if wrist_notification {
        messages.push(serde_json::json!({
            "messageType": "SendWristNotification",
            "json": serde_json::to_string(&serde_json::json!({
                "body": format!("{title} - {body}")
            })).unwrap_or_default()
        }));
    }
    if hud_notification {
        messages.push(serde_json::json!({
            "messageType": "SendNotification",
            "json": serde_json::to_string(&serde_json::json!({
                "title": title,
                "body": body,
                "icon": ovr_toolkit_icon_base64(image)
            })).unwrap_or_default()
        }));
    }
    messages
}

impl OvrConnection {
    async fn shutdown(self) {
        let Self { sender, reader } = self;
        reader.abort();
        drop(sender);
        let _ = reader.await;
    }
}

async fn connect_ws() -> Result<OvrConnection, String> {
    connect_ws_to(OVRTOOLKIT_WS_URL).await
}

async fn connect_ws_to(url: &str) -> Result<OvrConnection, String> {
    let (ws_stream, _) =
        tokio::time::timeout(OVR_CONNECT_TIMEOUT, tokio_tungstenite::connect_async(url))
            .await
            .map_err(|_| {
                format!(
                    "connect timed out after {} ms",
                    OVR_CONNECT_TIMEOUT.as_millis()
                )
            })?
            .map_err(|error| format!("connect: {error}"))?;
    let (write, read) = ws_stream.split();

    let reader = tokio::spawn(async move {
        let mut read = read;
        while read.next().await.is_some() {}
    });

    Ok(OvrConnection {
        sender: write,
        reader,
    })
}

async fn send_all(
    connection: &mut OvrConnection,
    messages: &[serde_json::Value],
) -> Result<(), String> {
    for message in messages {
        let text = serde_json::to_string(message).unwrap_or_default();
        tokio::time::timeout(
            OVR_SEND_TIMEOUT,
            connection.sender.send(Message::Text(text.into())),
        )
        .await
        .map_err(|_| format!("send timed out after {} ms", OVR_SEND_TIMEOUT.as_millis()))?
        .map_err(|error| format!("send: {error}"))?;
    }
    Ok(())
}

async fn send_with_persistent_conn(
    connection: &mut Option<OvrConnection>,
    messages: &[serde_json::Value],
) -> Result<(), String> {
    if let Some(current) = connection.as_mut() {
        if send_all(current, messages).await.is_ok() {
            return Ok(());
        }
        if let Some(failed) = connection.take() {
            failed.shutdown().await;
        }
    }

    let mut replacement = connect_ws().await?;
    if let Err(error) = send_all(&mut replacement, messages).await {
        replacement.shutdown().await;
        return Err(error);
    }
    *connection = Some(replacement);
    Ok(())
}

async fn run_ovr_worker(
    mut receiver: mpsc::Receiver<Vec<serde_json::Value>>,
    mut shutdown: oneshot::Receiver<()>,
) {
    let mut connection = None;
    loop {
        let messages = tokio::select! {
            biased;
            _ = &mut shutdown => break,
            messages = receiver.recv() => messages,
        };
        let Some(messages) = messages else {
            break;
        };
        if let Err(error) = send_with_persistent_conn(&mut connection, &messages).await {
            tracing::warn!("[OVR Toolkit] notification send failed: {error}");
        }
    }
    if let Some(connection) = connection {
        connection.shutdown().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ovr_connection_shutdown_releases_the_websocket() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut websocket = tokio_tungstenite::accept_async(socket).await.unwrap();
            let _ = websocket.next().await;
        });

        let connection = connect_ws_to(&format!("ws://{address}")).await.unwrap();
        connection.shutdown().await;

        tokio::time::timeout(Duration::from_secs(1), server)
            .await
            .expect("server should observe the released connection")
            .unwrap();
    }

    #[test]
    fn xs_payload_without_image_uses_builtin_default_icon() {
        let payload = xs_notification_payload("VRCX-0", "Friend joined a world", 3, 1.0, None);

        assert_eq!(payload["useBase64Icon"], false);
        assert_eq!(payload["icon"], "default");

        let bytes = serde_json::to_vec(&payload).expect("payload should serialize");
        assert!(
            bytes.len() <= MAX_UDP_PAYLOAD_BYTES,
            "payload is {} bytes",
            bytes.len()
        );
    }

    #[test]
    fn xs_image_path_payload_uses_path_icon() {
        let payload = xs_notification_payload(
            "VRCX-0",
            "Friend joined a world",
            3,
            1.0,
            Some("C:/avatar.png"),
        );

        assert_eq!(payload["useBase64Icon"], false);
        assert_eq!(payload["icon"], "C:/avatar.png");
    }

    #[test]
    fn ovr_toolkit_icon_is_empty_without_image() {
        assert_eq!(ovr_toolkit_icon_base64(None), "");
    }

    #[test]
    fn ovr_notification_batch_keeps_wrist_before_hud() {
        let messages = ovr_notification_messages(true, true, "Title", "Body", None);

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["messageType"], "SendWristNotification");
        assert_eq!(messages[1]["messageType"], "SendNotification");
    }
}
