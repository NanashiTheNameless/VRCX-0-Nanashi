use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

mod server;
mod store;

use store::{StoreResult, WorldDataStore};

/// VRCX's port; worlds built for VRCX ask for this address.
pub const DEFAULT_WORLD_DATA_PORT: u16 = 22500;
/// The app's own file. Its tables match VRCX's `VRCX-WorldData.db`, so that
/// file works when copied over under this name.
pub const WORLD_DATA_DB_FILE: &str = "VRCX-0-Nanashi-WorldData.db";
/// Connection key of the shared store every world can read.
const GLOBAL_WORLD_ID: &str = "global";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldDataSettings {
    pub enabled: bool,
    pub port: u16,
}

impl Default for WorldDataSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_WORLD_DATA_PORT,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldDataStatus {
    pub enabled: bool,
    pub port: u16,
    pub running: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldDataWorld {
    pub world_id: String,
    pub allow_external_read: bool,
    pub total_data_size: i64,
    pub entry_count: i64,
    pub last_modified: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldDataEntry {
    pub key: String,
    pub value: String,
    pub value_size: i64,
    pub last_modified: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorldDataImportReport {
    pub worlds_added: u32,
    pub entries_added: u32,
    /// Values already saved here, or over a world's 10 MB cap.
    pub entries_skipped: u32,
}

type CurrentWorld = Arc<dyn Fn() -> String + Send + Sync>;

struct ServerState {
    settings: WorldDataSettings,
    cancel: Option<CancellationToken>,
    error: Option<String>,
    /// Which start a running server belongs to, so a server that stops on its
    /// own after a restart does not clear the newer one.
    generation: u64,
}

/// VRCX's Persistent World Info: values worlds write with `[VRCX-World]` log
/// lines, served back to them over HTTP. Nothing is stored or served while it
/// is off.
pub struct WorldDataService {
    db_path: PathBuf,
    store: Mutex<Option<WorldDataStore>>,
    current_world: CurrentWorld,
    enabled: AtomicBool,
    last_error: Mutex<Option<String>>,
    server: tokio::sync::Mutex<ServerState>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

/// VRCX deserializes these fields as strings, which also accepts numbers and
/// booleans written without quotes.
fn text_field(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

/// `bool.TryParse` in VRCX: `true` or `false`, any case, surrounding spaces
/// allowed.
fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

impl WorldDataService {
    /// `current_world` returns the world ID the player is in according to
    /// VRChat's log, or an empty string.
    pub fn new(db_path: PathBuf, current_world: CurrentWorld) -> Self {
        Self {
            db_path,
            store: Mutex::new(None),
            current_world,
            enabled: AtomicBool::new(false),
            last_error: Mutex::new(None),
            server: tokio::sync::Mutex::new(ServerState {
                settings: WorldDataSettings::default(),
                cancel: None,
                error: None,
                generation: 0,
            }),
        }
    }

    #[cfg(test)]
    fn in_memory(current_world: CurrentWorld) -> Self {
        let service = Self::new(PathBuf::new(), current_world);
        *lock(&service.store) = Some(WorldDataStore::open_in_memory().unwrap());
        service.enabled.store(true, Ordering::Release);
        service
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    fn with_store<T>(
        &self,
        apply: impl FnOnce(&WorldDataStore) -> StoreResult<T>,
    ) -> StoreResult<T> {
        let mut store = lock(&self.store);
        if store.is_none() {
            *store = Some(WorldDataStore::open(&self.db_path)?);
        }
        apply(store.as_ref().expect("world data store was just opened"))
    }

    /// Reads without creating the database file when it does not exist yet.
    fn with_existing_store<T: Default>(
        &self,
        apply: impl FnOnce(&WorldDataStore) -> StoreResult<T>,
    ) -> StoreResult<T> {
        if lock(&self.store).is_none() && !self.db_path.is_file() {
            return Ok(T::default());
        }
        self.with_store(apply)
    }

    fn set_last_error(&self, error: impl Into<String>) {
        let error = error.into();
        tracing::debug!(error = %error, "VRCX world data request was not applied");
        *lock(&self.last_error) = Some(error);
    }

    pub(crate) fn take_last_error(&self) -> Option<String> {
        lock(&self.last_error).take()
    }

    pub(crate) fn current_world_id(&self) -> Option<String> {
        let world_id = (self.current_world)();
        (!world_id.trim().is_empty()).then_some(world_id)
    }

    /// Handles the text after `[VRCX-World] ` in VRChat's log.
    pub fn process_log_request(&self, data: &str) {
        if !self.is_enabled() {
            return;
        }
        if let Err(error) = self.apply_log_request(data) {
            self.set_last_error(error);
        }
    }

    fn apply_log_request(&self, data: &str) -> Result<(), String> {
        let request: serde_json::Map<String, Value> =
            serde_json::from_str(data.trim()).map_err(|error| error.to_string())?;
        let request_type = text_field(request.get("requestType"))
            .filter(|value| !value.is_empty())
            .ok_or("`requestType` is missing or null")?;
        let connection_key = text_field(request.get("connectionKey")).unwrap_or_default();
        if uuid::Uuid::parse_str(&connection_key).is_err() {
            return Err("Invalid GUID provided as connection key".into());
        }
        let world_id = self
            .with_store(|store| store.world_by_connection_key(&connection_key))?
            .ok_or("Invalid connection key")?;
        let key = text_field(request.get("key")).filter(|value| !value.is_empty());
        let value = text_field(request.get("value"));

        match request_type.to_lowercase().as_str() {
            "store" => {
                let key = key.ok_or("`key` is missing or null")?;
                if key.chars().count() > 255 {
                    return Err("`key` is too long. Keep it below <256 characters.".into());
                }
                let value = value.ok_or("`value` is null")?;
                self.with_store(|store| store.store(&world_id, &key, &value))
            }
            "delete" => {
                let key = key.ok_or("`key` is missing or null")?;
                self.with_store(|store| store.delete(&world_id, &key))
            }
            "delete-all" => self.with_store(|store| store.delete_all(&world_id)),
            "set-setting" => {
                let key = key.ok_or("`key` is missing or null")?;
                let value = value
                    .filter(|value| !value.is_empty())
                    .ok_or("`value` is missing or null")?;
                if key == "externalReads" {
                    let allow = parse_bool(&value).ok_or("Invalid value for externalReads")?;
                    self.with_store(|store| store.set_allow_external_read(&world_id, allow))?;
                }
                Ok(())
            }
            _ => Err("Invalid request type".into()),
        }
    }

    pub(crate) fn ensure_world(&self, world_id: &str) -> StoreResult<String> {
        self.with_store(|store| store.ensure_world(world_id))
    }

    /// Whether `requested` may be read by the current world: its own data, the
    /// shared global store, or a world that turned on external reads.
    pub(crate) fn may_read(&self, requested: &str) -> StoreResult<bool> {
        if requested == GLOBAL_WORLD_ID {
            return Ok(true);
        }
        self.with_store(|store| store.allow_external_read(requested))
    }

    pub(crate) fn get(&self, world_id: &str, key: &str) -> StoreResult<Option<String>> {
        self.with_store(|store| store.get(world_id, key))
    }

    pub(crate) fn get_all(&self, world_id: &str) -> StoreResult<Vec<(String, String)>> {
        self.with_store(|store| store.get_all(world_id))
    }

    pub(crate) fn set_allow_external_read(&self, world_id: &str, allow: bool) -> StoreResult<()> {
        self.with_store(|store| store.set_allow_external_read(world_id, allow))
    }

    pub fn list_worlds(&self) -> Result<Vec<WorldDataWorld>, String> {
        self.with_existing_store(WorldDataStore::list_worlds)
    }

    pub fn list_entries(&self, world_id: &str) -> Result<Vec<WorldDataEntry>, String> {
        self.with_existing_store(|store| store.list_entries(world_id))
    }

    /// Merges another world data file, such as VRCX's `VRCX-WorldData.db`,
    /// into this one. The other file is only read.
    pub fn import_file(&self, source: &std::path::Path) -> Result<WorldDataImportReport, String> {
        if !source.is_file() {
            return Err("That file does not exist.".into());
        }
        let same_file = match (source.canonicalize(), self.db_path.canonicalize()) {
            (Ok(source), Ok(own)) => source == own,
            _ => source == self.db_path,
        };
        if same_file {
            return Err("That is this app's own world data file.".into());
        }
        self.with_store(|store| store.import_from(source))
    }

    pub fn forget_world(&self, world_id: &str) -> Result<(), String> {
        self.with_existing_store(|store| store.forget_world(world_id))
    }

    pub async fn status(&self) -> WorldDataStatus {
        let server = self.server.lock().await;
        WorldDataStatus {
            enabled: server.settings.enabled,
            port: server.settings.port,
            running: server.cancel.is_some(),
            error: server.error.clone(),
        }
    }

    /// Stops the server if it runs, then starts it again when `settings`
    /// turns it on. A port that cannot be opened is reported in the status;
    /// log requests are still stored.
    pub async fn apply_settings(self: &Arc<Self>, settings: WorldDataSettings) -> WorldDataStatus {
        let mut server = self.server.lock().await;
        if let Some(cancel) = server.cancel.take() {
            cancel.cancel();
        }
        server.error = None;
        self.enabled.store(settings.enabled, Ordering::Release);
        if settings.enabled {
            match vrcx_0_local_server::bind_listener(settings.port, false) {
                Ok(listener) => {
                    let cancel = CancellationToken::new();
                    server.generation += 1;
                    let generation = server.generation;
                    let service = Arc::clone(self);
                    let port = settings.port;
                    let serve_cancel = cancel.clone();
                    tokio::spawn(async move {
                        server::serve(Arc::clone(&service), listener, port, serve_cancel).await;
                        service.mark_stopped(generation).await;
                    });
                    server.cancel = Some(cancel);
                    tracing::info!(port = settings.port, "VRCX world data server listening");
                }
                Err(error) => {
                    tracing::warn!(port = settings.port, error = %error, "VRCX world data server could not start");
                    server.error = Some(if error.kind() == std::io::ErrorKind::AddrInUse {
                        format!("Port {} is already in use.", settings.port)
                    } else {
                        format!("Could not open port {}: {error}", settings.port)
                    });
                }
            }
        }
        server.settings = settings;
        drop(server);
        self.status().await
    }

    /// The server task ended. If nobody asked it to, report that in the
    /// status instead of still showing it as running.
    async fn mark_stopped(&self, generation: u64) {
        let mut server = self.server.lock().await;
        if server.generation != generation {
            return;
        }
        if server
            .cancel
            .as_ref()
            .is_some_and(|cancel| !cancel.is_cancelled())
        {
            server.cancel = None;
            server.error = Some("The world data server stopped unexpectedly.".into());
            tracing::warn!("VRCX world data server stopped unexpectedly");
        }
    }

    pub async fn stop(&self) {
        if let Some(cancel) = self.server.lock().await.cancel.take() {
            cancel.cancel();
        }
        self.enabled.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(world: &'static str) -> WorldDataService {
        WorldDataService::in_memory(Arc::new(move || world.to_string()))
    }

    fn request(service: &WorldDataService, json: &str) -> Option<String> {
        service.process_log_request(json);
        service.take_last_error()
    }

    #[test]
    fn log_requests_store_and_delete_values() {
        let service = service("wrld_a");
        let key = service.ensure_world("wrld_a").unwrap();
        assert_eq!(
            request(
                &service,
                &format!(
                    r#"{{"requestType":"store","connectionKey":"{key}","key":"score","value":"7"}}"#
                )
            ),
            None
        );
        assert_eq!(
            service.get("wrld_a", "score").unwrap().as_deref(),
            Some("7")
        );

        assert_eq!(
            request(
                &service,
                &format!(
                    r#"{{"requestType":"STORE","connectionKey":"{key}","key":"n","value":5}}"#
                )
            ),
            None
        );
        assert_eq!(service.get("wrld_a", "n").unwrap().as_deref(), Some("5"));

        assert_eq!(
            request(
                &service,
                &format!(r#"{{"requestType":"delete","connectionKey":"{key}","key":"score"}}"#)
            ),
            None
        );
        assert_eq!(service.get("wrld_a", "score").unwrap(), None);

        assert_eq!(
            request(
                &service,
                &format!(r#"{{"requestType":"delete-all","connectionKey":"{key}"}}"#)
            ),
            None
        );
        assert!(service.get_all("wrld_a").unwrap().is_empty());
    }

    #[test]
    fn log_requests_report_vrcx_errors() {
        let service = service("wrld_a");
        let key = service.ensure_world("wrld_a").unwrap();
        assert!(request(&service, "not json").is_some());
        assert_eq!(
            request(&service, r#"{"connectionKey":"x"}"#).as_deref(),
            Some("`requestType` is missing or null")
        );
        assert_eq!(
            request(
                &service,
                r#"{"requestType":"store","connectionKey":"nope"}"#
            )
            .as_deref(),
            Some("Invalid GUID provided as connection key")
        );
        assert_eq!(
            request(
                &service,
                &format!(
                    r#"{{"requestType":"store","connectionKey":"{}"}}"#,
                    uuid::Uuid::new_v4()
                )
            )
            .as_deref(),
            Some("Invalid connection key")
        );
        assert_eq!(
            request(
                &service,
                &format!(r#"{{"requestType":"store","connectionKey":"{key}","key":"k"}}"#)
            )
            .as_deref(),
            Some("`value` is null")
        );
        assert_eq!(
            request(
                &service,
                &format!(
                    r#"{{"requestType":"store","connectionKey":"{key}","key":"{}","value":"v"}}"#,
                    "k".repeat(256)
                )
            )
            .as_deref(),
            Some("`key` is too long. Keep it below <256 characters.")
        );
        assert_eq!(
            request(
                &service,
                &format!(r#"{{"requestType":"explode","connectionKey":"{key}"}}"#)
            )
            .as_deref(),
            Some("Invalid request type")
        );
    }

    #[test]
    fn worlds_can_allow_external_reads() {
        let service = service("wrld_a");
        let key = service.ensure_world("wrld_a").unwrap();
        assert!(!service.may_read("wrld_a").unwrap());
        assert_eq!(
            request(
                &service,
                &format!(
                    r#"{{"requestType":"set-setting","connectionKey":"{key}","key":"externalReads","value":"True"}}"#
                )
            ),
            None
        );
        assert!(service.may_read("wrld_a").unwrap());
        assert!(service.may_read("global").unwrap());
        assert_eq!(
            request(
                &service,
                &format!(
                    r#"{{"requestType":"set-setting","connectionKey":"{key}","key":"externalReads","value":"maybe"}}"#
                )
            )
            .as_deref(),
            Some("Invalid value for externalReads")
        );
    }

    #[test]
    fn nothing_is_stored_while_disabled() {
        let service = service("wrld_a");
        let key = service.ensure_world("wrld_a").unwrap();
        service.enabled.store(false, Ordering::Release);
        service.process_log_request(&format!(
            r#"{{"requestType":"store","connectionKey":"{key}","key":"k","value":"v"}}"#
        ));
        assert_eq!(service.get("wrld_a", "k").unwrap(), None);
        assert_eq!(service.take_last_error(), None);
    }

    #[test]
    fn listing_does_not_create_a_missing_database() {
        let dir = std::env::temp_dir().join(format!("vrcx-world-data-{}", uuid::Uuid::new_v4()));
        let service = WorldDataService::new(dir.join(WORLD_DATA_DB_FILE), Arc::new(String::new));
        assert!(service.list_worlds().unwrap().is_empty());
        assert!(!dir.exists());
    }
}
