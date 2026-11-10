//! Public and password follow links: the app seals its own location for the
//! configured RemoteSync server, which stores ciphertext it cannot read.
//! Nothing is sent until the user creates a link, and only while one is on.

use std::collections::BTreeMap;
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use vrcx_0_application_core::LocalGameContextSnapshot;
use vrcx_0_core::location::parse_location;
use vrcx_0_nanashi_website_protocol::api::FollowSharePassword;
use vrcx_0_nanashi_website_protocol::follow::{
    self, FollowKeys, FollowLocation, FollowState, LinkKey, PasswordLock,
};
use vrcx_0_remote_sync::{Error as SyncError, RemoteSyncClient, OFFICIAL_API};

use super::remote_sync::API_ORIGIN_KEY;
use super::DesktopRuntimeHostState;
use crate::{Error, Result};

pub const FOLLOW_SHARES_KEY: &str = "followLinkShares";
const FOLLOW_SHARE_SECRETS_KEY: &str = "followLinkSharesSecret";
const MAX_SHARES: usize = 5;
const PUSH_TICK: Duration = Duration::from_secs(60);
/// Sends an unchanged location again this often, so viewers can tell the
/// PC is still on and the share does not expire (it lasts a day).
const HEARTBEAT: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FollowShareEntry {
    pub id: String,
    pub label: String,
    /// `public` or `password`.
    pub mode: String,
    pub code: String,
    pub enabled: bool,
    pub expired: bool,
    pub created_at: i64,
    /// Only for building the link on this PC; never stored in plain text.
    pub link_key: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShareMeta {
    id: String,
    label: String,
    mode: String,
    code: String,
    enabled: bool,
    #[serde(default)]
    expired: bool,
    created_at: i64,
    api_origin: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShareSecret {
    link_key: String,
    write_token: String,
    content_key: String,
}

fn custom(message: impl Into<String>) -> Error {
    Error::from(vrcx_0_application_core::Error::Custom(message.into()))
}

/// What a share publishes for the current local game state. Invite and
/// invite+ locations work as join tickets, so they are never published.
pub fn follow_state_for(snapshot: &LocalGameContextSnapshot) -> FollowState {
    let LocalGameContextSnapshot::Available {
        is_game_running: true,
        location,
        world_name,
        ..
    } = snapshot
    else {
        return FollowState::Offline;
    };
    let parsed = parse_location(location);
    if !parsed.is_real_instance || parsed.world_id.is_empty() || parsed.instance_id.is_empty() {
        return FollowState::Private;
    }
    match parsed.access_type.as_str() {
        "public" | "group" | "friends" | "friends+" => FollowState::Instance {
            world_id: parsed.world_id,
            instance_id: parsed.instance_id,
            world_name: world_name.chars().take(200).collect(),
        },
        _ => FollowState::Private,
    }
}

impl DesktopRuntimeHostState {
    fn follow_share_metas(&self) -> Vec<ShareMeta> {
        serde_json::from_str(&self.config_string(FOLLOW_SHARES_KEY, "[]")).unwrap_or_default()
    }

    fn save_follow_share_metas(&self, metas: &[ShareMeta]) -> Result<()> {
        let text = serde_json::to_string(metas).map_err(|error| custom(error.to_string()))?;
        Ok(self
            .runtime
            .desktop_assembly()
            .config_store()
            .set_string(FOLLOW_SHARES_KEY, &text)?)
    }

    fn follow_share_secrets(&self) -> Result<BTreeMap<String, ShareSecret>> {
        Ok(self
            .remote_sync_secret_get(FOLLOW_SHARE_SECRETS_KEY)?
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default())
    }

    fn save_follow_share_secrets(&self, secrets: &BTreeMap<String, ShareSecret>) -> Result<()> {
        let text = serde_json::to_string(secrets).map_err(|error| custom(error.to_string()))?;
        self.remote_sync_secret_set(FOLLOW_SHARE_SECRETS_KEY, &text)
    }

    pub fn follow_share_list(&self) -> Result<Vec<FollowShareEntry>> {
        let secrets = self.follow_share_secrets()?;
        Ok(self
            .follow_share_metas()
            .into_iter()
            .filter_map(|meta| {
                let secret = secrets.get(&meta.id)?;
                Some(FollowShareEntry {
                    id: meta.id,
                    label: meta.label,
                    mode: meta.mode,
                    code: meta.code,
                    enabled: meta.enabled,
                    expired: meta.expired,
                    created_at: meta.created_at,
                    link_key: secret.link_key.clone(),
                })
            })
            .collect())
    }

    pub async fn follow_share_create(
        &self,
        label: String,
        password: Option<String>,
    ) -> Result<FollowShareEntry> {
        let mut metas = self.follow_share_metas();
        if metas.len() >= MAX_SHARES {
            return Err(custom(format!("At most {MAX_SHARES} live location links.")));
        }
        let password = password.filter(|password| !password.is_empty());
        if let Some(password) = &password {
            let chars = password.chars().count();
            if !(follow::MIN_PASSWORD_CHARS..=follow::MAX_PASSWORD_CHARS).contains(&chars) {
                return Err(custom(format!(
                    "The password needs at least {} characters.",
                    follow::MIN_PASSWORD_CHARS
                )));
            }
        }
        let (link_key, keys, lock) = tokio::task::spawn_blocking(move || {
            let link_key = LinkKey::generate()?;
            let lock = password
                .as_ref()
                .map(|_| PasswordLock::generate())
                .transpose()?;
            let keys = follow::derive_keys(&link_key, password.as_deref().zip(lock.as_ref()))?;
            Ok::<_, vrcx_0_nanashi_website_protocol::Error>((link_key, keys, lock))
        })
        .await
        .map_err(|error| custom(error.to_string()))?
        .map_err(|error| custom(error.to_string()))?;
        let password_request = match (&lock, &keys.auth) {
            (Some(lock), Some(auth)) => Some(FollowSharePassword {
                lock: lock.clone(),
                auth: auth.to_vec(),
            }),
            _ => None,
        };
        let api_origin = self.config_string(API_ORIGIN_KEY, OFFICIAL_API);
        let client =
            RemoteSyncClient::new(&api_origin).map_err(|error| custom(error.to_string()))?;
        let created = client
            .follow_share_create(password_request)
            .await
            .map_err(|error| custom(error.to_string()))?;
        let id = created.code.to_ascii_lowercase();
        let meta = ShareMeta {
            id: id.clone(),
            label: label.chars().take(60).collect(),
            mode: if lock.is_some() { "password" } else { "public" }.into(),
            code: created.code.clone(),
            enabled: true,
            expired: false,
            created_at: vrcx_0_core::time::now_epoch(),
            api_origin,
        };
        let mut secrets = self.follow_share_secrets()?;
        secrets.insert(
            id,
            ShareSecret {
                link_key: link_key.to_fragment(),
                write_token: created.write_token,
                content_key: STANDARD.encode(keys.content_key()),
            },
        );
        self.save_follow_share_secrets(&secrets)?;
        metas.push(meta.clone());
        self.save_follow_share_metas(&metas)?;
        let state = follow_state_for(&self.runtime.realtime_runtime().local_game_context());
        if let Err(error) = self
            .push_follow_share(&meta, &secrets[&meta.id], &state)
            .await
        {
            tracing::warn!("first follow share update failed: {error}");
        }
        Ok(FollowShareEntry {
            id: meta.id,
            label: meta.label,
            mode: meta.mode,
            code: meta.code,
            enabled: true,
            expired: false,
            created_at: meta.created_at,
            link_key: link_key.to_fragment(),
        })
    }

    pub fn follow_share_set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        let mut metas = self.follow_share_metas();
        let meta = metas
            .iter_mut()
            .find(|meta| meta.id == id)
            .ok_or_else(|| custom("That link no longer exists."))?;
        meta.enabled = enabled && !meta.expired;
        self.save_follow_share_metas(&metas)
    }

    /// Deletes the link on the server first, so a viewer stops seeing the
    /// location at once, and forgets it here even if the server is gone.
    pub async fn follow_share_delete(&self, id: &str) -> Result<()> {
        let mut metas = self.follow_share_metas();
        let mut secrets = self.follow_share_secrets()?;
        if let (Some(meta), Some(secret)) =
            (metas.iter().find(|meta| meta.id == id), secrets.get(id))
        {
            if !meta.expired {
                if let Ok(client) = RemoteSyncClient::new(&meta.api_origin) {
                    if let Err(error) = client
                        .follow_share_delete(&meta.code, &secret.write_token)
                        .await
                    {
                        tracing::warn!("follow share delete failed: {error}");
                    }
                }
            }
        }
        metas.retain(|meta| meta.id != id);
        secrets.remove(id);
        self.save_follow_share_secrets(&secrets)?;
        self.save_follow_share_metas(&metas)
    }

    async fn push_follow_share(
        &self,
        meta: &ShareMeta,
        secret: &ShareSecret,
        state: &FollowState,
    ) -> std::result::Result<(), SyncError> {
        let content_key = STANDARD
            .decode(&secret.content_key)
            .map_err(|_| SyncError::InvalidResponse)?;
        let keys =
            FollowKeys::from_content_key(&content_key).map_err(|_| SyncError::InvalidResponse)?;
        let sealed = follow::seal(
            &keys,
            &meta.code,
            &FollowLocation {
                v: follow::VERSION,
                state: state.clone(),
                updated_at: vrcx_0_core::time::now_epoch(),
            },
        )
        .map_err(|_| SyncError::InvalidResponse)?;
        RemoteSyncClient::new(&meta.api_origin)?
            .follow_share_update(&meta.code, &secret.write_token, sealed)
            .await
    }

    /// Runs for the life of the app. While no live location link is on it
    /// only reads local settings and contacts nothing.
    pub async fn follow_share_push_loop(&self) {
        let mut last_state: Option<FollowState> = None;
        let mut last_push: Option<tokio::time::Instant> = None;
        loop {
            let jitter = Duration::from_millis(u64::from(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.subsec_millis())
                    .unwrap_or(0)
                    * 15,
            ));
            tokio::time::sleep(PUSH_TICK + jitter).await;
            let metas: Vec<ShareMeta> = self
                .follow_share_metas()
                .into_iter()
                .filter(|meta| meta.enabled && !meta.expired)
                .collect();
            if metas.is_empty() {
                last_state = None;
                continue;
            }
            let state = follow_state_for(&self.runtime.realtime_runtime().local_game_context());
            let due = last_state.as_ref() != Some(&state)
                || last_push.is_none_or(|at| at.elapsed() >= HEARTBEAT);
            if !due {
                continue;
            }
            let Ok(secrets) = self.follow_share_secrets() else {
                continue;
            };
            let mut expired = Vec::new();
            for meta in &metas {
                let Some(secret) = secrets.get(&meta.id) else {
                    continue;
                };
                match self.push_follow_share(meta, secret, &state).await {
                    Ok(()) => {}
                    Err(SyncError::Api { status: 404, .. }) => expired.push(meta.id.clone()),
                    Err(error) => tracing::warn!("follow share update failed: {error}"),
                }
            }
            if !expired.is_empty() {
                let mut all = self.follow_share_metas();
                for meta in all.iter_mut().filter(|meta| expired.contains(&meta.id)) {
                    meta.expired = true;
                    meta.enabled = false;
                }
                if let Err(error) = self.save_follow_share_metas(&all) {
                    tracing::warn!("follow share expiry save failed: {error}");
                }
            }
            last_state = Some(state);
            last_push = Some(tokio::time::Instant::now());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn running(location: &str) -> LocalGameContextSnapshot {
        LocalGameContextSnapshot::Available {
            is_game_running: true,
            location: location.into(),
            destination: String::new(),
            world_name: "World".into(),
            player_user_ids: Vec::new(),
        }
    }

    #[test]
    fn never_publishes_invite_locations() {
        for location in [
            "wrld_a:1~private(usr_x)",
            "wrld_a:1~private(usr_x)~canRequestInvite",
            "private",
            "traveling",
        ] {
            assert_eq!(
                follow_state_for(&running(location)),
                FollowState::Private,
                "{location}"
            );
        }
    }

    #[test]
    fn publishes_joinable_locations_and_offline() {
        for location in [
            "wrld_a:1",
            "wrld_a:1~friends(usr_x)",
            "wrld_a:1~hidden(usr_x)",
            "wrld_a:1~group(grp_x)~groupAccessType(public)",
        ] {
            assert!(
                matches!(
                    follow_state_for(&running(location)),
                    FollowState::Instance { .. }
                ),
                "{location}"
            );
        }
        assert_eq!(
            follow_state_for(&LocalGameContextSnapshot::Unavailable),
            FollowState::Offline
        );
        assert_eq!(
            follow_state_for(&LocalGameContextSnapshot::Available {
                is_game_running: false,
                location: "wrld_a:1".into(),
                destination: String::new(),
                world_name: String::new(),
                player_user_ids: Vec::new(),
            }),
            FollowState::Offline
        );
    }
}
