use crate::{
    HostSessionRuntime, LocalGameContextSnapshot, LocalGameContextSource, RuntimeSnapshotStore,
};

pub struct GameLogLocalGameContextSource {
    session: HostSessionRuntime,
    snapshot: RuntimeSnapshotStore,
}

impl GameLogLocalGameContextSource {
    pub fn new(session: HostSessionRuntime, snapshot: RuntimeSnapshotStore) -> Self {
        Self { session, snapshot }
    }
}

impl LocalGameContextSource for GameLogLocalGameContextSource {
    fn snapshot(&self) -> LocalGameContextSnapshot {
        let game_log = self.snapshot.snapshot();
        let is_game_running = self.session.snapshot().is_game_running;
        if !game_log.ready && is_game_running {
            return LocalGameContextSnapshot::Unavailable;
        }
        LocalGameContextSnapshot::Available {
            is_game_running,
            location: game_log.location.clone(),
            destination: game_log.destination.clone(),
            world_name: game_log.world_name.clone(),
            player_user_ids: game_log
                .players
                .iter()
                .map(|player| player.user_id.trim().to_string())
                .filter(|user_id| !user_id.is_empty())
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PlayerState, RuntimeSnapshot};
    use vrcx_0_application_core::HostSessionGameProcessStatus;

    #[test]
    fn maps_session_and_game_log_state_to_local_game_context() {
        let session = HostSessionRuntime::new();
        session.apply_game_process_status(HostSessionGameProcessStatus {
            is_game_running: true,
            is_steamvr_running: false,
            changed_at: 1784246400,
        });
        let snapshot = RuntimeSnapshotStore::default();
        snapshot.replace(RuntimeSnapshot {
            ready: true,
            location: "wrld_test:123".into(),
            destination: "wrld_next:456".into(),
            world_name: "Test World".into(),
            players: vec![
                PlayerState {
                    user_id: " usr_friend ".into(),
                    display_name: "Friend".into(),
                    join_time_ms: Some(1),
                },
                PlayerState {
                    user_id: " ".into(),
                    display_name: "Unknown".into(),
                    join_time_ms: None,
                },
            ],
            ..RuntimeSnapshot::default()
        });
        let source = GameLogLocalGameContextSource::new(session, snapshot);

        assert_eq!(
            source.snapshot(),
            LocalGameContextSnapshot::Available {
                is_game_running: true,
                location: "wrld_test:123".into(),
                destination: "wrld_next:456".into(),
                world_name: "Test World".into(),
                player_user_ids: vec!["usr_friend".into()],
            }
        );
    }
}

#[cfg(test)]
#[test]
fn regression_no_logs_still_reports_known_stopped_game() {
    let source = GameLogLocalGameContextSource::new(
        HostSessionRuntime::new(),
        RuntimeSnapshotStore::default(),
    );
    assert_eq!(
        source.snapshot(),
        LocalGameContextSnapshot::Available {
            is_game_running: false,
            location: String::new(),
            destination: String::new(),
            world_name: String::new(),
            player_user_ids: Vec::new()
        }
    );
}
