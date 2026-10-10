#![allow(non_snake_case)]

use serde::{Deserialize, Serialize};
use tauri::State;
use zeroize::Zeroizing;

use crate::error::AppError;
use crate::state::AppState;
use vrcx_0_remote_sync::{
    Error as RemoteSyncError, PairPoll, ProtocolCapabilities, RemoteSyncClient,
    WebsiteVerification, OFFICIAL_API, OFFICIAL_WEBSITE,
};

use vrcx_0_runtime_host_desktop::remote_sync::{
    ACCOUNT_ID_KEY, API_ORIGIN_KEY, BACKEND_KEY, TOKEN_KEY, WEBSITE_ORIGIN_KEY,
};

const TRUST_HISTORY_KEY: &str = "remoteSyncTrustHistory";
const TRUST_RECHECK_MS: i64 = 24 * 60 * 60 * 1000;
const BACKGROUND_SYNC_INTERVAL: std::time::Duration = std::time::Duration::from_secs(600);
const BACKGROUND_SYNC_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);
const BACKGROUND_SYNC_ROW_THRESHOLD: usize = 500;

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncCapabilitiesSnapshot {
    pub server: String,
    pub version: String,
    pub commit: String,
    pub protocol: Vec<u32>,
    pub registration: String,
    pub website_origins: Vec<String>,
    pub collector_available: bool,
    pub policy_url: Option<String>,
}

