//! The collector's recording loop. It starts the same headless runtime the
//! app has, from a VRChat session handed over by the supervisor, and then
//! does three things only: streams newly recorded history rows to the
//! supervisor, deletes rows the supervisor confirmed, and answers requests
//! for the current friends state. It exposes no way to act on VRChat.

use std::collections::{BTreeMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;
use tokio::sync::mpsc;
use vrcx_0_application_core::{
    RuntimeEventSink, RuntimeTask, RuntimeTaskExecutor, RuntimeTaskHandle,
};
use vrcx_0_composition::{RuntimeHostOptions, RuntimeHostProfile, RuntimeHostState};
use vrcx_0_core::presence::PresenceView;
use vrcx_0_persistence::remote_sync::streams::{
    delete_rows_through, export_rows, StreamScope, ROW_STREAMS,
};
use vrcx_0_platform::app_paths::{AppDataDirResolution, AppDataDirSource};
use zeroize::Zeroizing;

use crate::{
    ControlError, ControlRequest, ControlResponse, RowMessage, SessionMessage, MAX_FRAME_BYTES,
};

const ROW_POLL: Duration = Duration::from_secs(2);
const ROWS_PER_POLL: u32 = 500;

/// How the collector ended, for the process exit code.
pub enum Outcome {
    Stopped,
    /// The runtime could not start for a reason other than the session.
    Unavailable(String),
}

/// Runtime events are dropped: nothing the runtime reports is printed or
/// stored, so no session detail can reach a log.
struct SilentSink;

impl RuntimeEventSink for SilentSink {
    fn emit(&self, _event: &str, _payload: Value) {}
}

struct TokioExecutor;
struct TokioHandle(tokio::task::JoinHandle<()>);

impl RuntimeTaskExecutor for TokioExecutor {
    fn spawn(&self, task: RuntimeTask) -> Box<dyn RuntimeTaskHandle> {
        Box::new(TokioHandle(tokio::spawn(task)))
    }
}

impl RuntimeTaskHandle for TokioHandle {
    fn abort(&self) {
        self.0.abort();
    }

    fn is_finished(&self) -> bool {
        self.0.is_finished()
    }

    fn join_or_abort(&mut self, _timeout: Duration) {
        self.0.abort();
    }
}

fn app_version() -> String {
    const TAURI_CONFIG: &str = include_str!("../../../src-tauri/tauri.conf.json");
    serde_json::from_str::<Value>(TAURI_CONFIG)
        .ok()
        .and_then(|value| {
            value
                .get("version")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .filter(|version| !version.trim().is_empty())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").into())
}

/// The session in the form the runtime's cookie jar accepts.
fn cookie_payload(session: &SessionMessage) -> Zeroizing<String> {
    let mut cookies = vec![json!({
        "Name": "auth", "Value": session.auth, "Domain": "api.vrchat.cloud", "Path": "/",
    })];
    if let Some(two_factor) = session
        .two_factor_auth
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        cookies.push(json!({
            "Name": "twoFactorAuth", "Value": two_factor, "Domain": "api.vrchat.cloud", "Path": "/",
        }));
    }
    let json = Zeroizing::new(Value::Array(cookies).to_string());
    Zeroizing::new(STANDARD.encode(json.as_bytes()))
}

async fn read_frame(reader: &mut OwnedReadHalf) -> Option<Vec<u8>> {
    let length = reader.read_u32().await.ok()? as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return None;
    }
    let mut frame = vec![0; length];
    reader.read_exact(&mut frame).await.ok()?;
    Some(frame)
}

async fn write_frame<T: serde::Serialize>(
    writer: &mut OwnedWriteHalf,
    message: &T,
) -> std::io::Result<()> {
    let mut bytes = Vec::new();
    ciborium::into_writer(message, &mut bytes)
        .map_err(|error| std::io::Error::other(error.to_string()))?;
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(std::io::Error::other("frame too large"));
    }
    writer.write_u32(bytes.len() as u32).await?;
    writer.write_all(&bytes).await?;
    writer.flush().await
}

