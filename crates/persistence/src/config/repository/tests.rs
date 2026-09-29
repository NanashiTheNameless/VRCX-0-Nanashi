use std::path::PathBuf;
use std::sync::Arc;

use crate::database::DatabaseService;
use crate::Error;

use crate::common::ParamsBuilder;
use crate::config::{config_list_values, migrate_sensitive_config_obfuscation, ConfigKey};

use super::{
    ensure_config_table, get_bool, get_json, get_raw, get_string, remove, set_bool, set_raw,
    set_string, ConfigRepository,
};

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

struct TestDatabase {
    _dir: TestDir,
    db: Arc<DatabaseService>,
}

fn test_db(name: &str) -> Result<TestDatabase, Error> {
    let dir = TestDir::new(name);
    let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3"))?);
    Ok(TestDatabase { _dir: dir, db })
}

#[test]
fn resolves_frontend_config_keys() {
    assert_eq!(
        ConfigKey::new("logResourceLoad").as_str(),
        "config:vrcx_logresourceload"
    );
    assert_eq!(
        ConfigKey::new("VRCX_GameLogDisabled").as_str(),
        "config:vrcx_gamelogdisabled"
    );
    assert_eq!(
        ConfigKey::new("config:vrcx_existing").as_str(),
        "config:vrcx_existing"
    );
    assert_eq!(
        ConfigKey::new("config:VRCX_Existing").as_str(),
        "config:vrcx_existing"
    );
    assert_eq!(
        ConfigKey::new("  VRCX_GameLogDisabled  ").as_str(),
        "config:vrcx_gamelogdisabled"
    );
}

#[test]
fn reads_and_writes_bool_string_and_json_values() -> Result<(), Error> {
    let test_db = test_db("store-config-repository")?;
    let repo = ConfigRepository::new(Arc::clone(&test_db.db));

    assert!(!repo.get_bool("logResourceLoad", false)?);
    repo.set_bool("logResourceLoad", true)?;
    repo.set_string("customKey", "custom-value")?;
    repo.set_json("jsonKey", &serde_json::json!({ "enabled": true }))?;

    assert!(get_bool(&test_db.db, "logResourceLoad", false)?);
    assert_eq!(repo.get_raw("customKey")?, Some("custom-value".into()));
    assert_eq!(
        get_json(&test_db.db, "jsonKey", serde_json::json!({}))?,
        serde_json::json!({ "enabled": true })
    );
    Ok(())
}

#[test]
fn bool_reading_accepts_legacy_shapes() -> Result<(), Error> {
    let test_db = test_db("store-config-bool-shapes")?;

    set_raw(&test_db.db, "one", "1")?;
    set_raw(&test_db.db, "zero", "0")?;
    set_raw(&test_db.db, "trueString", "true")?;
    set_raw(&test_db.db, "falseString", "false")?;

    assert!(get_bool(&test_db.db, "one", false)?);
    assert!(!get_bool(&test_db.db, "zero", true)?);
    assert!(get_bool(&test_db.db, "trueString", false)?);
    assert!(!get_bool(&test_db.db, "falseString", true)?);
    Ok(())
}

#[test]
fn remove_deletes_existing_values() -> Result<(), Error> {
    let test_db = test_db("store-config-remove")?;

    set_string(&test_db.db, "customKey", "value")?;
    assert_eq!(get_raw(&test_db.db, "customKey")?, Some("value".into()));
    remove(&test_db.db, "customKey")?;
    assert_eq!(get_raw(&test_db.db, "customKey")?, None);
    Ok(())
}

fn stored_value(db: &DatabaseService, key: &str) -> String {
    db.execute(
        "SELECT value FROM configs WHERE key = @key",
        &ParamsBuilder::new()
            .set("key", ConfigKey::new(key).as_str())
            .build(),
    )
    .unwrap()[0][0]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn sensitive_config_is_obfuscated_at_rest_and_plaintext_to_callers() -> Result<(), Error> {
    let test_db = test_db("store-sensitive-config")?;
    let repo = ConfigRepository::new(Arc::clone(&test_db.db));
    let webhook_url = "https://example.test/hooks/private-token";

    repo.set_string("webhookUrl", webhook_url)?;

    let stored = stored_value(&test_db.db, "webhookUrl");
    assert!(stored.starts_with("cfgobf1:"));
    assert!(!stored.contains(webhook_url));
    assert_eq!(repo.get_string("webhookUrl", "")?, webhook_url);
    let listed = config_list_values(&test_db.db)?;
    assert_eq!(
        listed
            .iter()
            .find(|entry| entry.key == "config:vrcx_webhookurl")
            .map(|entry| entry.value.as_str()),
        Some(webhook_url)
    );
    Ok(())
}

#[test]
fn existing_sensitive_plaintext_is_migrated_once() -> Result<(), Error> {
    let test_db = test_db("migrate-sensitive-config")?;
    ensure_config_table(&test_db.db)?;
    test_db.db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES (@key, @value)",
        &ParamsBuilder::new()
            .set("key", ConfigKey::new("mcpServerToken").as_str())
            .set("value", "legacy-visible-token")
            .build(),
    )?;
    set_bool(
        &test_db.db,
        crate::secrets::CLEANUP_COMPLETED_CONFIG_KEY,
        true,
    )?;

    assert!(migrate_sensitive_config_obfuscation(&test_db.db)?);
    assert!(!migrate_sensitive_config_obfuscation(&test_db.db)?);

    let stored = stored_value(&test_db.db, "mcpServerToken");
    assert!(stored.starts_with("cfgobf1:"));
    assert!(!stored.contains("legacy-visible-token"));
    assert_eq!(
        get_string(&test_db.db, "mcpServerToken", "")?,
        "legacy-visible-token"
    );
    assert_eq!(
        get_raw(&test_db.db, crate::secrets::CLEANUP_COMPLETED_CONFIG_KEY)?,
        None
    );
    Ok(())
}

#[test]
fn existing_assistant_obfuscation_is_wrapped_without_changing_read_value() -> Result<(), Error> {
    let test_db = test_db("migrate-assistant-sensitive-config")?;
    ensure_config_table(&test_db.db)?;
    test_db.db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES (@key, @value)",
        &ParamsBuilder::new()
            .set("key", ConfigKey::new("assistant.apiKey").as_str())
            .set("value", "obf1:012345")
            .build(),
    )?;

    assert!(migrate_sensitive_config_obfuscation(&test_db.db)?);

    assert!(stored_value(&test_db.db, "assistant.apiKey").starts_with("cfgobf1:"));
    assert_eq!(
        get_string(&test_db.db, "assistant.apiKey", "")?,
        "obf1:012345"
    );
    Ok(())
}

#[test]
fn migration_wraps_legacy_plaintext_that_uses_the_reserved_prefix() -> Result<(), Error> {
    let test_db = test_db("migrate-sensitive-config-prefix-collision")?;
    ensure_config_table(&test_db.db)?;
    let plaintext = "cfgobf1:not-an-obfuscated-frame";
    test_db.db.execute_non_query(
        "INSERT INTO configs (key, value) VALUES (@key, @value)",
        &ParamsBuilder::new()
            .set("key", ConfigKey::new("mcpServerToken").as_str())
            .set("value", plaintext)
            .build(),
    )?;

    assert!(migrate_sensitive_config_obfuscation(&test_db.db)?);
    assert_ne!(stored_value(&test_db.db, "mcpServerToken"), plaintext);
    assert_eq!(get_string(&test_db.db, "mcpServerToken", "")?, plaintext);
    Ok(())
}
