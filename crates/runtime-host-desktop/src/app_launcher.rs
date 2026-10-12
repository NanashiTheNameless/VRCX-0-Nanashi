use std::time::Duration;

use vrcx_0_application_core::{RuntimeEventBus, RuntimeEventPayload, TaskSupervisor};
use vrcx_0_host_desktop::auto_launch::{AppLauncherSnapshot, AutoAppLaunchManager};

const APP_LAUNCHER_SNAPSHOT_INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AppLauncherSnapshotEvent {
    pub snapshot: AppLauncherSnapshot,
}

impl RuntimeEventPayload for AppLauncherSnapshotEvent {
    const EVENT_NAME: &'static str = "appLauncherSnapshot";
}

pub(crate) fn start_app_launcher_snapshot_events(
    manager: AutoAppLaunchManager,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
) {
    tasks
        .clone()
        .spawn_cancellable(move |stop_token| async move {
            let mut changes = manager.subscribe_changes();
            let mut previous = manager.snapshot();
            loop {
                if manager.has_running_processes() {
                    tokio::select! {
                        _ = tokio::time::sleep(APP_LAUNCHER_SNAPSHOT_INTERVAL) => {}
                        changed = changes.changed() => {
                            if changed.is_err() {
                                break;
                            }
                        }
                    }
                } else {
                    tokio::select! {
                        _ = tokio::time::sleep(APP_LAUNCHER_SNAPSHOT_INTERVAL) => {
                            if stop_token.is_stop_requested() {
                                break;
                            }
                            continue;
                        }
                        changed = changes.changed() => {
                            if changed.is_err() {
                                break;
                            }
                        }
                    }
                }
                if stop_token.is_stop_requested() {
                    break;
                }
                let snapshot = manager.snapshot();
                if snapshot == previous {
                    continue;
                }
                previous = snapshot.clone();
                event_bus.emit(AppLauncherSnapshotEvent { snapshot });
            }
        });
}