fn failure(id: u64, code: &str, message: &str) -> ControlResponse {
    ControlResponse {
        v: 1,
        id,
        ok: false,
        error: Some(ControlError {
            code: code.into(),
            message: message.into(),
        }),
        snapshot: None,
    }
}

fn success(id: u64, snapshot: Option<Value>) -> ControlResponse {
    ControlResponse {
        v: 1,
        id,
        ok: true,
        error: None,
        snapshot,
    }
}

/// Reads control requests until the supervisor closes its end.
fn spawn_control_reader(mut reader: OwnedReadHalf) -> mpsc::Receiver<ControlRequest> {
    let (sender, receiver) = mpsc::channel(16);
    tokio::spawn(async move {
        while let Some(frame) = read_frame(&mut reader).await {
            let Ok(request) = ciborium::from_reader::<ControlRequest, _>(frame.as_slice()) else {
                break;
            };
            if sender.send(request).await.is_err() {
                break;
            }
        }
    });
    receiver
}

/// The session was refused. The collector stays up only to tell the
/// supervisor so, and never retries the rejected session.
async fn report_auth_failure(control: UnixStream) -> Outcome {
    let (reader, mut writer) = control.into_split();
    let mut requests = spawn_control_reader(reader);
    while let Some(request) = requests.recv().await {
        let response = failure(
            request.id,
            "auth_failed",
            "VRChat did not accept the session.",
        );
        if write_frame(&mut writer, &response).await.is_err() {
            break;
        }
    }
    Outcome::Stopped
}

/// Rows already sent, so a confirmed row id can be turned back into the
/// database rows to delete.
#[derive(Default)]
struct Emitted {
    next_row_id: u64,
    rows: VecDeque<(u64, usize, i64)>,
}

struct Recorder {
    state: RuntimeHostState,
    scope: StreamScope,
    cursors: Vec<i64>,
    emitted: Emitted,
}

impl Recorder {
    /// Committed rows the supervisor has not seen yet, oldest first per stream.
    fn new_rows(&mut self) -> Result<Vec<RowMessage>, String> {
        let db = self.state.database();
        let mut messages = Vec::new();
        for (index, spec) in ROW_STREAMS.iter().enumerate() {
            let rows = export_rows(db, &self.scope, spec, self.cursors[index], ROWS_PER_POLL)
                .map_err(|error| error.to_string())?;
            for (rowid, row) in rows {
                self.cursors[index] = rowid;
                self.emitted.next_row_id += 1;
                self.emitted
                    .rows
                    .push_back((self.emitted.next_row_id, index, rowid));
                messages.push(RowMessage {
                    v: 1,
                    row_id: self.emitted.next_row_id,
                    stream: spec.name.to_owned(),
                    row,
                });
            }
        }
        Ok(messages)
    }

