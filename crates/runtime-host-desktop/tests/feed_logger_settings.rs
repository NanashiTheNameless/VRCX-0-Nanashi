use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use vrcx_0_application::auth::{AuthCredentialStore, SealedAuthSecret};
use vrcx_0_application_core::{
    FileCache, MemoryFileCachePort, MemoryWorldCachePort, NoopWebClientPort, Result,
    RuntimeAuthScope, RuntimeEventBus, WebClient, WorldCache,
};
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_runtime_host_desktop::feed_logger::{
    DesktopFeedLoggerRuntime, FeedLoggerError, FeedLoggerProbe, SettingsCheck,
};

#[derive(Default)]
struct MemoryCredentials {
    values: Mutex<HashMap<String, String>>,
}

impl AuthCredentialStore for MemoryCredentials {
    fn get_raw(&self, key: &str) -> Result<Option<String>> {
        Ok(self.values.lock().unwrap().get(key).cloned())
    }
    fn get_string(&self, key: &str, default_value: &str) -> Result<String> {
        Ok(self
            .get_raw(key)?
            .unwrap_or_else(|| default_value.to_string()))
    }
    fn get_bool(&self, key: &str, default_value: bool) -> Result<bool> {
        Ok(self
            .get_raw(key)?
            .and_then(|value| value.parse().ok())
            .unwrap_or(default_value))
    }
    fn set_string(&self, key: &str, value: &str) -> Result<()> {
        self.values
            .lock()
            .unwrap()
            .insert(key.to_string(), value.to_string());
        Ok(())
    }
    fn remove(&self, key: &str) -> Result<()> {
        self.values.lock().unwrap().remove(key);
        Ok(())
    }
    fn is_encrypting_writes(&self) -> bool {
        false
    }
    fn is_secret_store_initialized(&self) -> bool {
        false
    }
    fn open_secret(&self, stored: &str) -> Option<String> {
        Some(stored.to_string())
    }
    fn seal_secret(&self, _previous: Option<&str>, plaintext: &str) -> SealedAuthSecret {
        SealedAuthSecret {
            stored: plaintext.to_string(),
            encrypted: false,
        }
    }
    fn is_sealed_secret(&self, _value: &str) -> bool {
        false
    }
    fn is_other_machine_secret(&self, _value: &str) -> bool {
        false
    }
    fn is_own_secret_behind_other_machines(&self, _value: &str) -> bool {
        false
    }
}

struct TestDir(PathBuf);

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const SAVED_RECORDER: &str = r#"{"address":"http://127.0.0.1:8787","password":"password123"}"#;

fn desktop() -> (TestDir, DesktopFeedLoggerRuntime) {
    desktop_with_saved_settings(None)
}

static NEXT_TEST_DIR: AtomicUsize = AtomicUsize::new(0);

fn desktop_with_saved_settings(settings: Option<&str>) -> (TestDir, DesktopFeedLoggerRuntime) {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "vrcx-0-feed-logger-settings-{}-{}-{nonce}",
        std::process::id(),
        NEXT_TEST_DIR.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let db = Arc::new(DatabaseService::new(&dir.join("VRCX-0.sqlite3")).unwrap());
    if let Some(settings) = settings {
        ConfigRepository::new(Arc::clone(&db))
            .set_raw("feedLogger", settings)
            .unwrap();
    }
    let runtime = DesktopFeedLoggerRuntime::new(
        db,
        Arc::new(WorldCache::new(MemoryWorldCachePort::default())),
        FileCache::new(MemoryFileCachePort::default()),
        Arc::new(WebClient::new(NoopWebClientPort)),
        RuntimeEventBus::new(),
        RuntimeAuthScope::new(),
        Arc::new(MemoryCredentials::default()),
    );
    (TestDir(dir), runtime)
}

#[tokio::test]
async fn a_recorder_that_cannot_be_reached_is_reported_and_nothing_is_saved() {
    let (_dir, desktop) = desktop();

    let check = desktop
        .verify_settings("127.0.0.1:1".into(), "password123".into())
        .await;

    assert!(matches!(
        check,
        SettingsCheck::Unhealthy(FeedLoggerProbe::Unreachable { .. })
    ));
    assert_eq!(desktop.settings_view().unwrap().address, None);
    assert!(desktop.ensure_backup_can_turn_off(false).is_ok());
}

#[tokio::test]
async fn an_address_that_is_not_a_web_address_is_refused_and_nothing_is_saved() {
    let (_dir, desktop) = desktop();

    let check = desktop
        .verify_settings("ftp://recorder".into(), "password123".into())
        .await;

    assert!(matches!(
        check,
        SettingsCheck::Invalid(FeedLoggerError::Client(_))
    ));
    assert_eq!(desktop.settings_view().unwrap().address, None);
}

#[test]
fn without_a_recorder_a_reconnect_always_writes_what_changed() {
    let (_dir, desktop) = desktop();

    assert!(!desktop.recorder_may_be_recording());
}

#[test]
fn with_a_recorder_that_vrcx0_is_not_linked_to_a_reconnect_is_left_to_the_backfill() {
    let (_dir, desktop) = desktop_with_saved_settings(Some(SAVED_RECORDER));

    assert!(desktop.recorder_may_be_recording());
}

#[test]
fn automatic_backups_cannot_be_turned_off_while_a_recorder_is_set_up() {
    let (_dir, desktop) = desktop_with_saved_settings(Some(SAVED_RECORDER));

    assert!(matches!(
        desktop.ensure_backup_can_turn_off(false),
        Err(FeedLoggerError::BackupRequired)
    ));
    assert!(desktop.ensure_backup_can_turn_off(true).is_ok());

    desktop.clear_settings().unwrap();

    assert!(desktop.ensure_backup_can_turn_off(false).is_ok());
    assert!(!desktop.recorder_may_be_recording());
}

#[test]
fn a_recorder_setting_this_machine_can_no_longer_decrypt_counts_as_no_recorder() {
    vrcx_0_persistence::secrets::init_secrets(Some([7; 32]), false);
    let (_dir, desktop) = desktop_with_saved_settings(Some(
        r#"{"address":"http://127.0.0.1:8787","password":"enc1:sealed-by-another-machine"}"#,
    ));

    assert!(!desktop.recorder_may_be_recording());
    assert_eq!(desktop.settings_view().unwrap().address, None);
}
