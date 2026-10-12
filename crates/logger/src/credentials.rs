use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::store::{Store, StoreError, CREDENTIALS};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCredentials {
    pub username: String,
    pub password: Option<String>,
    pub account_id: String,
    pub cookies: String,
}

pub struct CredentialVault {
    store: Arc<Store>,
}

impl CredentialVault {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }

    pub fn load(&self) -> Result<Option<StoredCredentials>, StoreError> {
        let Some(json) = self.store.get_sealed(CREDENTIALS)? else {
            return Ok(None);
        };
        match serde_json::from_slice(&json) {
            Ok(credentials) => Ok(Some(credentials)),
            Err(error) => {
                tracing::warn!(error = %error, "stored credentials are unreadable; ignoring them");
                Ok(None)
            }
        }
    }

    pub fn save(&self, credentials: &StoredCredentials) -> Result<(), StoreError> {
        let json = serde_json::to_vec(credentials)?;
        self.store.put_sealed(CREDENTIALS, &json)
    }

    pub fn update_cookies(&self, cookies: String) -> Result<(), StoreError> {
        let Some(mut credentials) = self.load()? else {
            return Ok(());
        };
        if credentials.cookies == cookies {
            return Ok(());
        }
        credentials.cookies = cookies;
        self.save(&credentials)
    }

    pub fn clear(&self) -> Result<(), StoreError> {
        self.store.delete_sealed(CREDENTIALS)
    }
}
