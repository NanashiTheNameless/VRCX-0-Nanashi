use std::sync::Arc;

use serde_json::json;
use vrcx_0_application_core::SessionHostRuntime;
use vrcx_0_application_game::{GameLogSideEffectObserver, GameLogSideEffectSink, ProcessMonitor};
use vrcx_0_composition::{Result, RuntimeHostStateBuilder};
use vrcx_0_host_desktop::auto_launch::{
    app_startup_folder, deserialize_app_launcher_entries, vrcx_startup_folder,
    AppLauncherFolderConfig, AppLauncherFolderSource, AutoAppLaunchManager,
    APP_LAUNCHER_APP_FOLDER_ENABLED_CONFIG_KEY, APP_LAUNCHER_ENABLED_CONFIG_KEY,
    APP_LAUNCHER_ENTRIES_CONFIG_KEY, APP_LAUNCHER_VRCX_FOLDER_ENABLED_CONFIG_KEY,
};
use vrcx_0_persistence::screenshot_cache::MetadataCacheDb;

use super::desktop::DesktopWiring;
use crate::state::GameRuntimeBundle;
use crate::{
    GameClientHostRuntime, GameClientHostRuntimeDeps, GameLogEventSink, GameLogHostRuntime,
    GameLogHostRuntimeDeps, HostLogLocationSnapshotScanner, LogWatcher,
};

pub(crate) fn build_game_log_runtime(
    builder: &RuntimeHostStateBuilder,
    wiring: &DesktopWiring,
) -> Arc<GameLogHostRuntime> {
    let context = builder.desktop_assembly();
    let game_log_observer: Arc<dyn GameLogSideEffectObserver> = wiring.services.clone();
    Arc::new(GameLogHostRuntime::new(GameLogHostRuntimeDeps {
        config: context.config_store(),
        db: Arc::clone(context.database()),
        web: Arc::clone(context.web_client()),
        image_cache: Arc::clone(context.image_cache()),
        event_bus: context.event_bus().clone(),
        tasks: context.tasks().clone(),
        sync: context.sync().clone(),
        auth_scope: context.auth_scope().clone(),
        session: context.session().clone(),
        world_cache: Arc::clone(context.world_cache()),
        file_access: wiring.host_file_access.clone(),
        app_paths: builder.paths().clone(),
        snapshot: wiring.services.game_log_snapshot_handle(),
        activity_router: wiring.services.activity_router(),
        instance_roster_observer: Some(Arc::clone(&wiring.game_roster_observer)),
        backend_status: wiring.backend_status.clone(),
        side_effect_sink: GameLogSideEffectSink::new(
            context.event_bus().clone(),
            Some(game_log_observer),
        ),
        isolation: wiring.services.game_isolation(),
    }))
}

pub(crate) fn build_game_runtime(
    builder: &RuntimeHostStateBuilder,
    wiring: &DesktopWiring,
    game_log_runtime: Arc<GameLogHostRuntime>,
    safety: &Arc<crate::safety::SafetyRuntime>,
) -> Result<Arc<GameRuntimeBundle>> {
    let context = builder.desktop_assembly();
    let game_log_sink: Arc<dyn GameLogEventSink> = Arc::new(crate::safety::SafetyLogSink {
        inner: game_log_runtime.clone(),
        safety: Arc::clone(safety),
    });
    let log_watcher = LogWatcher::new_with_location_snapshot_scanner(
        Some(game_log_sink),
        Arc::new(HostLogLocationSnapshotScanner),
    );
    let game_client_runtime = Arc::new(GameClientHostRuntime::new(GameClientHostRuntimeDeps {
        db: Arc::clone(context.database()),
        config: context.config_store(),
        event_bus: context.event_bus().clone(),
        tasks: context.tasks().clone(),
        session: context.session().clone(),
        auth_scope: context.auth_scope().clone(),
        log_watcher: log_watcher.clone(),
        file_access: wiring.host_file_access.clone(),
        app_paths: builder.paths().clone(),
        host: wiring.services.host.clone(),
        instance_roster_observer: Some(Arc::clone(&wiring.game_roster_observer)),
        backend_status: wiring.backend_status.clone(),
        activity_router: wiring.services.activity_router(),
        isolation: wiring.services.game_isolation(),
    }));
    let session_runtime = Arc::new(SessionHostRuntime::new(
        context.session().clone(),
        wiring.backend_status.clone(),
    ));
    let screenshot_cache =
        MetadataCacheDb::new(&builder.paths().app_data.join("metadataCache.db"))?;
    let app_launcher_enabled = context
        .config_store()
        .get_bool(APP_LAUNCHER_ENABLED_CONFIG_KEY, true)?;
    let app_launcher_entries = deserialize_app_launcher_entries(
        context
            .config_store()
            .get_json(APP_LAUNCHER_ENTRIES_CONFIG_KEY, json!([]))?,
    );
    let mut app_launcher_folders = vec![AppLauncherFolderConfig {
        source: AppLauncherFolderSource::App,
        path: app_startup_folder(&builder.paths().app_data),
        enabled: context
            .config_store()
            .get_bool(APP_LAUNCHER_APP_FOLDER_ENABLED_CONFIG_KEY, true)?,
    }];
    if let Some(path) = vrcx_startup_folder() {
        app_launcher_folders.push(AppLauncherFolderConfig {
            source: AppLauncherFolderSource::Vrcx,
            path,
            enabled: context
                .config_store()
                .get_bool(APP_LAUNCHER_VRCX_FOLDER_ENABLED_CONFIG_KEY, false)?,
        });
    }
    Ok(Arc::new(GameRuntimeBundle {
        process_monitor: ProcessMonitor::new(),
        log_watcher,
        game_log_runtime,
        game_client_runtime,
        session_runtime,
        screenshot_cache,
        auto_launch: AutoAppLaunchManager::new(app_launcher_enabled, app_launcher_entries)
            .with_folders(app_launcher_folders),
    }))
}