    /// Deletes every row up to `through`, which the supervisor only names
    /// after the server stored the chunk holding those rows.
    fn prune(&mut self, through: u64) -> Result<(), String> {
        if through > self.emitted.next_row_id {
            return Err("rows that were never sent cannot be pruned".into());
        }
        let mut highest = BTreeMap::new();
        while let Some((row_id, index, rowid)) = self.emitted.rows.front().copied() {
            if row_id > through {
                break;
            }
            self.emitted.rows.pop_front();
            highest.insert(index, rowid);
        }
        for (index, rowid) in highest {
            delete_rows_through(
                self.state.database(),
                &self.scope,
                &ROW_STREAMS[index],
                rowid,
            )
            .map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    /// The friends and presence state the app's sidebar would show.
    fn snapshot(&self) -> Value {
        let realtime = self.state.realtime_runtime();
        let own = realtime.current_user_snapshot().unwrap_or(Value::Null);
        let text = |key: &str| {
            own.get(key)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned()
        };
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as i64)
            .unwrap_or(0);
        let mut friends = Vec::new();
        let mut occupants: BTreeMap<String, Vec<String>> = BTreeMap::new();
        if let Some(snapshot) = realtime.friend_snapshot() {
            for (user_id, friend) in &snapshot.friends_by_id {
                let Some(presence) = snapshot.presence_by_id.get(user_id) else {
                    continue;
                };
                if matches!(presence.view, PresenceView::Offline) {
                    continue;
                }
                let place = presence.view.place();
                let location = place
                    .map(|place| place.location.tag.clone())
                    .unwrap_or_default();
                if place.is_some_and(|place| place.location.is_real_instance) {
                    occupants
                        .entry(location.clone())
                        .or_default()
                        .push(user_id.clone());
                }
                friends.push(json!({
                    "userId": user_id,
                    "displayName": friend.display_name.to_string(),
                    "status": friend.status.to_string(),
                    "statusDescription": friend.status_description.to_string(),
                    "location": location,
                    "platform": presence.view.platform(),
                    "lastSeenAtMs": now_ms,
                }));
            }
        }
        friends.sort_by(|left, right| left["userId"].as_str().cmp(&right["userId"].as_str()));
        let instances = occupants
            .into_iter()
            .map(|(location, mut users)| {
                users.sort();
                json!({ "location": location, "occupants": users, "capacity": null })
            })
            .collect::<Vec<_>>();
        json!({
            "own": {
                "status": text("status"),
                "statusDescription": text("statusDescription"),
                "location": text("location"),
            },
            "friends": friends,
            "instances": instances,
        })
    }

    fn handle(&mut self, request: ControlRequest) -> ControlResponse {
        if request.v != 1 {
            return failure(
                request.id,
                "unsupported_version",
                "Unsupported protocol version.",
            );
        }
        match (request.op.as_str(), request.through_row_id) {
            ("pruneRows", Some(through)) => match self.prune(through) {
                Ok(()) => success(request.id, None),
                Err(message) => failure(request.id, "unacknowledged_rows", &message),
            },
            ("getSnapshot", _) => success(request.id, Some(self.snapshot())),
            _ => failure(
                request.id,
                "unsupported_operation",
                "This collector operation is not supported.",
            ),
        }
    }
}

fn host_state(data_dir: PathBuf, version: String) -> vrcx_0_composition::Result<RuntimeHostState> {
    let state = RuntimeHostState::new(RuntimeHostOptions {
        realtime_origin: "http://localhost:9000".into(),
        launched_from_autostart: false,
        app_data_dir: AppDataDirResolution {
            current_dir: data_dir.clone(),
            default_dir: data_dir.clone(),
            persisted_dir: None,
            cli_dir: Some(data_dir),
            source: AppDataDirSource::Cli,
        },
        app_version: version,
        profile: RuntimeHostProfile::HeadlessData,
        database_maintenance_cache_dir: None,
        task_executor: Some(Arc::new(TokioExecutor)),
    })?;
    state.set_event_sink(SilentSink);
    Ok(state)
}

pub async fn run(
    data_dir: PathBuf,
    session: SessionMessage,
    rows: std::os::unix::net::UnixStream,
    control: std::os::unix::net::UnixStream,
) -> Outcome {
    for stream in [&rows, &control] {
        if stream.set_nonblocking(true).is_err() {
            return Outcome::Unavailable("inherited descriptors are unusable".into());
        }
    }
    let (Ok(rows), Ok(control)) = (UnixStream::from_std(rows), UnixStream::from_std(control))
    else {
        return Outcome::Unavailable("inherited descriptors are not sockets".into());
    };

    let version = app_version();
    vrcx_0_core::user_agent::set_app_version(&version);
    vrcx_0_core::tls::install_crypto_provider();
    let Ok(state) = host_state(data_dir, version) else {
        return Outcome::Unavailable("the recording runtime could not start".into());
    };

    let cookies = cookie_payload(&session);
    drop(session);
    let started = state.start_collector_backend_runtime(&cookies).await;
    drop(cookies);
    let user_id = match started {
        Ok(user_id) => user_id,
        Err(
            vrcx_0_composition::Error::AuthSessionInvalidated { .. }
            | vrcx_0_composition::Error::AuthInteractionRequired(_),
        ) => {
            state.stop_runtime_tasks();
            return report_auth_failure(control).await;
        }
        Err(_) => {
            state.stop_runtime_tasks();
            return Outcome::Unavailable("VRChat could not be reached to start the session".into());
        }
    };
    let Ok(scope) = StreamScope::open(state.database(), &user_id) else {
        return Outcome::Unavailable("the temporary database is unusable".into());
    };
    let mut recorder = Recorder {
        state,
        scope,
        cursors: vec![0; ROW_STREAMS.len()],
        emitted: Emitted::default(),
    };

    let (_rows_reader, mut rows_writer) = rows.into_split();
    let (control_reader, mut control_writer) = control.into_split();
    let mut requests = spawn_control_reader(control_reader);
    let mut poll = tokio::time::interval(ROW_POLL);
    let Ok(mut terminate) =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    else {
        return Outcome::Unavailable("signal handling is unavailable".into());
    };
    loop {
        tokio::select! {
            _ = poll.tick() => {
                let Ok(messages) = recorder.new_rows() else { break };
                let mut closed = false;
                for message in &messages {
                    if write_frame(&mut rows_writer, message).await.is_err() {
                        closed = true;
                        break;
                    }
                }
                if closed {
                    break;
                }
            }
            request = requests.recv() => {
                let Some(request) = request else { break };
                let response = recorder.handle(request);
                if write_frame(&mut control_writer, &response).await.is_err() {
                    break;
                }
            }
            _ = terminate.recv() => break,
        }
    }
    recorder.state.stop_backend_runtime("collector-stopped");
    recorder.state.stop_runtime_tasks();
    Outcome::Stopped
}

#[cfg(test)]
mod tests {
    use super::*;
    use vrcx_0_persistence::feed::test_support::seed_feed_bio_row;

