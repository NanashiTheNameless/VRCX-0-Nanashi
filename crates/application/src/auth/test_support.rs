use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use vrcx_0_application_core::Result;

use super::{AuthCredentialStore, AuthSessionCookies, SealedAuthSecret};

#[derive(Default)]
pub(super) struct MemoryAuthSessionCookies {
    value: Mutex<String>,
}

impl MemoryAuthSessionCookies {
    pub(super) fn get_cookies(&self) -> String {
        self.get()
    }

    pub(super) fn set_cookies(&self, cookies: &str) -> Result<()> {
        self.set(cookies)
    }
}

impl AuthSessionCookies for MemoryAuthSessionCookies {
    fn get(&self) -> String {
        self.value
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    fn set(&self, cookies: &str) -> Result<()> {
        *self.value.lock().unwrap_or_else(|error| error.into_inner()) = cookies.to_string();
        Ok(())
    }

    fn clear(&self) {
        self.value
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }

    fn clear_everywhere(&self) {
        self.clear();
    }

    fn clear_auth(&self) {
        self.clear();
    }

    fn save(&self) {}
}

#[derive(Clone, Default)]
pub(super) struct MemoryAuthCredentialStore {
    values: Arc<Mutex<HashMap<String, String>>>,
}

impl AuthCredentialStore for MemoryAuthCredentialStore {
    fn get_raw(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(key)
            .cloned())
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
            .unwrap_or_else(|error| error.into_inner())
            .insert(key.to_string(), value.to_string());
        Ok(())
    }

    fn remove(&self, key: &str) -> Result<()> {
        self.values
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(key);
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