impl From<ProtocolCapabilities> for RemoteSyncCapabilitiesSnapshot {
    fn from(value: ProtocolCapabilities) -> Self {
        Self {
            server: value.server,
            version: value.version,
            commit: value.commit,
            protocol: value.protocol,
            registration: format!("{:?}", value.registration).to_ascii_lowercase(),
            website_origins: value.website_origins,
            collector_available: value.collector.is_some_and(|collector| collector.available),
            policy_url: value.policy_url,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncPairingStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u32,
    pub interval: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncSettingsSnapshot {
    pub backend: String,
    pub api_origin: String,
    pub website_origin: String,
    pub paired: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "status", content = "value")]
pub enum RemoteSyncPairingPoll {
    Pending { interval_seconds: u32 },
    Approved { account_id: String },
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncAccountSnapshot {
    pub account_id: String,
    pub usage_bytes: u64,
    pub quota_bytes: Option<u64>,
    pub collector_allowed: bool,
    pub sync_allowed: bool,
    pub scopes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncWebsiteVerification {
    pub verified: bool,
    pub version: Option<String>,
    pub source_commit: Option<String>,
    pub files_checked: u64,
    pub detail: String,
}

impl From<WebsiteVerification> for RemoteSyncWebsiteVerification {
    fn from(value: WebsiteVerification) -> Self {
        Self {
            verified: value.verified,
            version: value.version,
            source_commit: value.source_commit,
            files_checked: value.files_checked as u64,
            detail: value.detail,
        }
    }
}

fn client(state: &AppState) -> Result<RemoteSyncClient, AppError> {
    let origin = state
        .runtime_host()
        .config_string(API_ORIGIN_KEY, OFFICIAL_API);
    RemoteSyncClient::new_with_version(&origin, env!("CARGO_PKG_VERSION"))
        .map_err(|error| AppError::WebClient(error.to_string()))
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_settings_get(
    state: State<'_, AppState>,
) -> Result<RemoteSyncSettingsSnapshot, AppError> {
    Ok(RemoteSyncSettingsSnapshot {
        backend: state.runtime_host().config_string(BACKEND_KEY, "off"),
        api_origin: state
            .runtime_host()
            .config_string(API_ORIGIN_KEY, OFFICIAL_API),
        website_origin: state
            .runtime_host()
            .config_string(WEBSITE_ORIGIN_KEY, OFFICIAL_WEBSITE),
        paired: state
            .runtime_host()
            .remote_sync_secret_get(TOKEN_KEY)
            .map_err(|error| AppError::WebClient(error.to_string()))?
            .is_some(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_capabilities_get(
    state: State<'_, AppState>,
) -> Result<RemoteSyncCapabilitiesSnapshot, AppError> {
    Ok(client(&state)
        .map_err(|error| AppError::WebClient(error.to_string()))?
        .capabilities()
        .await
        .map_err(|error| AppError::WebClient(error.to_string()))?
        .into())
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_server_validate(
    api_origin: String,
) -> Result<RemoteSyncCapabilitiesSnapshot, AppError> {
    let remote = RemoteSyncClient::new_with_version(&api_origin, env!("CARGO_PKG_VERSION"))
        .map_err(|error| AppError::WebClient(error.to_string()))?;
    Ok(remote
        .capabilities()
        .await
        .map_err(|error| AppError::WebClient(error.to_string()))?
        .into())
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__remote_sync_settings_set(
    state: State<'_, AppState>,
    backend: String,
    api_origin: String,
    website_origin: String,
) -> Result<(), AppError> {
    if !matches!(backend.as_str(), "off" | "remotesync") {
        return Err(AppError::WebClient(
            "The selected history sync backend is not available in this app version.".into(),
        ));
    }
    let api = RemoteSyncClient::new(&api_origin)
        .map_err(|error| AppError::WebClient(error.to_string()))?;
    let website = RemoteSyncClient::new(&website_origin)
        .map_err(|error| AppError::WebClient(error.to_string()))?;
    let _ = (api, website);
    let current_api_origin = state
        .runtime_host()
        .config_string(API_ORIGIN_KEY, OFFICIAL_API);
    if current_api_origin != api_origin
        && state
            .runtime_host()
            .remote_sync_secret_exists(TOKEN_KEY)
            .map_err(|error| AppError::WebClient(error.to_string()))?
    {
        return Err(AppError::WebClient(
            "Sign out from this PC before changing the RemoteSync server.".into(),
        ));
    }
    if backend == "off" {
        state.runtime_host().remote_sync_cancel();
    }
    state.runtime_host().config_set_values(vec![
        vrcx_0_runtime_host_desktop::local_data::ConfigWriteEntry {
            key: BACKEND_KEY.into(),
            value: backend,
        },
        vrcx_0_runtime_host_desktop::local_data::ConfigWriteEntry {
            key: API_ORIGIN_KEY.into(),
            value: api_origin,
        },
        vrcx_0_runtime_host_desktop::local_data::ConfigWriteEntry {
            key: WEBSITE_ORIGIN_KEY.into(),
            value: website_origin,
        },
    ])?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_pair_start(
    state: State<'_, AppState>,
    device_label: String,
) -> Result<RemoteSyncPairingStart, AppError> {
    let response = client(&state)
        .map_err(|error| AppError::WebClient(error.to_string()))?
        .authorize_device(device_label)
        .await
        .map_err(|error| AppError::WebClient(error.to_string()))?;
    let verification_url = url::Url::parse(&response.verification_uri)
        .map_err(|_| AppError::WebClient("Server returned an invalid verification URL.".into()))?;
    if verification_url.scheme() != "https" {
        return Err(AppError::WebClient(
            "Server returned a non-HTTPS verification URL.".into(),
        ));
    }
    Ok(RemoteSyncPairingStart {
        device_code: response.device_code,
        user_code: response.user_code,
        verification_uri: verification_url.to_string(),
        expires_in: response.expires_in,
        interval: response.interval,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_pair_poll(
    state: State<'_, AppState>,
    device_code: String,
    interval_seconds: u32,
) -> Result<RemoteSyncPairingPoll, AppError> {
    let poll = client(&state)
        .map_err(|error| AppError::WebClient(error.to_string()))?
        .poll_device(&device_code, interval_seconds)
        .await
        .map_err(|error| AppError::WebClient(error.to_string()))?;
    match poll {
        PairPoll::Pending { interval_seconds } => {
            Ok(RemoteSyncPairingPoll::Pending { interval_seconds })
        }
        PairPoll::Approved { account_id, token } => {
            let token = Zeroizing::new(token);
            state
                .runtime_host()
                .remote_sync_secret_set(TOKEN_KEY, token.as_str())
                .map_err(|error| AppError::WebClient(error.to_string()))?;
            state.runtime_host().config_set_values(vec![
                vrcx_0_runtime_host_desktop::local_data::ConfigWriteEntry {
                    key: ACCOUNT_ID_KEY.into(),
                    value: account_id.clone(),
                },
            ])?;
            Ok(RemoteSyncPairingPoll::Approved { account_id })
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_account_get(
    state: State<'_, AppState>,
) -> Result<RemoteSyncAccountSnapshot, AppError> {
    let token = Zeroizing::new(
        state
            .runtime_host()
            .remote_sync_secret_get(TOKEN_KEY)
            .map_err(|error| AppError::WebClient(error.to_string()))?
            .ok_or_else(|| AppError::WebClient("This PC is not paired with RemoteSync.".into()))?,
    );
    let account = client(&state)
        .map_err(|error| AppError::WebClient(error.to_string()))?
        .account(token.as_str())
        .await
        .map_err(|error| match error {
            RemoteSyncError::Api { code, .. } if code == "token_revoked" => {
                let _ = state.runtime_host().remote_sync_secret_remove(TOKEN_KEY);
                AppError::WebClient(
                    "This PC's RemoteSync token was revoked. Pair this PC again to reconnect."
                        .into(),
                )
            }
            error => AppError::WebClient(error.to_string()),
        })?;
    Ok(RemoteSyncAccountSnapshot {
        account_id: account.account_id.to_string(),
        usage_bytes: account.usage_bytes,
        quota_bytes: account.quota_bytes,
        collector_allowed: account.collector_allowed,
        sync_allowed: account.sync_allowed,
        scopes: account
            .scopes
            .iter()
            .map(|scope| format!("{scope:?}").to_ascii_lowercase())
            .collect(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_website_verify(
    state: State<'_, AppState>,
) -> Result<RemoteSyncWebsiteVerification, AppError> {
    let website_origin = state
        .runtime_host()
        .config_string(WEBSITE_ORIGIN_KEY, OFFICIAL_WEBSITE);
    let verification = client(&state)
        .map_err(|error| AppError::WebClient(error.to_string()))?
        .verify_website(&website_origin, None)
        .await
        .map_err(|error| AppError::WebClient(error.to_string()))?;
    Ok(verification.into())
}

/// Signs this PC out: the server forgets its token (best effort, so signing
/// out works offline too) and the token is removed here. The encryption key
/// stays on this PC, because it may be the only copy.
#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_sign_out(state: State<'_, AppState>) -> Result<(), AppError> {
    state.runtime_host().remote_sync_cancel();
    if let Ok(Some(token)) = state.runtime_host().remote_sync_secret_get(TOKEN_KEY) {
        let token = Zeroizing::new(token);
        if let Ok(remote) = client(&state) {
            let _ = remote.revoke_current_token(token.as_str()).await;
        }
    }
    state.runtime_host().remote_sync_secret_remove(TOKEN_KEY)?;
    Ok(())
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncLogSnapshot {
    pub kind: String,
    pub message: String,
    pub created_at_ms: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncStatusSnapshot {
    pub enabled: bool,
    pub paired: bool,
    pub has_key: bool,
    pub signed_in_to_vrchat: bool,
    pub vault_id: Option<String>,
    pub last_sync_at_ms: Option<f64>,
    pub log: Vec<RemoteSyncLogSnapshot>,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncRunSnapshot {
    pub created_vault: bool,
    pub pushed_rows: u32,
    pub imported_rows: u32,
    pub matched_rows: u32,
    pub gaps: u32,
    pub unknown_streams: Vec<String>,
    pub cancelled: bool,
}

fn count(value: u64) -> u32 {
    value.min(u64::from(u32::MAX)) as u32
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RemoteSyncCodeTrust {
    /// Signed by the fork maintainer's key and every listed file matches.
    Official,
    /// The website publishes no signed manifest, so it is not the published build.
    Unsigned,
    /// The signature or a file does not match the published build.
    Modified,
    /// The website could not be reached, so nothing is known.
    Unreachable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum RemoteSyncInstanceTrust {
    /// The server presented the maintainer's signed statement for itself.
    Official,
    /// No statement: an instance run by someone else.
    Unattested,
    /// A statement that is forged, altered, or copied from another server.
    Invalid,
    Unreachable,
}

#[derive(Clone, Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncTrustSnapshot {
    pub instance: RemoteSyncInstanceTrust,
    pub instance_detail: String,
    pub api_origin: String,
    pub website_origin: String,
    pub code: RemoteSyncCodeTrust,
    pub code_detail: String,
    pub version: Option<String>,
    pub source_commit: Option<String>,
    /// When this server last passed each test, so a server that used to be
    /// official and no longer is stands out from one that never was.
    pub code_official_at_ms: Option<f64>,
    pub instance_official_at_ms: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustMemory {
    #[serde(default)]
    code_official_at_ms: Option<i64>,
    #[serde(default)]
    instance_official_at_ms: Option<i64>,
    #[serde(default)]
    checked_at_ms: i64,
}

fn unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn trust_history(state: &AppState) -> std::collections::BTreeMap<String, TrustMemory> {
    serde_json::from_str(&state.runtime_host().config_string(TRUST_HISTORY_KEY, "{}"))
        .unwrap_or_default()
}

/// Checks two separate things about the configured server: whether it is the
/// maintainer's own instance, and whether its website serves the maintainer's
/// signed, unmodified code. Neither result blocks anything; the UI explains
/// what each failure means.
#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_trust_check(
    state: State<'_, AppState>,
) -> Result<RemoteSyncTrustSnapshot, AppError> {
    trust_check(&state).await
}

async fn trust_check(state: &AppState) -> Result<RemoteSyncTrustSnapshot, AppError> {
    let api_origin = state
        .runtime_host()
        .config_string(API_ORIGIN_KEY, OFFICIAL_API);
    let website_origin = state
        .runtime_host()
        .config_string(WEBSITE_ORIGIN_KEY, OFFICIAL_WEBSITE);
    let remote = client(state)?;
    let official = remote.verify_website(&website_origin, None).await;
    let (code, code_detail, version, source_commit) = match official {
        Ok(result) if result.verified => (
            RemoteSyncCodeTrust::Official,
            result.detail,
            result.version,
            result.source_commit,
        ),
        Ok(result) => (RemoteSyncCodeTrust::Unsigned, result.detail, None, None),
        Err(RemoteSyncError::Transport(detail)) => {
            (RemoteSyncCodeTrust::Unreachable, detail, None, None)
        }
        Err(error) => (RemoteSyncCodeTrust::Modified, error.to_string(), None, None),
    };
    let (instance, instance_detail) = match remote.verify_instance(&website_origin).await {
        Ok(vrcx_0_remote_sync::InstanceTrust::Official) => {
            (RemoteSyncInstanceTrust::Official, String::new())
        }
        Ok(vrcx_0_remote_sync::InstanceTrust::Unattested) => {
            (RemoteSyncInstanceTrust::Unattested, String::new())
        }
        Ok(vrcx_0_remote_sync::InstanceTrust::Invalid(detail)) => {
            (RemoteSyncInstanceTrust::Invalid, detail)
        }
        Err(error) => (RemoteSyncInstanceTrust::Unreachable, error.to_string()),
    };
    let server = format!("{api_origin}|{website_origin}");
    let mut history = trust_history(state);
    let mut memory = history.get(&server).copied().unwrap_or_default();
    memory.checked_at_ms = unix_ms();
    if code == RemoteSyncCodeTrust::Official {
        memory.code_official_at_ms = Some(memory.checked_at_ms);
    }
    if instance == RemoteSyncInstanceTrust::Official {
        memory.instance_official_at_ms = Some(memory.checked_at_ms);
    }
    history.insert(server, memory);
    if let Ok(value) = serde_json::to_string(&history) {
        let _ = state.runtime_host().config_set_values(vec![
            vrcx_0_runtime_host_desktop::local_data::ConfigWriteEntry {
                key: TRUST_HISTORY_KEY.into(),
                value,
            },
        ]);
    }
    Ok(RemoteSyncTrustSnapshot {
        code_official_at_ms: memory.code_official_at_ms.map(|at| at as f64),
        instance_official_at_ms: memory.instance_official_at_ms.map(|at| at as f64),
        instance,
        instance_detail,
        api_origin,
        website_origin,
        code,
        code_detail,
        version,
        source_commit,
    })
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__remote_sync_status_get(
    state: State<'_, AppState>,
) -> Result<RemoteSyncStatusSnapshot, AppError> {
    let status = state.runtime_host().remote_sync_status()?;
    Ok(RemoteSyncStatusSnapshot {
        enabled: status.enabled,
        paired: status.paired,
        has_key: status.has_key,
        signed_in_to_vrchat: status.signed_in_to_vrchat,
        vault_id: status.vault_id,
        last_sync_at_ms: status.last_sync_at_ms.map(|at| at as f64),
        log: status
            .log
            .into_iter()
            .map(|entry| RemoteSyncLogSnapshot {
                kind: entry.kind,
                message: entry.message,
                created_at_ms: entry.created_at_ms as f64,
            })
            .collect(),
    })
}

/// Creates this account's encryption key on its first device and returns
/// the recovery string, which the user must save.
#[tauri::command(async)]
#[specta::specta]
pub fn app__remote_sync_key_create(
    state: State<'_, AppState>,
    own_key: Option<String>,
) -> Result<String, AppError> {
    Ok(state.runtime_host().remote_sync_key_create(own_key)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__remote_sync_key_import(
    state: State<'_, AppState>,
    recovery_string: String,
) -> Result<(), AppError> {
    Ok(state
        .runtime_host()
        .remote_sync_key_import(recovery_string)?)
}

#[tauri::command(async)]
#[specta::specta]
pub fn app__remote_sync_recovery_string_get(
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    Ok(state.runtime_host().remote_sync_recovery_string()?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_now(
    state: State<'_, AppState>,
) -> Result<RemoteSyncRunSnapshot, AppError> {
    let report = state.runtime_host().remote_sync_run().await?;
    Ok(RemoteSyncRunSnapshot {
        created_vault: report.created_vault,
        pushed_rows: count(report.pushed_rows),
        imported_rows: count(report.imported_rows),
        matched_rows: count(report.matched_rows),
        gaps: count(report.gaps),
        unknown_streams: report.unknown_streams,
        cancelled: report.cancelled,
    })
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ShareCollectionCreateInput {
    pub title: String,
    pub listed: bool,
    pub include_notes: bool,
    pub world_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ShareCollectionSkippedWorld {
    pub world_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ShareCollectionCreateResult {
    pub id: String,
    pub url: String,
    pub world_count: i64,
    pub skipped_worlds: Vec<ShareCollectionSkippedWorld>,
}

#[tauri::command]
#[specta::specta]
pub async fn app__share_collection_create(
    state: State<'_, AppState>,
    input: ShareCollectionCreateInput,
) -> Result<ShareCollectionCreateResult, AppError> {
    let outcome = state
        .runtime_host()
        .remote_sync_share_collection(
            vrcx_0_runtime_host_desktop::remote_sync::ShareCollectionRequest {
                title: input.title,
                listed: input.listed,
                include_notes: input.include_notes,
                world_ids: input.world_ids,
            },
        )
        .await?;
    Ok(ShareCollectionCreateResult {
        id: outcome.id,
        url: outcome.url,
        world_count: outcome.world_count,
        skipped_worlds: outcome
            .skipped_worlds
            .into_iter()
            .map(|(world_id, name)| ShareCollectionSkippedWorld { world_id, name })
            .collect(),
    })
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_delete_data(
    state: State<'_, AppState>,
    keep_collections: bool,
) -> Result<(), AppError> {
    Ok(state
        .runtime_host()
        .remote_sync_delete_data(keep_collections)
        .await?)
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncClientAddress {
    pub ip: String,
    pub location: String,
    pub first_seen_ms: f64,
    pub last_seen_ms: f64,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncClientSnapshot {
    pub client_id: String,
    pub kind: String,
    pub label: String,
    pub client_version: Option<String>,
    pub current: bool,
    pub active_now: bool,
    pub revoked: bool,
    pub last_seen_ms: Option<f64>,
    pub address: Option<RemoteSyncClientAddress>,
    pub history: Vec<RemoteSyncClientAddress>,
}

fn client_address(
    entry: vrcx_0_nanashi_website_protocol::api::ClientIpEntry,
) -> RemoteSyncClientAddress {
    let location = [
        entry.location.city,
        entry.location.region,
        entry.location.country,
    ]
    .into_iter()
    .flatten()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(", ");
    RemoteSyncClientAddress {
        ip: entry.ip,
        location,
        first_seen_ms: entry.first_seen_ms as f64,
        last_seen_ms: entry.last_seen_ms as f64,
    }
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_clients_get(
    state: State<'_, AppState>,
) -> Result<Vec<RemoteSyncClientSnapshot>, AppError> {
    Ok(state
        .runtime_host()
        .remote_sync_clients()
        .await?
        .into_iter()
        .map(|client| RemoteSyncClientSnapshot {
            client_id: client.client_id,
            kind: match client.kind {
                vrcx_0_remote_sync::ClientKind::Desktop => "desktop",
                vrcx_0_remote_sync::ClientKind::WebSession => "web_session",
                vrcx_0_remote_sync::ClientKind::ManualToken => "manual_token",
            }
            .into(),
            label: client.label,
            client_version: client.client_version,
            current: client.current,
            active_now: client.active_now,
            revoked: client.revoked_at_ms.is_some(),
            last_seen_ms: client.last_seen_ms.map(|at| at as f64),
            address: client.current_ip.map(client_address),
            history: client.history.into_iter().map(client_address).collect(),
        })
        .collect())
}

/// Signs out one other client, or every other client when `client_id` is
/// absent, after checking the second-factor code with the server.
#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_clients_revoke(
    state: State<'_, AppState>,
    method: String,
    code: String,
    client_id: Option<String>,
) -> Result<(), AppError> {
    Ok(state
        .runtime_host()
        .remote_sync_revoke(&method, code, client_id)
        .await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_email_code_send(state: State<'_, AppState>) -> Result<(), AppError> {
    Ok(state.runtime_host().remote_sync_send_email_code().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_transfer_begin(
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    Ok(state.runtime_host().remote_sync_transfer_begin().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_transfer_poll(state: State<'_, AppState>) -> Result<bool, AppError> {
    Ok(state.runtime_host().remote_sync_transfer_poll().await?)
}

#[tauri::command]
#[specta::specta]
pub async fn app__remote_sync_transfer_send(
    state: State<'_, AppState>,
    code: String,
) -> Result<(), AppError> {
    Ok(state.runtime_host().remote_sync_transfer_send(code).await?)
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__remote_sync_key_rotate(
    state: State<'_, AppState>,
    method: String,
    code: String,
) -> Result<String, AppError> {
    Ok(state
        .runtime_host()
        .remote_sync_key_rotate(&method, code)
        .await?)
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__remote_sync_collector_unlock(
    state: State<'_, AppState>,
    days: u32,
    interval_seconds: u32,
) -> Result<(), AppError> {
    Ok(state
        .runtime_host()
        .remote_sync_collector_unlock(days, interval_seconds)
        .await?)
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__remote_sync_collector_lock(state: State<'_, AppState>) -> Result<(), AppError> {
    Ok(state.runtime_host().remote_sync_collector_lock().await?)
}

#[tauri::command(async)]
#[specta::specta]
pub async fn app__remote_sync_collector_snapshot(
    state: State<'_, AppState>,
) -> Result<vrcx_0_runtime_host_desktop::remote_sync::CollectorSnapshot, AppError> {
    Ok(state
        .runtime_host()
        .remote_sync_collector_snapshot()
        .await?)
}

/// Syncs in the background while RemoteSync is set up. While the backend is
/// off or this PC is not paired, a tick does nothing and contacts no server.
pub(crate) fn start_background_sync(app: &tauri::AppHandle) {
    use tauri::Manager;
    let coverage_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let state = coverage_app.state::<AppState>();
        state.runtime_host().remote_sync_coverage_loop().await;
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_sync = tokio::time::Instant::now() - BACKGROUND_SYNC_INTERVAL;
        loop {
            let state = app.state::<AppState>();
            let ready = state
                .runtime_host()
                .remote_sync_status()
                .is_ok_and(|status| {
                    status.enabled && status.paired && status.has_key && status.signed_in_to_vrchat
                });
            if state.runtime_host().remote_sync_enabled() {
                let server = format!(
                    "{}|{}",
                    state
                        .runtime_host()
                        .config_string(API_ORIGIN_KEY, OFFICIAL_API),
                    state
                        .runtime_host()
                        .config_string(WEBSITE_ORIGIN_KEY, OFFICIAL_WEBSITE)
                );
                let last = trust_history(&state)
                    .get(&server)
                    .map_or(0, |memory| memory.checked_at_ms);
                if unix_ms() - last >= TRUST_RECHECK_MS {
                    match trust_check(&state).await {
                        Ok(trust)
                            if trust.code == RemoteSyncCodeTrust::Modified
                                || trust.instance == RemoteSyncInstanceTrust::Invalid =>
                        {
                            tracing::warn!(
                                code = ?trust.code,
                                instance = ?trust.instance,
                                "the RemoteSync server failed a trust check"
                            );
                        }
                        Ok(_) => {}
                        Err(error) => tracing::debug!(%error, "trust check could not run"),
                    }
                }
            }
            if ready {
                let due = last_sync.elapsed() >= BACKGROUND_SYNC_INTERVAL;
                let backlog = state
                    .runtime_host()
                    .remote_sync_pending_rows(BACKGROUND_SYNC_ROW_THRESHOLD)
                    .unwrap_or(0);
                if due || backlog >= BACKGROUND_SYNC_ROW_THRESHOLD {
                    if let Err(error) = state.runtime_host().remote_sync_run().await {
                        tracing::warn!(%error, "background history sync failed");
                    }
                    last_sync = tokio::time::Instant::now();
                }
            }
            tokio::time::sleep(BACKGROUND_SYNC_CHECK_INTERVAL).await;
        }
    });
}