    const USER: &str = "usr_12345678-1234-1234-1234-1234567890ab";

    struct TestDir(PathBuf);

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn recorder(name: &str) -> (TestDir, Recorder) {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-collector-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        let state = host_state(path.clone(), "test".into()).unwrap();
        let scope = StreamScope::open(state.database(), USER).unwrap();
        let recorder = Recorder {
            state,
            scope,
            cursors: vec![0; ROW_STREAMS.len()],
            emitted: Emitted::default(),
        };
        (TestDir(path), recorder)
    }

    fn record(recorder: &Recorder, created_at: &str, bio: &str) {
        seed_feed_bio_row(
            recorder.state.database(),
            USER,
            (created_at, "usr_friend", "Friend", bio, ""),
        )
        .unwrap();
    }

    fn request(id: u64, op: &str, through_row_id: Option<u64>) -> ControlRequest {
        ControlRequest {
            v: 1,
            id,
            op: op.into(),
            through_row_id,
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn rows_are_sent_once_with_increasing_ids_and_without_local_keys() {
        let (_dir, mut recorder) = recorder("rows");
        record(&recorder, "2026-10-10T10:00:00.000Z", "first");
        record(&recorder, "2026-10-10T11:00:00.000Z", "second");

        let sent = recorder.new_rows().unwrap();
        assert_eq!(
            sent.iter().map(|row| row.row_id).collect::<Vec<_>>(),
            [1, 2]
        );
        assert!(sent
            .iter()
            .all(|row| row.v == 1 && row.stream == "feed_bio"));
        assert_eq!(sent[0].row["bio"], "first");
        assert!(sent[0].row.get("id").is_none());
        assert!(recorder.new_rows().unwrap().is_empty());

        record(&recorder, "2026-10-10T12:00:00.000Z", "third");
        let later = recorder.new_rows().unwrap();
        assert_eq!(later.len(), 1);
        assert_eq!(later[0].row_id, 3);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn only_confirmed_rows_are_deleted() {
        let (_dir, mut recorder) = recorder("prune");
        for (index, bio) in ["a", "b", "c"].iter().enumerate() {
            record(&recorder, &format!("2026-10-10T1{index}:00:00.000Z"), bio);
        }
        recorder.new_rows().unwrap();
        let remaining = |recorder: &Recorder| {
            let spec = ROW_STREAMS
                .iter()
                .find(|spec| spec.name == "feed_bio")
                .unwrap();
            export_rows(recorder.state.database(), &recorder.scope, spec, 0, 100)
                .unwrap()
                .len()
        };

        // A row id that was never sent is refused and nothing is deleted.
        assert!(!recorder.handle(request(1, "pruneRows", Some(9))).ok);
        assert_eq!(remaining(&recorder), 3);

        assert!(recorder.handle(request(2, "pruneRows", Some(2))).ok);
        assert_eq!(remaining(&recorder), 1);
        // Confirming the same rows again changes nothing.
        assert!(recorder.handle(request(3, "pruneRows", Some(2))).ok);
        assert_eq!(remaining(&recorder), 1);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn the_snapshot_has_the_agreed_shape_and_nothing_can_be_commanded() {
        let (_dir, mut recorder) = recorder("snapshot");
        let response = recorder.handle(request(1, "getSnapshot", None));
        assert!(response.ok);
        let snapshot = response.snapshot.unwrap();
        for key in ["status", "statusDescription", "location"] {
            assert!(snapshot["own"][key].is_string());
        }
        assert!(snapshot["friends"].is_array() && snapshot["instances"].is_array());

        for op in [
            "invite",
            "sendMessage",
            "setStatus",
            "addFriend",
            "block",
            "favorite",
        ] {
            let refused = recorder.handle(request(2, op, None));
            assert!(!refused.ok);
            assert_eq!(refused.error.unwrap().code, "unsupported_operation");
        }
        let wrong_version = recorder.handle(ControlRequest {
            v: 2,
            ..request(3, "getSnapshot", None)
        });
        assert_eq!(wrong_version.error.unwrap().code, "unsupported_version");
    }

    #[tokio::test]
    async fn a_refused_session_is_reported_as_auth_failed_until_the_supervisor_hangs_up() {
        let (supervisor, child) = UnixStream::pair().unwrap();
        let reporting = tokio::spawn(report_auth_failure(child));
        let (mut reader, mut writer) = supervisor.into_split();
        for id in [7, 8] {
            write_frame(
                &mut writer,
                &json!({ "v": 1, "id": id, "op": "getSnapshot" }),
            )
            .await
            .unwrap();
            let reply: ControlResponse =
                ciborium::from_reader(read_frame(&mut reader).await.unwrap().as_slice()).unwrap();
            assert_eq!((reply.id, reply.ok), (id, false));
            assert_eq!(reply.error.unwrap().code, "auth_failed");
        }
        drop((reader, writer));
        assert!(matches!(reporting.await.unwrap(), Outcome::Stopped));
    }

    #[test]
    fn the_session_becomes_cookies_for_vrchat_only_and_leaves_no_trace_in_debug_output() {
        let session = SessionMessage {
            v: 1,
            auth: "authcookie-fixture".into(),
            two_factor_auth: Some("twofactor-fixture".into()),
        };
        let decoded = STANDARD
            .decode(cookie_payload(&session).as_bytes())
            .unwrap();
        let cookies: Vec<Value> = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(cookies.len(), 2);
        assert!(cookies
            .iter()
            .all(|cookie| cookie["Domain"] == "api.vrchat.cloud" && cookie["Path"] == "/"));
        assert_eq!(cookies[0]["Name"], "auth");
        assert_eq!(cookies[1]["Name"], "twoFactorAuth");

        let without = SessionMessage {
            v: 1,
            auth: "authcookie-fixture".into(),
            two_factor_auth: None,
        };
        let decoded = STANDARD
            .decode(cookie_payload(&without).as_bytes())
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Vec<Value>>(&decoded)
                .unwrap()
                .len(),
            1
        );
    }
}
