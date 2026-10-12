use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use chrono::{DateTime, Utc};
use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::sync::mpsc;
use tower::ServiceExt;
use vrcx_0_logger_protocol::envelope::{
    open_response, seal_request, EnvelopeError, Nonce, SecretKey, PROTOCOL_HEADER, TIMESTAMP_HEADER,
};
use vrcx_0_logger_protocol::wire::{
    AckRequest, FrameKind, FramesRequest, FramesResponse, OkResponse, PresenceRequest,
    PresenceResponse, StatusResponse, WebhookFormat, WebhookRequest, WireFrame, MAX_FRAMES_PAGE,
    PROTOCOL_VERSION,
};

use crate::app::{now_unix, App};
use crate::server::router;
use crate::store::{KeyCheck, Store, STORAGE_SALT};

pub const PASSWORD: &str = "a long logger password";
pub const ACCOUNT: &str = "usr_desktop";

pub fn temp_dir() -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    std::env::temp_dir().join(format!(
        "vrcx0-logger-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}

pub fn open_store(dir: &Path, password: &str) -> (Store, KeyCheck) {
    Store::open(dir, SecretKey::derive(password, STORAGE_SALT).unwrap()).unwrap()
}

pub fn start(store: Store) -> Arc<App> {
    start_with(store, PASSWORD, None, None)
}

pub fn start_with(
    store: Store,
    password: &str,
    retention_days: Option<u32>,
    retention_bytes: Option<u64>,
) -> Arc<App> {
    Arc::new(
        App::new(
            SecretKey::transport(password).unwrap(),
            store,
            retention_days,
            retention_bytes,
        )
        .unwrap(),
    )
}

pub fn fresh_app() -> Arc<App> {
    start(open_store(&temp_dir(), PASSWORD).0)
}

pub fn at(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).unwrap()
}

pub fn sign_in(app: &App, account_id: &str) {
    app.shared
        .update(|info| info.account_id = Some(account_id.into()));
}

pub fn record(store: &Store, received_at: DateTime<Utc>, payload: &str) -> i64 {
    record_for(store, ACCOUNT, received_at, payload)
}

pub fn record_for(
    store: &Store,
    account_id: &str,
    received_at: DateTime<Utc>,
    payload: &str,
) -> i64 {
    store
        .insert_frame(FrameKind::Message, received_at, account_id, payload)
        .unwrap()
}

pub const OTHER_ACCOUNT: &str = "usr_other";

pub fn record_connect(store: &Store, received_at: DateTime<Utc>) -> i64 {
    store
        .insert_frame(FrameKind::Connect, received_at, ACCOUNT, "{}")
        .unwrap()
}

pub fn messages(frames: &[WireFrame]) -> Vec<&str> {
    frames
        .iter()
        .filter(|frame| frame.kind == FrameKind::Message)
        .map(|frame| frame.payload.as_str())
        .collect()
}

pub fn record_snapshot(store: &Store, received_at: DateTime<Utc>, after_seq: i64) -> i64 {
    let payload = serde_json::json!({ "afterSeq": after_seq });
    store
        .insert_frame(
            FrameKind::Snapshot,
            received_at,
            ACCOUNT,
            &payload.to_string(),
        )
        .unwrap()
}

pub async fn webhook_receiver() -> (String, mpsc::UnboundedReceiver<String>) {
    let (received, inbox) = mpsc::unbounded_channel::<String>();
    let router = axum::Router::new()
        .route(
            "/hook",
            axum::routing::post(move |body: String| {
                let received = received.clone();
                async move {
                    let _ = received.send(body);
                }
            }),
        )
        .route(
            "/broken",
            axum::routing::post(|| async { StatusCode::INTERNAL_SERVER_ERROR }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await });
    (format!("http://{address}"), inbox)
}

pub fn presence(account_id: &str, leaving: bool, profile_scan: bool) -> PresenceRequest {
    PresenceRequest {
        account_id: account_id.into(),
        leaving,
        profile_scan,
        profile_checks: Vec::new(),
    }
}

pub struct Sealed {
    pub path: String,
    pub timestamp: i64,
    pub body: Vec<u8>,
    pub nonce: Nonce,
}

pub struct Reply {
    pub status: StatusCode,
    pub body: Vec<u8>,
}

pub struct Desktop {
    app: Arc<App>,
    key: SecretKey,
}

impl Desktop {
    pub fn new(app: &Arc<App>) -> Self {
        Self::with_password(app, PASSWORD)
    }

    pub fn with_password(app: &Arc<App>, password: &str) -> Self {
        Self {
            app: app.clone(),
            key: SecretKey::transport(password).unwrap(),
        }
    }

    pub fn seal(&self, path: &str, request: &impl Serialize) -> Sealed {
        self.seal_at(path, now_unix(), request)
    }

    pub fn seal_at(&self, path: &str, timestamp: i64, request: &impl Serialize) -> Sealed {
        let json = serde_json::to_vec(request).unwrap();
        let (body, nonce) = seal_request(&self.key, "POST", path, timestamp, &json).unwrap();
        Sealed {
            path: path.into(),
            timestamp,
            body,
            nonce,
        }
    }

    pub async fn send(&self, sealed: &Sealed) -> Reply {
        self.post(&sealed.path, sealed.timestamp, sealed.body.clone())
            .await
    }

    pub async fn post(&self, path: &str, timestamp: i64, body: Vec<u8>) -> Reply {
        let request = Request::post(path)
            .header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string())
            .header(TIMESTAMP_HEADER, timestamp.to_string())
            .body(Body::from(body))
            .unwrap();
        let response = router(self.app.clone()).oneshot(request).await.unwrap();
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap()
            .to_vec();
        Reply { status, body }
    }

    pub fn try_read(&self, sealed: &Sealed, reply: &Reply) -> Result<Vec<u8>, EnvelopeError> {
        open_response(&self.key, &sealed.nonce, &reply.body)
    }

    pub fn read<R: DeserializeOwned>(&self, sealed: &Sealed, reply: &Reply) -> R {
        serde_json::from_slice(&self.try_read(sealed, reply).unwrap()).unwrap()
    }

    pub async fn call<R: DeserializeOwned>(
        &self,
        path: &str,
        request: &impl Serialize,
    ) -> (StatusCode, R) {
        let sealed = self.seal(path, request);
        let reply = self.send(&sealed).await;
        (reply.status, self.read(&sealed, &reply))
    }

    pub async fn status(&self) -> StatusResponse {
        let (status, response) = self.call("/status", &OkResponse {}).await;
        assert_eq!(status, StatusCode::OK);
        response
    }

    pub async fn report_presence(&self, request: PresenceRequest) -> PresenceResponse {
        let (status, response) = self.call("/presence", &request).await;
        assert_eq!(status, StatusCode::OK);
        response
    }

    pub async fn save_webhook(&self, url: &str, format: WebhookFormat) {
        let request = WebhookRequest {
            url: Some(url.into()),
            format,
        };
        let (status, OkResponse {}) = self.call("/webhook", &request).await;
        assert_eq!(status, StatusCode::OK);
    }

    pub async fn pull(&self, after: i64, limit: u32) -> FramesResponse {
        self.pull_account(ACCOUNT, after, limit).await
    }

    pub async fn pull_account(&self, account_id: &str, after: i64, limit: u32) -> FramesResponse {
        let request = FramesRequest {
            account_id: account_id.into(),
            after,
            limit,
        };
        let (status, response) = self.call("/frames", &request).await;
        assert_eq!(status, StatusCode::OK);
        response
    }

    pub async fn acknowledge(&self, account_id: &str, up_to: i64) {
        let request = AckRequest {
            account_id: account_id.into(),
            up_to,
        };
        let (status, OkResponse {}) = self.call("/ack", &request).await;
        assert_eq!(status, StatusCode::OK);
    }

    pub async fn pull_all(&self) -> Vec<WireFrame> {
        self.pull(0, MAX_FRAMES_PAGE).await.frames
    }
}
