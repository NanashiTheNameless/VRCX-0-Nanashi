use std::sync::Arc;

use vrcx_0_application::auth::{AuthCredentialStore, SealedAuthSecret};
use vrcx_0_application_core::Result;
use vrcx_0_persistence::{config::ConfigRepository, secrets, DatabaseService};

#[derive(Clone)]
pub struct LocalAuthCredentialStore {
    config: ConfigRepository,
}

impl LocalAuthCredentialStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self {
            config: ConfigRepository::new(db),
        }
    }

    pub fn from_repository(config: ConfigRepository) -> Self {
        Self { config }
    }
}

impl AuthCredentialStore for LocalAuthCredentialStore {
    fn get_raw(&self, key: &str) -> Result<Option<String>> {
        self.config.get_raw(key).map_err(Into::into)
    }

    fn get_string(&self, key: &str, default_value: &str) -> Result<String> {
        self.config
            .get_string(key, default_value)
            .map_err(Into::into)
    }

    fn get_bool(&self, key: &str, default_value: bool) -> Result<bool> {
        self.config.get_bool(key, default_value).map_err(Into::into)
    }

    fn set_string(&self, key: &str, value: &str) -> Result<()> {
        self.config.set_string(key, value).map_err(Into::into)
    }

    fn remove(&self, key: &str) -> Result<()> {
        self.config.remove(key).map_err(Into::into)
    }

    fn is_encrypting_writes(&self) -> bool {
        secrets::is_encrypting_writes()
    }

    fn is_secret_store_initialized(&self) -> bool {
        secrets::is_initialized()
    }

    fn open_secret(&self, stored: &str) -> Option<String> {
        secrets::open_secret(stored)
    }

    fn seal_secret(&self, previous: Option<&str>, plaintext: &str) -> SealedAuthSecret {
        let sealed = secrets::seal_secret_with_status(previous, plaintext);
        SealedAuthSecret {
            stored: sealed.stored,
            encrypted: sealed.encrypted,
        }
    }

    fn is_sealed_secret(&self, value: &str) -> bool {
        secrets::is_sealed_secret(value)
    }

    fn is_other_machine_secret(&self, value: &str) -> bool {
        secrets::is_other_machine_secret(value)
    }

    fn is_own_secret_behind_other_machines(&self, value: &str) -> bool {
        secrets::promote_own_slot(value).is_some()
    }
}
