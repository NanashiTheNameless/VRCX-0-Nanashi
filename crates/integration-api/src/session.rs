use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, WebSocket};
use serde::Serialize;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

use crate::state::RoomChange;
use crate::transport::{now_iso, IntegrationApiRouterState, ServerEvent};
use crate::wire::{
    ClientMessage, RoomMemberRef, RoomRef, ServerMessage, HEARTBEAT_SECONDS, PROTOCOL_VERSION,
    SERVER_SCOPES,
};

const MAX_ACTIVE_CONNECTIONS: u32 = 64;
const SEND_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(1);

pub(crate) async fn run_session(mut socket: WebSocket, state: IntegrationApiRouterState) {
    let Some(_guard) = ActiveConnectionGuard::try_new(Arc::clone(&state.active_connections)) else {
        let _ = tokio::time::timeout(
            CLOSE_TIMEOUT,
            socket.send(Message::Close(Some(CloseFrame {
                code: 1008,
                reason: "too many connections".into(),
            }))),
        )
        .await;
        return;
    };

    let (mut receiver, initial_snapshot) = state.hub.subscribe();
    let mut room_revision = initial_snapshot.revision;
    let mut seq = 0_u64;
    if !send_message(
        &mut socket,
        &state.session_cancel,
        &ServerMessage::Hello {
            seq,
            protocol: PROTOCOL_VERSION,
            app: "vrcx-0",
            app_version: state.hub.app_version(),
            scopes: SERVER_SCOPES,
            heartbeat_sec: HEARTBEAT_SECONDS,
        },
    )
    .await
    {
        return;
    }
    seq = seq.saturating_add(1);
    if !send_snapshot(
        &mut socket,
        &state.session_cancel,
        seq,
        initial_snapshot.room.as_deref(),
        now_iso(),
    )
    .await
    {
        return;
    }

    let start = tokio::time::Instant::now() + Duration::from_secs(HEARTBEAT_SECONDS);
    let mut heartbeat = tokio::time::interval_at(start, Duration::from_secs(HEARTBEAT_SECONDS));
    loop {
        tokio::select! {
            _ = state.session_cancel.cancelled() => {
                let _ = tokio::time::timeout(CLOSE_TIMEOUT, socket.send(Message::Close(None))).await;
                break;
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        match serde_json::from_str::<ClientMessage>(text.as_str()) {
                            Ok(ClientMessage::Resync) => {
                                seq = seq.saturating_add(1);
                                let Some(revision) = send_latest_snapshot(
                                    &mut socket,
                                    seq,
                                    &state,
                                ).await else { break; };
                                room_revision = revision;
                            }
                            Err(error) => {
                                tracing::debug!(
                                    error = %error,
                                    "ignored invalid Integration API client frame"
                                );
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        tracing::debug!(error = %error, "Integration API WebSocket receive failed");
                        break;
                    }
                }
            }
            event = receiver.recv() => {
                match event {
                    Ok(ServerEvent::Snapshot { revision, room, at }) => {
                        if revision <= room_revision {
                            continue;
                        }
                        seq = seq.saturating_add(1);
                        if revision != room_revision.saturating_add(1) {
                            let Some(revision) = send_latest_snapshot(
                                &mut socket,
                                seq,
                                &state,
                            ).await else { break; };
                            room_revision = revision;
                            continue;
                        }
                        if !send_snapshot(
                            &mut socket,
                            &state.session_cancel,
                            seq,
                            room.as_deref(),
                            at,
                        ).await {
                            break;
                        }
                        room_revision = revision;
                    }
                    Ok(ServerEvent::Changes { revision, changes, at }) => {
                        if revision <= room_revision {
                            continue;
                        }
                        if revision != room_revision.saturating_add(1) {
                            seq = seq.saturating_add(1);
                            let Some(revision) = send_latest_snapshot(
                                &mut socket,
                                seq,
                                &state,
                            ).await else { break; };
                            room_revision = revision;
                            continue;
                        }
                        for change in &changes {
                            seq = seq.saturating_add(1);
                            if !send_change(
                                &mut socket,
                                &state.session_cancel,
                                change,
                                seq,
                                &at,
                            ).await {
                                return;
                            }
                        }
                        room_revision = revision;
                    }
                    Ok(ServerEvent::Bye(reason)) => {
                        let _ = send_message(
                            &mut socket,
                            &state.session_cancel,
                            &ServerMessage::Bye { reason },
                        )
                        .await;
                        break;
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        seq = seq.saturating_add(1);
                        let Some(revision) = send_latest_snapshot(
                            &mut socket,
                            seq,
                            &state,
                        ).await else { break; };
                        room_revision = revision;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = heartbeat.tick() => {
                seq = seq.saturating_add(1);
                let at = now_iso();
                if !send_message(
                    &mut socket,
                    &state.session_cancel,
                    &ServerMessage::Ping { seq, at: &at },
                ).await {
                    break;
                }
            }
        }
    }
}

async fn send_change(
    socket: &mut WebSocket,
    cancel: &CancellationToken,
    change: &RoomChange,
    seq: u64,
    at: &str,
) -> bool {
    match change {
        RoomChange::Snapshot(room) => {
            send_message(
                socket,
                cancel,
                &ServerMessage::Snapshot {
                    seq,
                    at,
                    room: Some(RoomRef::from(room.as_ref())),
                },
            )
            .await
        }
        RoomChange::Joined(members) => {
            send_message(
                socket,
                cancel,
                &ServerMessage::Joined {
                    seq,
                    at,
                    members: members.iter().map(RoomMemberRef::from).collect(),
                },
            )
            .await
        }
        RoomChange::Left(user_ids) => {
            send_message(socket, cancel, &ServerMessage::Left { seq, at, user_ids }).await
        }
    }
}

async fn send_snapshot(
    socket: &mut WebSocket,
    cancel: &CancellationToken,
    seq: u64,
    room: Option<&crate::state::RoomState>,
    at: String,
) -> bool {
    send_message(
        socket,
        cancel,
        &ServerMessage::Snapshot {
            seq,
            at: &at,
            room: room.map(RoomRef::from),
        },
    )
    .await
}

async fn send_latest_snapshot(
    socket: &mut WebSocket,
    seq: u64,
    state: &IntegrationApiRouterState,
) -> Option<u64> {
    let snapshot = state.hub.snapshot();
    send_snapshot(
        socket,
        &state.session_cancel,
        seq,
        snapshot.room.as_deref(),
        now_iso(),
    )
    .await
    .then_some(snapshot.revision)
}

async fn send_message<T: Serialize + ?Sized>(
    socket: &mut WebSocket,
    cancel: &CancellationToken,
    message: &T,
) -> bool {
    let Ok(payload) = serde_json::to_string(message) else {
        return false;
    };
    let send = socket.send(Message::Text(payload.into()));
    tokio::select! {
        biased;
        _ = cancel.cancelled() => false,
        sent = tokio::time::timeout(SEND_TIMEOUT, send) => matches!(sent, Ok(Ok(()))),
    }
}

struct ActiveConnectionGuard {
    active_connections: Arc<AtomicU32>,
}

impl ActiveConnectionGuard {
    fn try_new(active_connections: Arc<AtomicU32>) -> Option<Self> {
        let mut current = active_connections.load(Ordering::Relaxed);
        loop {
            if current >= MAX_ACTIVE_CONNECTIONS {
                return None;
            }
            match active_connections.compare_exchange_weak(
                current,
                current.saturating_add(1),
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Some(Self { active_connections }),
                Err(observed) => current = observed,
            }
        }
    }
}

impl Drop for ActiveConnectionGuard {
    fn drop(&mut self) {
        self.active_connections.fetch_sub(1, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_connection_limit_is_atomic_and_released_on_drop() {
        let count = Arc::new(AtomicU32::new(0));
        let guards = (0..MAX_ACTIVE_CONNECTIONS)
            .map(|_| ActiveConnectionGuard::try_new(Arc::clone(&count)).unwrap())
            .collect::<Vec<_>>();
        assert!(ActiveConnectionGuard::try_new(Arc::clone(&count)).is_none());
        assert_eq!(count.load(Ordering::Relaxed), MAX_ACTIVE_CONNECTIONS);
        drop(guards);
        assert_eq!(count.load(Ordering::Relaxed), 0);
    }
}
