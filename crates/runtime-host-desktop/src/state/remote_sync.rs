//! Fork: RemoteSync history sync. Secrets live in the protected credential
//! store, and nothing here contacts a server unless the backend is set to
//! RemoteSync and this PC is paired.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use vrcx_0_application_core::RemoteSyncImportedPayload;
use vrcx_0_core::OwnerId;
use vrcx_0_nanashi_website_protocol as protocol;
use vrcx_0_persistence::remote_sync::{self as store, SyncLogEntry};
use vrcx_0_remote_sync::engine::{self, SignerKey, SyncSecret};
use vrcx_0_remote_sync::sync::{sync_account, AuthorizedClient, SyncIdentity, SyncReport};
use vrcx_0_remote_sync::{RemoteSyncClient, OFFICIAL_API};
use zeroize::Zeroizing;

use super::DesktopRuntimeHostState;
use crate::{Error, Result};

pub const BACKEND_KEY: &str = "historySyncBackend";
pub const BACKEND_REMOTESYNC: &str = "remotesync";
pub const API_ORIGIN_KEY: &str = "remoteSyncApiOrigin";
pub const ACCOUNT_ID_KEY: &str = "remoteSyncAccountId";
pub const TOKEN_KEY: &str = "remoteSyncApiToken";
const SYNC_SECRET_KEY: &str = "remoteSyncSecret";
const DEVICE_KEY_KEY: &str = "remoteSyncDeviceKey";
pub const WEBSITE_ORIGIN_KEY: &str = "remoteSyncWebsiteOrigin";
const SHARED_COLLECTIONS_KEY: &str = "remoteSyncSharedCollections";
const SHARE_MAX_WORLDS: usize = 500;
const SHARE_IMAGE_PREFIXES: [&str; 2] = ["https://api.vrchat.cloud/", "https://assets.vrchat.com/"];

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CollectorSnapshot {
    pub state: String,
    pub since_ms: Option<i64>,
    pub last_chunk_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub live_age_ms: Option<u64>,
    pub live: Option<CollectorLiveSnapshot>,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CollectorLiveSnapshot {
    pub created_at_ms: i64,
    pub own_status: String,
    pub own_status_description: String,
    pub own_location: String,
    pub friends: Vec<CollectorLiveFriend>,
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CollectorLiveFriend {
    pub user_id: String,
    pub display_name: String,
    pub status: String,
    pub location: String,
    pub platform: String,
    pub last_seen_at_ms: i64,
}

#[derive(Clone, Debug)]
pub struct ShareCollectionRequest {
    pub title: String,
    pub listed: bool,
    pub include_notes: bool,
    pub world_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShareCollectionOutcome {
    pub id: String,
    pub url: String,
    pub world_count: i64,
    /// World id and name of every world left out.
    pub skipped_worlds: Vec<(String, String)>,
}

struct CachedWorld {
    id: String,
    name: String,
    author_name: String,
    image_url: String,
    description: String,
}

fn limited(text: &str, max: usize) -> String {
    text.trim().chars().take(max).collect()
}

/// Turns cached worlds into the public snapshot. Worlds this PC has no
/// complete cached details for are skipped and reported, never guessed.
fn build_share_snapshot(
    request: &ShareCollectionRequest,
    author_name: &str,
    worlds: Vec<CachedWorld>,
    memos: std::collections::HashMap<String, String>,
) -> Result<(
    vrcx_0_remote_sync::CollectionSnapshot,
    Vec<(String, String)>,
)> {
    let title = limited(&request.title, 120);
    if title.is_empty() {
        return Err(Error::Custom("Give the collection a title.".into()));
    }
    let mut by_id = worlds
        .into_iter()
        .map(|world| (world.id.clone(), world))
        .collect::<std::collections::HashMap<_, _>>();
    let mut seen = std::collections::HashSet::new();
    let mut included = Vec::new();
    let mut skipped = Vec::new();
    for world_id in request.world_ids.iter().map(|id| id.trim()) {
        if world_id.is_empty() || !seen.insert(world_id.to_owned()) {
            continue;
        }
        let complete = by_id
            .remove(world_id)
            .filter(|world| !world.name.trim().is_empty() && !world.author_name.trim().is_empty());
        let Some(world) = complete.filter(|_| included.len() < SHARE_MAX_WORLDS) else {
            skipped.push((world_id.to_owned(), String::new()));
            continue;
        };
        let image_url = if SHARE_IMAGE_PREFIXES
            .iter()
            .any(|prefix| world.image_url.starts_with(prefix))
        {
            world.image_url.clone()
        } else {
            String::new()
        };
        included.push(vrcx_0_remote_sync::CollectionWorld {
            world_id: world.id.clone(),
            name: limited(&world.name, 200),
            author_name: limited(&world.author_name, 200),
            image_url,
            description: limited(&world.description, 4000),
            comment: memos
                .get(&world.id)
                .map(|memo| limited(memo, 2000))
                .unwrap_or_default(),
        });
    }
    if included.is_empty() {
        return Err(Error::Custom(
            "None of these worlds have complete cached details to share. Open them once and try again.".into(),
        ));
    }
    Ok((
        vrcx_0_remote_sync::CollectionSnapshot {
            title,
            author_name: limited(author_name, 120),
            listed: request.listed,
            worlds: included,
            ..Default::default()
        },
        skipped,
    ))
}

#[derive(Default)]
pub struct RemoteSyncShared {
    running: tokio::sync::Mutex<()>,
    cancel: AtomicBool,
    exit_flush_started: AtomicBool,
    /// A key transfer this PC started and is waiting to receive.
    transfer: std::sync::Mutex<Option<(engine::TransferReceiver, String)>>,
    /// The open recording period: VRChat user id and coverage row id.
    coverage: std::sync::Mutex<Option<(String, i64)>>,
    realtime_connected: AtomicBool,
}

#[derive(Clone, Debug, Default)]
pub struct RemoteSyncStatus {
    pub enabled: bool,
    pub paired: bool,
    pub has_key: bool,
    pub signed_in_to_vrchat: bool,
    pub vault_id: Option<String>,
    pub last_sync_at_ms: Option<i64>,
    pub log: Vec<SyncLogEntry>,
}

fn reauth_method(method: &str) -> Result<vrcx_0_remote_sync::ReauthMethod> {
    match method {
        "totp" => Ok(vrcx_0_remote_sync::ReauthMethod::Totp),
        "email" => Ok(vrcx_0_remote_sync::ReauthMethod::Email),
        "recovery" => Ok(vrcx_0_remote_sync::ReauthMethod::Recovery),
        _ => Err(Error::Custom("Unknown verification method.".into())),
    }
}

fn sync_error(error: impl std::fmt::Display) -> Error {
    Error::Custom(error.to_string())
}

impl DesktopRuntimeHostState {
    pub fn remote_sync_enabled(&self) -> bool {
        self.config_string(BACKEND_KEY, "off") == BACKEND_REMOTESYNC
    }

    fn remote_sync_secret(&self) -> Result<Option<SyncSecret>> {
        let Some(stored) = self.remote_sync_secret_get(SYNC_SECRET_KEY)? else {
            return Ok(None);
        };
        let stored = Zeroizing::new(stored);
        engine::parse_recovery_string(&stored)
            .map(Some)
            .map_err(sync_error)
    }

    fn remote_sync_store_secret(&self, secret: &SyncSecret) -> Result<String> {
        if self.remote_sync_secret_exists(SYNC_SECRET_KEY)? {
            return Err(Error::Custom(
                "This PC already has a RemoteSync encryption key.".into(),
            ));
        }
        let recovery = engine::recovery_string(secret);
        self.remote_sync_secret_set(SYNC_SECRET_KEY, &recovery)?;
        Ok(recovery.to_string())
    }

    /// Creates the encryption key for a first device, generated or supplied
    /// as exactly 256 bits, and returns its recovery string to show once.
    pub fn remote_sync_key_create(&self, own_key: Option<String>) -> Result<String> {
        let secret = match own_key.map(Zeroizing::new) {
            Some(own_key) => engine::parse_own_key(&own_key),
            None => engine::generate_sync_secret(),
        }
        .map_err(sync_error)?;
        self.remote_sync_store_secret(&secret)
    }

    /// Adds the encryption key of an existing account from its recovery string.
    pub fn remote_sync_key_import(&self, recovery_string: String) -> Result<()> {
        let recovery_string = Zeroizing::new(recovery_string);
        let secret = engine::parse_recovery_string(&recovery_string).map_err(sync_error)?;
        self.remote_sync_store_secret(&secret).map(|_| ())
    }

    pub fn remote_sync_recovery_string(&self) -> Result<String> {
        let secret = self
            .remote_sync_secret()?
            .ok_or_else(|| Error::Custom("This PC has no RemoteSync encryption key yet.".into()))?;
        Ok(engine::recovery_string(&secret).to_string())
    }

    fn remote_sync_device_key(&self) -> Result<SignerKey> {
        if let Some(stored) = self.remote_sync_secret_get(DEVICE_KEY_KEY)? {
            let stored = Zeroizing::new(stored);
            let seed = Zeroizing::new(STANDARD.decode(stored.as_bytes()).map_err(sync_error)?);
            let seed: &[u8; 32] = seed.as_slice().try_into().map_err(|_| {
                Error::Custom("The stored RemoteSync device key is damaged.".into())
            })?;
            return Ok(SignerKey::from_seed(seed));
        }
        let signer = engine::new_device_signer().map_err(sync_error)?;
        let encoded = Zeroizing::new(STANDARD.encode(signer.seed().as_slice()));
        self.remote_sync_secret_set(DEVICE_KEY_KEY, &encoded)?;
        Ok(signer)
    }

    pub fn remote_sync_cancel(&self) {
        self.remote_sync.cancel.store(true, Ordering::Release);
    }

    /// Runs one sync pass for the signed-in VRChat account. Passes never
    /// overlap; a second caller waits for the first.
    pub async fn remote_sync_run(&self) -> Result<SyncReport> {
        let _running = self.remote_sync.running.lock().await;
        self.remote_sync.cancel.store(false, Ordering::Release);
        if !self.remote_sync_enabled() {
            return Err(Error::Custom("History sync is turned off.".into()));
        }
        let token = self
            .remote_sync_secret_get(TOKEN_KEY)?
            .map(Zeroizing::new)
            .ok_or_else(|| Error::Custom("This PC is not paired with RemoteSync.".into()))?;
        let secret = self.remote_sync_secret()?.ok_or_else(|| {
            Error::Custom("Set up the RemoteSync encryption key on this PC first.".into())
        })?;
        let auth = self.runtime.desktop_assembly().auth_scope();
        let scope = auth.snapshot();
        if !scope.active || scope.current_user_id.trim().is_empty() {
            return Err(Error::Custom("Sign in to VRChat before syncing.".into()));
        }
        let api_origin = self.config_string(API_ORIGIN_KEY, OFFICIAL_API);
        let client = RemoteSyncClient::new_with_version(&api_origin, env!("CARGO_PKG_VERSION"))
            .map_err(sync_error)?;
        let account = client.account(&token).await.map_err(sync_error)?;
        if !account.sync_allowed {
            return Err(Error::Custom(
                "RemoteSync was disabled for your account by an administrator. Local history is unchanged.".into(),
            ));
        }
        let identity = SyncIdentity {
            api_origin,
            account_id: account.account_id.to_string(),
            vrchat_user_id: scope.current_user_id.trim().to_owned(),
            display_name: auth.identity().display_name,
            device_label: vrcx_0_remote_sync::device_label(),
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
        };
        let signer = self.remote_sync_device_key()?;
        let db = Arc::clone(self.runtime.desktop_assembly().database());
        let report = sync_account(
            &AuthorizedClient::new(client, token),
            db,
            &secret,
            &signer,
            &identity,
            &self.remote_sync.cancel,
        )
        .await
        .map_err(sync_error)?;
        if report.imported_rows > 0 {
            let owner = OwnerId::new(scope.current_user_id.trim().to_owned());
            vrcx_0_persistence::activity::activity_self_caches_invalidate(
                self.runtime.desktop_assembly().database(),
                &owner,
            )?;
            self.runtime
                .desktop_assembly()
                .event_bus()
                .emit(RemoteSyncImportedPayload {
                    owner_user_id: owner,
                });
        }
        Ok(report)
    }

    pub fn remote_sync_status(&self) -> Result<RemoteSyncStatus> {
        let mut status = RemoteSyncStatus {
            enabled: self.remote_sync_enabled(),
            paired: self.remote_sync_secret_exists(TOKEN_KEY)?,
            has_key: self.remote_sync_secret_exists(SYNC_SECRET_KEY)?,
            ..RemoteSyncStatus::default()
        };
        let scope = self.runtime.desktop_assembly().auth_scope().snapshot();
        status.signed_in_to_vrchat = scope.active && !scope.current_user_id.trim().is_empty();
        let account_id = self.config_string(ACCOUNT_ID_KEY, "");
        if !status.signed_in_to_vrchat || account_id.is_empty() {
            return Ok(status);
        }
        let db = self.runtime.desktop_assembly().database();
        let api_origin = self.config_string(API_ORIGIN_KEY, OFFICIAL_API);
        if let Some(state) =
            store::vault_state_for_user(db, &api_origin, &account_id, scope.current_user_id.trim())?
        {
            status.last_sync_at_ms = store::last_sync_get(db, &state.vault)?;
            status.log = store::sync_log_recent(db, &state.vault, 50)?;
            status.vault_id = Some(state.vault.vault_id);
        }
        Ok(status)
    }

    /// Checks the local upload backlog without contacting the configured
    /// RemoteSync server.
    pub fn remote_sync_pending_rows(&self, limit: usize) -> Result<usize> {
        if !self.remote_sync_enabled() {
            return Ok(0);
        }
        let scope = self.runtime.desktop_assembly().auth_scope().snapshot();
        if !scope.active || scope.current_user_id.trim().is_empty() {
            return Ok(0);
        }
        let account_id = self.config_string(ACCOUNT_ID_KEY, "");
        if account_id.is_empty() {
            return Ok(0);
        }
        let api_origin = self.config_string(API_ORIGIN_KEY, OFFICIAL_API);
        let Some(state) = store::vault_state_for_user(
            self.runtime.desktop_assembly().database(),
            &api_origin,
            &account_id,
            scope.current_user_id.trim(),
        )?
        else {
            return Ok(limit);
        };
        vrcx_0_remote_sync::sync::pending_row_count(
            self.runtime.desktop_assembly().database(),
            &state.vault,
            scope.current_user_id.trim(),
            limit,
        )
        .map_err(sync_error)
    }

    /// Claims a single best-effort exit flush when there is locally queued
    /// history. Returns true for the first exit request that should defer exit.
    pub fn remote_sync_exit_flush_begin(&self) -> bool {
        let ready = self.remote_sync_status().is_ok_and(|status| {
            status.enabled && status.paired && status.has_key && status.signed_in_to_vrchat
        });
        ready
            && self
                .remote_sync_pending_rows(1)
                .is_ok_and(|count| count > 0)
            && !self
                .remote_sync
                .exit_flush_started
                .swap(true, Ordering::AcqRel)
    }

    pub fn remote_sync_exit_flush_in_progress(&self) -> bool {
        self.remote_sync.exit_flush_started.load(Ordering::Acquire)
    }

    /// Runs for the life of the app, keeping the record of when this PC was
    /// actually receiving VRChat events. A period opens when the realtime
    /// connection comes up, is extended every minute, and closes when the
    /// connection ends, so a crash loses at most a minute.
    pub async fn remote_sync_coverage_loop(&self) {
        use vrcx_0_application_realtime::RealtimeTransportLifecycleEvent as Lifecycle;
        let mut events = self
            .runtime
            .realtime_runtime()
            .subscribe_transport_lifecycle();
        let mut listening = true;
        loop {
            let minute = tokio::time::sleep(std::time::Duration::from_secs(60));
            if listening {
                tokio::select! {
                    event = events.recv() => match event {
                        Ok(Lifecycle::Connected(_)) => {
                            self.remote_sync.realtime_connected.store(true, Ordering::Release);
                        }
                        Ok(Lifecycle::Finished { .. }) => {
                            self.remote_sync.realtime_connected.store(false, Ordering::Release);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            self.remote_sync.realtime_connected.store(false, Ordering::Release);
                            listening = false;
                        }
                    },
                    () = minute => {}
                }
            } else {
                minute.await;
            }
            if let Err(error) = self.remote_sync_coverage_tick() {
                tracing::debug!(%error, "recording coverage could not be saved");
            }
        }
    }

    fn remote_sync_coverage_tick(&self) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as i64)
            .unwrap_or(0);
        let scope = self.runtime.desktop_assembly().auth_scope().snapshot();
        let recording = (self.remote_sync_enabled()
            && self.remote_sync.realtime_connected.load(Ordering::Acquire)
            && scope.active
            && !scope.current_user_id.trim().is_empty())
        .then(|| scope.current_user_id.trim().to_owned());
        let db = self.runtime.desktop_assembly().database();
        let mut open = self.remote_sync.coverage.lock().unwrap();
        match (open.as_ref(), recording) {
            (Some((user, id)), Some(current)) if *user == current => {
                store::coverage_extend(db, *id, now)?;
            }
            (previous, current) => {
                if let Some((_, id)) = previous {
                    store::coverage_end(db, *id, now)?;
                }
                *open = match current {
                    Some(user) => {
                        let id = store::coverage_start(db, &user, now)?;
                        Some((user, id))
                    }
                    None => None,
                };
            }
        }
        Ok(())
    }

    fn remote_sync_session(&self) -> Result<(RemoteSyncClient, Zeroizing<String>)> {
        if !self.remote_sync_enabled() {
            return Err(Error::Custom("History sync is turned off.".into()));
        }
        let token = self
            .remote_sync_secret_get(TOKEN_KEY)?
            .map(Zeroizing::new)
            .ok_or_else(|| Error::Custom("This PC is not paired with RemoteSync.".into()))?;
        let api_origin = self.config_string(API_ORIGIN_KEY, OFFICIAL_API);
        let client = RemoteSyncClient::new_with_version(&api_origin, env!("CARGO_PKG_VERSION"))
            .map_err(sync_error)?;
        Ok((client, token))
    }

    /// Deletes the account's synced data on the server and forgets this
    /// PC's sync progress, so a later sync uploads everything again. Local
    /// history is not touched.
    pub async fn remote_sync_delete_data(&self, keep_collections: bool) -> Result<()> {
        self.remote_sync_cancel();
        let _running = self.remote_sync.running.lock().await;
        let (client, token) = self.remote_sync_session()?;
        client
            .delete_data(&token, keep_collections)
            .await
            .map_err(sync_error)?;
        let api_origin = self.config_string(API_ORIGIN_KEY, OFFICIAL_API);
        let account_id = self.config_string(ACCOUNT_ID_KEY, "");
        store::clear_account_state(
            self.runtime.desktop_assembly().database(),
            &api_origin,
            &account_id,
        )?;
        Ok(())
    }

    pub async fn remote_sync_clients(&self) -> Result<Vec<vrcx_0_remote_sync::ClientInfo>> {
        let (client, token) = self.remote_sync_session()?;
        client.clients(&token).await.map_err(sync_error)
    }

    /// Signs other clients out. The server only allows this right after a
    /// second-factor code, so a stolen token alone cannot lock the owner out.
    pub async fn remote_sync_revoke(
        &self,
        method: &str,
        code: String,
        client_id: Option<String>,
    ) -> Result<()> {
        let (client, token) = self.remote_sync_session()?;
        client
            .reauth(&token, reauth_method(method)?, Some(&code))
            .await
            .map_err(sync_error)?;
        match client_id {
            Some(client_id) => client.revoke_client(&token, &client_id).await,
            None => client.revoke_other_clients(&token).await,
        }
        .map_err(sync_error)
    }

    /// Revokes other clients, removes the old server-side vaults and key
    /// envelopes, then replaces this PC's root sync secret. Local history is
    /// retained and will upload under the new key on the next sync.
    pub async fn remote_sync_key_rotate(&self, method: &str, code: String) -> Result<String> {
        let next = engine::generate_sync_secret().map_err(sync_error)?;
        let recovery = engine::recovery_string(&next);
        self.remote_sync_revoke(method, code, None).await?;
        self.remote_sync_delete_data(false).await?;
        self.remote_sync_secret_set(SYNC_SECRET_KEY, &recovery)?;
        Ok(recovery.to_string())
    }

    fn remote_sync_current_vault(&self) -> Result<(protocol::ids::VaultId, store::VaultState)> {
        let scope = self.runtime.desktop_assembly().auth_scope().snapshot();
        let account_id = self.config_string(ACCOUNT_ID_KEY, "");
        let api_origin = self.config_string(API_ORIGIN_KEY, OFFICIAL_API);
        if !scope.active || scope.current_user_id.trim().is_empty() || account_id.is_empty() {
            return Err(Error::Custom(
                "Sign in to VRChat and pair this PC first.".into(),
            ));
        }
        let state = store::vault_state_for_user(
            self.runtime.desktop_assembly().database(),
            &api_origin,
            &account_id,
            scope.current_user_id.trim(),
        )?
        .ok_or_else(|| {
            Error::Custom("Run History Sync once before using collector controls.".into())
        })?;
        let vault_id = state
            .vault
            .vault_id
            .parse()
            .map_err(|_| Error::Custom("The saved RemoteSync vault id is invalid.".into()))?;
        Ok((vault_id, state))
    }

    async fn remote_sync_manifest(
        &self,
        client: &RemoteSyncClient,
        token: &str,
        vault_id: protocol::ids::VaultId,
        state: &store::VaultState,
    ) -> Result<protocol::manifest::Manifest> {
        let secret = self
            .remote_sync_secret_get(SYNC_SECRET_KEY)?
            .ok_or_else(|| Error::Custom("The RemoteSync encryption key is missing.".into()))?;
        let secret = engine::parse_recovery_string(&secret).map_err(sync_error)?;
        let keys = protocol::keys::VaultKeys::derive(&secret, vault_id);
        let (seq, blob) = client
            .get_manifest(token, vault_id)
            .await
            .map_err(sync_error)?;
        let manifest = engine::open_manifest(&blob, seq, &keys, Some(state.highest_manifest_seq))
            .map_err(sync_error)?;
        store::manifest_seq_advance(
            self.runtime.desktop_assembly().database(),
            &state.vault,
            seq,
        )?;
        Ok(manifest)
    }

    /// Starts or extends the read-only server collector after explicitly
    /// confirming the user wants their VRChat session cookie sent sealed to it.
    pub async fn remote_sync_collector_unlock(
        &self,
        days: u32,
        interval_seconds: u32,
    ) -> Result<()> {
        if !(1..=30).contains(&days) || !(60..=900).contains(&interval_seconds) {
            return Err(Error::Custom(
                "Collector duration must be 1 to 30 days and interval 60 to 900 seconds.".into(),
            ));
        }
        let (client, token) = self.remote_sync_session()?;
        let account = client.account(&token).await.map_err(sync_error)?;
        if !account.collector_allowed {
            return Err(Error::Custom(
                "This RemoteSync account is not allowed to use the collector.".into(),
            ));
        }
        let capabilities = client.capabilities().await.map_err(sync_error)?;
        let collector = capabilities
            .collector
            .filter(|value| value.available)
            .ok_or_else(|| Error::Custom("The RemoteSync collector is unavailable.".into()))?;
        let (vault_id, state) = self.remote_sync_current_vault()?;
        let secret_text = self
            .remote_sync_secret_get(SYNC_SECRET_KEY)?
            .ok_or_else(|| Error::Custom("The RemoteSync encryption key is missing.".into()))?;
        let secret = engine::parse_recovery_string(&secret_text).map_err(sync_error)?;
        let keys = protocol::keys::VaultKeys::derive(&secret, vault_id);
        let db = self.runtime.desktop_assembly().database();
        let cookies = vrcx_0_persistence::cookies::get_default_cookies(db)?
            .ok_or_else(|| Error::Custom("No saved VRChat session is available.".into()))?;
        let raw = base64::engine::general_purpose::STANDARD
            .decode(cookies)
            .map_err(|_| Error::Custom("The saved VRChat session could not be read.".into()))?;
        let entries: Vec<serde_json::Value> = serde_json::from_slice(&raw)
            .map_err(|_| Error::Custom("The saved VRChat session could not be read.".into()))?;
        let cookie = |name: &str| {
            entries
                .iter()
                .find(|entry| entry.get("Name").and_then(serde_json::Value::as_str) == Some(name))
                .and_then(|entry| entry.get("Value"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        };
        let auth = cookie("auth")
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                Error::Custom(
                    "The saved VRChat session has no auth cookie. Sign in again first.".into(),
                )
            })?;
        let two_factor_auth = cookie(" twoFactorAuth").or_else(|| cookie("twoFactorAuth"));
        let now = chrono::Utc::now().timestamp_millis();
        let expires_at = now.saturating_add(i64::from(days) * 24 * 60 * 60 * 1000);
        let payload = serde_json::json!({
            "version": 1,
            "vaultPk": protocol::b64::encode(keys.public().vault_pk.as_bytes()),
            "vrchatUserId": state.vrchat_user_id,
            "cookies": { "auth": auth, "twoFactorAuth": two_factor_auth },
            "expiresAt": expires_at,
            "intervalSeconds": interval_seconds
        });
        let unlock_key = protocol::seal::SealPublicKey::from_bytes(
            &protocol::b64::decode(&collector.unlock_key).map_err(sync_error)?,
        )
        .map_err(sync_error)?;
        let aad = [
            self.config_string(ACCOUNT_ID_KEY, "").as_bytes(),
            vault_id.as_bytes(),
        ]
        .concat();
        let sealed = protocol::seal::seal(
            &unlock_key,
            b"remotesync/v1/unlock",
            &aad,
            &serde_json::to_vec(&payload).map_err(|e| Error::Custom(e.to_string()))?,
        )
        .map_err(sync_error)?;

        let mut manifest = self
            .remote_sync_manifest(&client, &token, vault_id, &state)
            .await?;
        let signing_key = protocol::keys::verifying_key(
            &protocol::b64::decode(&collector.signing_key).map_err(sync_error)?,
        )
        .map_err(sync_error)?;
        let mut signer = protocol::manifest::SignerEntry::new(
            &signing_key,
            protocol::manifest::SignerKind::Collector,
            "RemoteSync collector",
            now.max(collector.keys_valid_since_ms),
        );
        signer.expires_at_ms = Some(expires_at);
        manifest.add_signer(signer);
        let next = manifest.next();
        let sealed_manifest = engine::seal_manifest(&next, &keys).map_err(sync_error)?;
        client
            .put_manifest(
                &token,
                vault_id,
                next.manifest_seq,
                manifest.manifest_seq,
                sealed_manifest,
            )
            .await
            .map_err(sync_error)?;
        store::manifest_seq_advance(db, &state.vault, next.manifest_seq)?;
        client
            .collector_unlock(&token, vault_id, sealed)
            .await
            .map_err(sync_error)
    }

    pub async fn remote_sync_collector_lock(&self) -> Result<()> {
        let (client, token) = self.remote_sync_session()?;
        let (vault_id, state) = self.remote_sync_current_vault()?;
        client
            .collector_lock(&token, vault_id)
            .await
            .map_err(sync_error)?;
        let mut manifest = self
            .remote_sync_manifest(&client, &token, vault_id, &state)
            .await?;
        let capabilities = client.capabilities().await.map_err(sync_error)?;
        if let Some(collector) = capabilities.collector {
            if let Ok(bytes) = protocol::b64::decode(&collector.signing_key) {
                if let Ok(key) = protocol::keys::verifying_key(&bytes) {
                    manifest.remove_signer(&protocol::keys::key_id(&key));
                    let next = manifest.next();
                    let sealed = engine::seal_manifest(
                        &next,
                        &protocol::keys::VaultKeys::derive(
                            &engine::parse_recovery_string(
                                &self
                                    .remote_sync_secret_get(SYNC_SECRET_KEY)?
                                    .unwrap_or_default(),
                            )
                            .map_err(sync_error)?,
                            vault_id,
                        ),
                    )
                    .map_err(sync_error)?;
                    client
                        .put_manifest(
                            &token,
                            vault_id,
                            next.manifest_seq,
                            manifest.manifest_seq,
                            sealed,
                        )
                        .await
                        .map_err(sync_error)?;
                    store::manifest_seq_advance(
                        self.runtime.desktop_assembly().database(),
                        &state.vault,
                        next.manifest_seq,
                    )?;
                }
            }
        }
        Ok(())
    }

    pub async fn remote_sync_collector_snapshot(&self) -> Result<CollectorSnapshot> {
        let (client, token) = self.remote_sync_session()?;
        let (vault_id, state) = self.remote_sync_current_vault()?;
        let status = client
            .collector_status(&token, vault_id)
            .await
            .map_err(sync_error)?;
        let (live_age_ms, live) = if status.state == protocol::api::CollectorState::Running {
            let secret = self
                .remote_sync_secret_get(SYNC_SECRET_KEY)?
                .ok_or_else(|| Error::Custom("The RemoteSync encryption key is missing.".into()))?;
            let secret = engine::parse_recovery_string(&secret).map_err(sync_error)?;
            let keys = protocol::keys::VaultKeys::derive(&secret, vault_id);
            let manifest = self
                .remote_sync_manifest(&client, &token, vault_id, &state)
                .await?;
            match client.live_snapshot(&token, vault_id).await {
                Ok((seq, age, blob)) => {
                    let snapshot = protocol::live::open_live(&blob, seq, &keys, &manifest)
                        .map_err(sync_error)?;
                    (
                        Some(age),
                        Some(CollectorLiveSnapshot {
                            created_at_ms: snapshot.created_at_ms,
                            own_status: snapshot.own.status,
                            own_status_description: snapshot.own.status_description,
                            own_location: snapshot.own.location,
                            friends: snapshot
                                .friends
                                .into_iter()
                                .map(|friend| CollectorLiveFriend {
                                    user_id: friend.user_id,
                                    display_name: friend.display_name,
                                    status: friend.status,
                                    location: friend.location,
                                    platform: friend.platform,
                                    last_seen_at_ms: friend.last_seen_at_ms,
                                })
                                .collect(),
                        }),
                    )
                }
                Err(_) => (None, None),
            }
        } else {
            (None, None)
        };
        Ok(CollectorSnapshot {
            state: format!("{:?}", status.state).to_ascii_lowercase(),
            since_ms: status.since_ms,
            last_chunk_at_ms: status.last_chunk_at_ms,
            last_error: status.last_error,
            live_age_ms,
            live,
        })
    }

    /// Asks the server to email a verification code to the account owner.
    pub async fn remote_sync_send_email_code(&self) -> Result<()> {
        let (client, token) = self.remote_sync_session()?;
        client
            .reauth(&token, vrcx_0_remote_sync::ReauthMethod::Email, None)
            .await
            .map_err(sync_error)
    }

    /// Starts receiving the encryption key from another device and returns
    /// the code to type there.
    pub async fn remote_sync_transfer_begin(&self) -> Result<String> {
        if self.remote_sync_secret_exists(SYNC_SECRET_KEY)? {
            return Err(Error::Custom(
                "This PC already has a RemoteSync encryption key.".into(),
            ));
        }
        let (client, token) = self.remote_sync_session()?;
        let receiver = engine::TransferReceiver::new();
        let created = client
            .transfer_create(&token, receiver.public_key())
            .await
            .map_err(sync_error)?;
        let code = receiver
            .display_code(&created.transfer_id)
            .map_err(sync_error)?;
        *self.remote_sync.transfer.lock().unwrap() = Some((receiver, created.transfer_id));
        Ok(code)
    }

    /// Returns true once the other device sent the key and it was stored.
    pub async fn remote_sync_transfer_poll(&self) -> Result<bool> {
        let (client, token) = self.remote_sync_session()?;
        let Some(transfer_id) = self
            .remote_sync
            .transfer
            .lock()
            .unwrap()
            .as_ref()
            .map(|(_, transfer_id)| transfer_id.clone())
        else {
            return Err(Error::Custom("No key transfer is in progress.".into()));
        };
        let Some(sealed) = client
            .transfer_result(&token, &transfer_id)
            .await
            .map_err(sync_error)?
        else {
            return Ok(false);
        };
        let account_id = self.config_string(ACCOUNT_ID_KEY, "");
        let Some((receiver, _)) = self.remote_sync.transfer.lock().unwrap().take() else {
            return Err(Error::Custom("No key transfer is in progress.".into()));
        };
        let secret = receiver
            .open(&account_id, &transfer_id, &sealed)
            .map_err(sync_error)?;
        self.remote_sync_store_secret(&secret)?;
        Ok(true)
    }

    /// Sends this PC's encryption key to the device showing `code`.
    pub async fn remote_sync_transfer_send(&self, code: String) -> Result<()> {
        let secret = self.remote_sync_secret()?.ok_or_else(|| {
            Error::Custom("This PC has no RemoteSync encryption key to send.".into())
        })?;
        let (client, token) = self.remote_sync_session()?;
        let transfer_id = engine::transfer_id_from_code(&code).map_err(sync_error)?;
        let key = client
            .transfer_key(&token, &transfer_id)
            .await
            .map_err(sync_error)?;
        let account_id = self.config_string(ACCOUNT_ID_KEY, "");
        let (transfer_id, sealed) =
            engine::seal_transfer(&code, &key.epk, &account_id, &secret).map_err(sync_error)?;
        client
            .transfer_complete(&token, &transfer_id, sealed)
            .await
            .map_err(sync_error)
    }

    /// Publishes a world favorite group as a public collection on the
    /// configured RemoteSync server. Sharing a title again replaces the
    /// collection shared under it before instead of creating a second one.
    pub async fn remote_sync_share_collection(
        &self,
        request: ShareCollectionRequest,
    ) -> Result<ShareCollectionOutcome> {
        if !self.remote_sync_enabled() {
            return Err(Error::Custom(
                "Turn on RemoteSync under Settings > History Sync to share collections.".into(),
            ));
        }
        let token = self
            .remote_sync_secret_get(TOKEN_KEY)?
            .map(Zeroizing::new)
            .ok_or_else(|| {
                Error::Custom(
                    "Pair this PC under Settings > History Sync to share collections.".into(),
                )
            })?;
        let db = self.runtime.desktop_assembly().database();
        let worlds = vrcx_0_persistence::worlds::world_cache_get_many(db, &request.world_ids)?
            .into_iter()
            .map(|world| CachedWorld {
                id: world.id,
                name: world.name,
                author_name: world.author_name,
                image_url: world.image_url,
                description: world.description,
            })
            .collect();
        let memos = if request.include_notes {
            vrcx_0_persistence::memos::memo_get_worlds_many(db, &request.world_ids)?
                .into_iter()
                .map(|memo| (memo.world_id, memo.memo))
                .collect()
        } else {
            Default::default()
        };
        let author_name = self
            .runtime
            .desktop_assembly()
            .auth_scope()
            .identity()
            .display_name;
        let (snapshot, skipped_worlds) =
            build_share_snapshot(&request, &author_name, worlds, memos)?;

        let api_origin = self.config_string(API_ORIGIN_KEY, OFFICIAL_API);
        let account_id = self.config_string(ACCOUNT_ID_KEY, "");
        let share_key = format!("{api_origin}|{account_id}|{}", snapshot.title);
        let mut shared: std::collections::BTreeMap<String, String> =
            serde_json::from_str(&self.config_string(SHARED_COLLECTIONS_KEY, "{}"))
                .unwrap_or_default();
        let client = RemoteSyncClient::new_with_version(&api_origin, env!("CARGO_PKG_VERSION"))
            .map_err(sync_error)?;
        let existing = shared.get(&share_key).cloned();
        let id = match client.save_collection(&token, existing.as_deref(), &snapshot).await {
            Err(vrcx_0_remote_sync::Error::Api { status: 404, .. }) if existing.is_some() => {
                client.save_collection(&token, None, &snapshot).await
            }
            other => other,
        }
        .map_err(|error| match error {
            vrcx_0_remote_sync::Error::Api { code, .. } if code == "forbidden_scope" => Error::Custom(
                "This PC was paired without permission to share collections. Sign out and pair it again under Settings > History Sync.".into(),
            ),
            error => sync_error(error),
        })?;
        shared.insert(share_key, id.clone());
        self.config_set_values(vec![crate::local_data::ConfigWriteEntry {
            key: SHARED_COLLECTIONS_KEY.into(),
            value: serde_json::to_string(&shared)?,
        }])?;
        let website = self.config_string(WEBSITE_ORIGIN_KEY, vrcx_0_remote_sync::OFFICIAL_WEBSITE);
        Ok(ShareCollectionOutcome {
            url: format!("{}/c/{id}", website.trim_end_matches('/')),
            id,
            world_count: snapshot.worlds.len() as i64,
            skipped_worlds,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world(id: &str, name: &str, image_url: &str) -> CachedWorld {
        CachedWorld {
            id: id.into(),
            name: name.into(),
            author_name: "Author".into(),
            image_url: image_url.into(),
            description: "About".into(),
        }
    }

    fn request(world_ids: &[&str]) -> ShareCollectionRequest {
        ShareCollectionRequest {
            title: "  My worlds  ".into(),
            listed: true,
            include_notes: true,
            world_ids: world_ids.iter().map(|id| (*id).to_owned()).collect(),
        }
    }

    #[test]
    fn share_snapshot_keeps_order_and_reports_what_it_left_out() {
        let worlds = vec![
            world("wrld_b", "B", "https://example.com/b.png"),
            world("wrld_a", "A", "https://api.vrchat.cloud/a.png"),
            world("wrld_c", "", "https://api.vrchat.cloud/c.png"),
        ];
        let memos = [("wrld_a".to_owned(), "nice".to_owned())]
            .into_iter()
            .collect();
        let (snapshot, skipped) = build_share_snapshot(
            &request(&["wrld_a", "wrld_b", "wrld_a", "wrld_c", "wrld_missing"]),
            "Tester",
            worlds,
            memos,
        )
        .unwrap();

        assert_eq!(snapshot.title, "My worlds");
        assert_eq!(snapshot.author_name, "Tester");
        let ids = snapshot
            .worlds
            .iter()
            .map(|world| world.world_id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, ["wrld_a", "wrld_b"]);
        assert_eq!(snapshot.worlds[0].comment, "nice");
        assert_eq!(
            snapshot.worlds[0].image_url,
            "https://api.vrchat.cloud/a.png"
        );
        // Images from other hosts are dropped rather than sent to the server.
        assert_eq!(snapshot.worlds[1].image_url, "");
        let skipped_ids = skipped
            .iter()
            .map(|(id, _)| id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(skipped_ids, ["wrld_c", "wrld_missing"]);
    }

    #[test]
    fn share_snapshot_needs_a_title_and_at_least_one_usable_world() {
        let mut untitled = request(&["wrld_a"]);
        untitled.title = "   ".into();
        assert!(build_share_snapshot(
            &untitled,
            "Tester",
            vec![world("wrld_a", "A", "")],
            Default::default()
        )
        .is_err());
        assert!(build_share_snapshot(
            &request(&["wrld_x"]),
            "Tester",
            Vec::new(),
            Default::default()
        )
        .is_err());
    }
}
