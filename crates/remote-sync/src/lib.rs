//! RemoteSync network and cryptographic operations for the desktop app.
//! UI code consumes typed results and never constructs protocol messages.

use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{de::DeserializeOwned, Deserialize};
use sha2::{Digest, Sha256};
use vrcx_0_http_client::{builder, Policy, RequestBuilderExt};
use vrcx_0_nanashi_website_protocol::api::{
    self, AccountInfo, Capabilities, ChunkStored, CollectorStatus, CompactRequest,
    CreateVaultRequest, DeviceAuthorizeRequest, DeviceAuthorizeResponse, DeviceTokenRequest,
    DeviceTokenResponse, Scope, VaultInfo,
};
use vrcx_0_nanashi_website_protocol::ids::{ChunkId, VaultId};

pub use vrcx_0_nanashi_website_protocol::api::Capabilities as ProtocolCapabilities;
pub use vrcx_0_nanashi_website_protocol::api::{
    ClientInfo, ClientKind, CollectionSnapshot, CollectionWorld, ReauthMethod,
};

pub const OFFICIAL_API: &str = "https://vrcx-api.namelessnanashi.dev";
pub const OFFICIAL_WEBSITE: &str = "https://vrcx.namelessnanashi.dev";
/// Keys the maintainer signs website builds with. More than one entry lets
/// a new key be introduced before the old one is retired.
const OFFICIAL_WEBSITE_KEYS: &[&str] =
    &["MCowBQYDK2VwAyEAZFMdbH5lgJK5hR3tqn3VwFJEZj7qXncSFgpV88pfKsk="];
const MAX_MANIFEST_BYTES: usize = 4 * 1024 * 1024;
/// The maintainer's key for instance statements. It is separate from the
/// website code key, so signing a release never vouches for a server.
const OFFICIAL_INSTANCE_KEYS: &[&str] =
    &["MCowBQYDK2VwAyEA6HY7SO+vpZsdC/xzMWG9DSD9uWRVj7mW6mkBqHu0bmk="];
const MAX_INSTANCE_STATEMENT_BYTES: usize = 4096;

/// Whether a server proved it is the maintainer's own instance.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InstanceTrust {
    /// The statement is signed by the maintainer and names these origins.
    Official,
    /// The server publishes no statement, as any other instance would.
    Unattested,
    /// A statement exists but is not valid for this server.
    Invalid(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceStatement {
    v: u32,
    api_origin: String,
    website_origin: String,
    expires_at_ms: i64,
}

/// Checks a statement against the signing key and the origins the app is
/// actually talking to. Binding the origins is what stops another server
/// from serving a copy of the official statement.
fn check_instance_statement(
    statement: &[u8],
    signature: &str,
    public_keys: &[&str],
    api_origin: &str,
    website_origin: &str,
    now_ms: i64,
) -> InstanceTrust {
    let invalid = |reason: &str| InstanceTrust::Invalid(reason.into());
    let keys = public_keys
        .iter()
        .filter_map(|key| decode_public_key(key).ok())
        .filter_map(|bytes| VerifyingKey::from_bytes(&bytes).ok())
        .collect::<Vec<_>>();
    let Some(signature) = STANDARD
        .decode(signature.trim())
        .ok()
        .and_then(|bytes| Signature::from_slice(&bytes).ok())
    else {
        return invalid("the instance signature is malformed");
    };
    if !keys
        .iter()
        .any(|key| key.verify_strict(statement, &signature).is_ok())
    {
        return invalid("the instance statement is not signed by the VRCX-0-Nanashi maintainer");
    }
    let Ok(parsed) = serde_json::from_slice::<InstanceStatement>(statement) else {
        return invalid("the instance statement is unreadable");
    };
    if parsed.v != 1 {
        return invalid("the instance statement uses an unknown version");
    }
    if now_ms > parsed.expires_at_ms {
        return invalid("the instance statement has expired");
    }
    if parsed.api_origin != api_origin || parsed.website_origin != website_origin {
        return invalid("the instance statement was issued for a different server");
    }
    InstanceTrust::Official
}

pub mod engine;
pub mod sync;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Server URL must be an HTTPS origin without a path, query, or credentials")]
    InvalidOrigin,
    #[error("RemoteSync request failed: {0}")]
    Transport(String),
    #[error("RemoteSync returned an invalid response")]
    InvalidResponse,
    #[error("RemoteSync server is incompatible: {0}")]
    Incompatible(String),
    #[error("RemoteSync request failed ({status}): {code}: {message}")]
    Api {
        status: u16,
        code: String,
        message: String,
    },
    #[error("The website did not provide a signed manifest")]
    UnsignedWebsite,
    #[error("Website integrity check failed: {0}")]
    Integrity(String),
    #[error("The trusted public key is invalid")]
    InvalidPublicKey,
    #[error("Local sync data could not be read or written: {0}")]
    Storage(String),
}

#[derive(Clone, PartialEq, Eq)]
pub enum PairPoll {
    Pending { interval_seconds: u32 },
    Approved { account_id: String, token: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebsiteVerification {
    pub verified: bool,
    pub version: Option<String>,
    pub source_commit: Option<String>,
    pub files_checked: usize,
    pub detail: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssetManifest {
    version: String,
    source_commit: String,
    files: Vec<AssetEntry>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetEntry {
    path: String,
    sha256: String,
}

#[derive(Clone)]
pub struct RemoteSyncClient {
    origin: url::Url,
    client: reqwest::Client,
    client_header: String,
    app_version: String,
}

impl RemoteSyncClient {
    pub fn new(origin: &str) -> Result<Self, Error> {
        Self::new_with_version(origin, env!("CARGO_PKG_VERSION"))
    }

    pub fn new_with_version(origin: &str, app_version: &str) -> Result<Self, Error> {
        let parsed = url::Url::parse(origin).map_err(|_| Error::InvalidOrigin)?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !matches!(parsed.path(), "" | "/")
        {
            return Err(Error::InvalidOrigin);
        }
        let mut origin = parsed;
        origin.set_path("");
        let client = builder()
            .min_tls_version(reqwest::tls::Version::TLS_1_3)
            .max_tls_version(reqwest::tls::Version::TLS_1_3)
            .build()
            .map_err(|e| Error::Transport(e.to_string()))?;
        let os = sysinfo::System::name().unwrap_or_else(|| std::env::consts::OS.into());
        let os_version = sysinfo::System::os_version().unwrap_or_else(|| "unknown".into());
        let client_header = format!(
            "VRCX-0-Nanashi/{app_version} ({os} {os_version}; {})",
            std::env::consts::ARCH
        );
        Ok(Self {
            origin,
            client,
            client_header,
            app_version: app_version.to_owned(),
        })
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{}", self.origin.as_str().trim_end_matches('/'), path)
    }

    async fn send_json<T: DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
        policy: Policy,
    ) -> Result<T, Error> {
        let response = request
            .header(api::headers::CLIENT, &self.client_header)
            .send_with_policy(policy.without_redirects())
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        let status = response.status();
        let body = response
            .bytes()
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        if !status.is_success() {
            let parsed: api::ApiError =
                serde_json::from_slice(&body).map_err(|_| Error::InvalidResponse)?;
            return Err(Error::Api {
                status: status.as_u16(),
                code: parsed.error.code,
                message: parsed.error.message,
            });
        }
        serde_json::from_slice(&body).map_err(|_| Error::InvalidResponse)
    }

    pub async fn capabilities(&self) -> Result<Capabilities, Error> {
        let capabilities: Capabilities = self
            .send_json(
                self.client.get(self.endpoint("/v1/capabilities")),
                Policy::sensitive(false),
            )
            .await?;
        if capabilities.server != api::SERVER_NAME {
            return Err(Error::Incompatible("unrecognized server".into()));
        }
        if !capabilities.protocol.contains(&api::PROTOCOL_VERSION) {
            return Err(Error::Incompatible(
                "server does not support protocol version 1".into(),
            ));
        }
        Ok(capabilities)
    }

    pub async fn account(&self, token: &str) -> Result<AccountInfo, Error> {
        self.send_json(
            self.client
                .get(self.endpoint("/v1/account"))
                .bearer_auth(token),
            Policy::sensitive(false),
        )
        .await
    }

    /// Creates a shared collection, or replaces `existing`, and returns its code.
    pub async fn save_collection(
        &self,
        token: &str,
        existing: Option<&str>,
        snapshot: &api::CollectionSnapshot,
    ) -> Result<String, Error> {
        #[derive(Deserialize)]
        struct Created {
            code: String,
        }
        let request = match existing {
            Some(code) => self
                .client
                .put(self.endpoint(&format!("/v1/collections/{code}"))),
            None => self.client.post(self.endpoint("/v1/collections")),
        };
        let response = request
            .bearer_auth(token)
            .header(api::headers::CLIENT, &self.client_header)
            .json(snapshot)
            .send_with_policy(Policy::sensitive(false).without_redirects())
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        if !status.is_success() {
            return self.decode_api_error(status.as_u16(), &bytes);
        }
        match existing {
            Some(code) => Ok(code.to_owned()),
            None => serde_json::from_slice::<Created>(&bytes)
                .map(|created| created.code)
                .map_err(|_| Error::InvalidResponse),
        }
    }

    /// Sends a request whose success carries no body worth reading.
    async fn send_empty(&self, request: reqwest::RequestBuilder, token: &str) -> Result<(), Error> {
        self.send_bytes(request, token).await.map(|_| ())
    }

    async fn send_bytes(
        &self,
        request: reqwest::RequestBuilder,
        token: &str,
    ) -> Result<Vec<u8>, Error> {
        let response = request
            .bearer_auth(token)
            .header(api::headers::CLIENT, &self.client_header)
            .send_with_policy(Policy::sensitive(false).without_redirects())
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        let status = response.status();
        let bytes = response
            .bytes()
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        if status.is_success() {
            Ok(bytes.to_vec())
        } else {
            self.decode_api_error(status.as_u16(), &bytes)
        }
    }

    /// Revokes the token that makes the call, signing this PC out.
    pub async fn revoke_current_token(&self, token: &str) -> Result<(), Error> {
        self.send_empty(
            self.client
                .delete(self.endpoint("/v1/account/tokens/current")),
            token,
        )
        .await
    }

    /// Deletes every vault, chunk and stored key of the account on the
    /// server. The server replies only after the data is gone.
    pub async fn delete_data(&self, token: &str, keep_collections: bool) -> Result<(), Error> {
        let query = if keep_collections {
            "?keepCollections=true"
        } else {
            ""
        };
        self.send_empty(
            self.client
                .delete(self.endpoint(&format!("/v1/account/data{query}"))),
            token,
        )
        .await
    }

    pub async fn clients(&self, token: &str) -> Result<Vec<api::ClientInfo>, Error> {
        self.send_json(
            self.client
                .get(self.endpoint("/v1/account/clients?history=true"))
                .bearer_auth(token),
            Policy::sensitive(false),
        )
        .await
    }

    /// Marks this token as recently verified with a second factor, which the
    /// server requires before it lets one client sign out another. Calling it
    /// for the email method without a code makes the server send one.
    pub async fn reauth(
        &self,
        token: &str,
        method: api::ReauthMethod,
        code: Option<&str>,
    ) -> Result<(), Error> {
        self.send_empty(
            self.client
                .post(self.endpoint("/v1/account/reauth"))
                .json(&api::ReauthRequest {
                    method,
                    code: code.map(|code| code.trim().to_owned()),
                }),
            token,
        )
        .await
    }

    pub async fn revoke_client(&self, token: &str, client_id: &str) -> Result<(), Error> {
        if client_id.is_empty()
            || !client_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err(Error::InvalidResponse);
        }
        self.send_empty(
            self.client
                .post(self.endpoint(&format!("/v1/account/clients/{client_id}/revoke"))),
            token,
        )
        .await
    }

    pub async fn revoke_other_clients(&self, token: &str) -> Result<(), Error> {
        self.send_empty(
            self.client
                .post(self.endpoint("/v1/account/clients/revoke-others")),
            token,
        )
        .await
    }

    pub async fn clear_client_history(&self, token: &str) -> Result<(), Error> {
        self.send_empty(
            self.client
                .delete(self.endpoint("/v1/account/clients/history")),
            token,
        )
        .await
    }

    pub async fn transfer_create(
        &self,
        token: &str,
        epk: String,
    ) -> Result<api::TransferCreated, Error> {
        self.send_json(
            self.client
                .post(self.endpoint("/v1/transfer"))
                .bearer_auth(token)
                .json(&api::TransferCreateRequest { epk }),
            Policy::sensitive(false),
        )
        .await
    }

    pub async fn transfer_key(
        &self,
        token: &str,
        transfer_id: &str,
    ) -> Result<api::TransferKey, Error> {
        self.send_json(
            self.client
                .get(self.endpoint(&format!("/v1/transfer/{transfer_id}")))
                .bearer_auth(token),
            Policy::sensitive(false),
        )
        .await
    }

    pub async fn transfer_complete(
        &self,
        token: &str,
        transfer_id: &str,
        sealed: Vec<u8>,
    ) -> Result<(), Error> {
        self.send_empty(
            self.client
                .put(self.endpoint(&format!("/v1/transfer/{transfer_id}")))
                .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
                .body(sealed),
            token,
        )
        .await
    }

    /// The sealed key once another device sent it, or `None` while waiting.
    pub async fn transfer_result(
        &self,
        token: &str,
        transfer_id: &str,
    ) -> Result<Option<Vec<u8>>, Error> {
        match self
            .send_bytes(
                self.client
                    .get(self.endpoint(&format!("/v1/transfer/{transfer_id}/result"))),
                token,
            )
            .await
        {
            Ok(bytes) => Ok(Some(bytes)),
            Err(Error::Api { code, .. }) if code == api::codes::AUTHORIZATION_PENDING => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub async fn vaults(&self, token: &str) -> Result<Vec<VaultInfo>, Error> {
        self.send_json(
            self.client
                .get(self.endpoint("/v1/vaults"))
                .bearer_auth(token),
            Policy::sensitive(false),
        )
        .await
    }

    pub async fn create_vault(
        &self,
        token: &str,
        request: &CreateVaultRequest,
    ) -> Result<VaultInfo, Error> {
        self.send_json(
            self.client
                .post(self.endpoint("/v1/vaults"))
                .bearer_auth(token)
                .json(request),
            Policy::sensitive(false),
        )
        .await
    }

    pub async fn get_manifest(
        &self,
        token: &str,
        vault_id: VaultId,
    ) -> Result<(u64, Vec<u8>), Error> {
        let response = self
            .client
            .get(self.endpoint(&format!("/v1/vaults/{vault_id}/manifest")))
            .bearer_auth(token)
            .header(api::headers::CLIENT, &self.client_header)
            .send_with_policy(Policy::sensitive(false).without_redirects())
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            return self.decode_api_error(
                status.as_u16(),
                response
                    .bytes()
                    .await
                    .map_err(|e| Error::Transport(e.to_string()))?
                    .as_ref(),
            );
        }
        let sequence = response
            .headers()
            .get(api::headers::MANIFEST_SEQ)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok())
            .ok_or(Error::InvalidResponse)?;
        let body = response
            .bytes()
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        Ok((sequence, body.to_vec()))
    }

    pub async fn put_manifest(
        &self,
        token: &str,
        vault_id: VaultId,
        manifest_seq: u64,
        expected_previous_seq: u64,
        body: Vec<u8>,
    ) -> Result<(), Error> {
        let response = self
            .client
            .put(self.endpoint(&format!("/v1/vaults/{vault_id}/manifest")))
            .bearer_auth(token)
            .header(api::headers::CLIENT, &self.client_header)
            .header(api::headers::MANIFEST_SEQ, manifest_seq)
            .header(api::headers::IF_MATCH_SEQ, expected_previous_seq)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(body)
            .send_with_policy(Policy::sensitive(false).without_redirects())
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status().as_u16();
            let bytes = response
                .bytes()
                .await
                .map_err(|e| Error::Transport(e.to_string()))?;
            self.decode_api_error(status, &bytes)
        }
    }

    pub async fn upload_chunk(
        &self,
        token: &str,
        vault_id: VaultId,
        chunk_id: ChunkId,
        body: Vec<u8>,
    ) -> Result<ChunkStored, Error> {
        self.send_json(
            self.client
                .post(self.endpoint(&format!("/v1/vaults/{vault_id}/chunks")))
                .bearer_auth(token)
                .header(api::headers::CHUNK_ID, chunk_id.to_string())
                .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
                .body(body),
            Policy::sensitive(false),
        )
        .await
    }

    pub async fn download_chunk_batch(
        &self,
        token: &str,
        vault_id: VaultId,
        after: u64,
        limit: u16,
    ) -> Result<(u64, bool, Vec<u8>), Error> {
        let response = self
            .client
            .get(self.endpoint(&format!(
                "/v1/vaults/{vault_id}/chunks:batch?after={after}&limit={}",
                limit.clamp(1, 500)
            )))
            .bearer_auth(token)
            .header(api::headers::CLIENT, &self.client_header)
            .send_with_policy(Policy::sensitive(false).without_redirects())
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            let bytes = response
                .bytes()
                .await
                .map_err(|e| Error::Transport(e.to_string()))?;
            return self.decode_api_error(status.as_u16(), &bytes);
        }
        let max_seq = response
            .headers()
            .get("x-max-seq")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok())
            .ok_or(Error::InvalidResponse)?;
        let has_more = response
            .headers()
            .get("x-has-more")
            .and_then(|value| value.to_str().ok())
            .map(|value| value.eq_ignore_ascii_case("true"))
            .ok_or(Error::InvalidResponse)?;
        let body = response
            .bytes()
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        Ok((max_seq, has_more, body.to_vec()))
    }

    pub async fn compact_vault(
        &self,
        token: &str,
        vault_id: VaultId,
        request: &CompactRequest,
    ) -> Result<(), Error> {
        self.send_empty(
            self.client
                .post(self.endpoint(&format!("/v1/vaults/{vault_id}/compact")))
                .json(request),
            token,
        )
        .await
    }

    pub async fn collector_status(
        &self,
        token: &str,
        vault_id: VaultId,
    ) -> Result<CollectorStatus, Error> {
        self.send_json(
            self.client
                .get(self.endpoint(&format!("/v1/vaults/{vault_id}/collector")))
                .bearer_auth(token),
            Policy::sensitive(false),
        )
        .await
    }

    pub async fn collector_unlock(
        &self,
        token: &str,
        vault_id: VaultId,
        sealed_payload: Vec<u8>,
    ) -> Result<(), Error> {
        self.send_empty(
            self.client
                .post(self.endpoint(&format!("/v1/vaults/{vault_id}/collector/unlock")))
                .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
                .body(sealed_payload),
            token,
        )
        .await
    }

    pub async fn collector_lock(&self, token: &str, vault_id: VaultId) -> Result<(), Error> {
        self.send_empty(
            self.client
                .post(self.endpoint(&format!("/v1/vaults/{vault_id}/collector/lock"))),
            token,
        )
        .await
    }

    pub async fn live_snapshot(
        &self,
        token: &str,
        vault_id: VaultId,
    ) -> Result<(u64, u64, Vec<u8>), Error> {
        let response = self
            .client
            .get(self.endpoint(&format!("/v1/vaults/{vault_id}/live")))
            .bearer_auth(token)
            .header(api::headers::CLIENT, &self.client_header)
            .send_with_policy(Policy::sensitive(false).without_redirects())
            .await
            .map_err(|error| Error::Transport(error.to_string()))?;
        let status = response.status();
        let sequence = response
            .headers()
            .get(api::headers::LIVE_SEQ)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok());
        let age = response
            .headers()
            .get(api::headers::LIVE_AGE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok());
        let body = response
            .bytes()
            .await
            .map_err(|error| Error::Transport(error.to_string()))?;
        if !status.is_success() {
            return self.decode_api_error(status.as_u16(), &body);
        }
        Ok((
            sequence.ok_or(Error::InvalidResponse)?,
            age.ok_or(Error::InvalidResponse)?,
            body.to_vec(),
        ))
    }

    fn decode_api_error<T>(&self, status: u16, body: &[u8]) -> Result<T, Error> {
        let parsed: api::ApiError =
            serde_json::from_slice(body).map_err(|_| Error::InvalidResponse)?;
        Err(Error::Api {
            status,
            code: parsed.error.code,
            message: parsed.error.message,
        })
    }

    pub async fn authorize_device(
        &self,
        device_label: String,
    ) -> Result<DeviceAuthorizeResponse, Error> {
        self.send_json(
            self.client
                .post(self.endpoint("/v1/device/authorize"))
                .json(&DeviceAuthorizeRequest {
                    device_label,
                    requested_scopes: vec![
                        Scope::Sync,
                        Scope::Account,
                        Scope::Collector,
                        Scope::Share,
                    ],
                }),
            Policy::sensitive(false),
        )
        .await
    }

    pub async fn poll_device(
        &self,
        device_code: &str,
        current_interval_seconds: u32,
    ) -> Result<PairPoll, Error> {
        let response = self
            .send_json::<DeviceTokenResponse>(
                self.client
                    .post(self.endpoint("/v1/device/token"))
                    .json(&DeviceTokenRequest {
                        device_code: device_code.to_owned(),
                    }),
                Policy::sensitive(false),
            )
            .await;
        interpret_pair_response(response, current_interval_seconds)
    }

    /// Asks the website for its instance statement and checks it. A network
    /// failure is an error; a server without a statement is `Unattested`.
    pub async fn verify_instance(&self, website_origin: &str) -> Result<InstanceTrust, Error> {
        let website = Self::new_with_version(website_origin, &self.app_version)?;
        let mut parts = Vec::new();
        for path in ["/instance.json", "/instance.sig"] {
            let response = website
                .client
                .get(website.endpoint(path))
                .header(api::headers::CLIENT, &website.client_header)
                .send_with_policy(Policy::public().without_redirects())
                .await
                .map_err(|e| Error::Transport(e.to_string()))?;
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                return Ok(InstanceTrust::Unattested);
            }
            if !response.status().is_success() {
                return Ok(InstanceTrust::Invalid(
                    "the instance statement could not be fetched".into(),
                ));
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|e| Error::Transport(e.to_string()))?;
            if bytes.len() > MAX_INSTANCE_STATEMENT_BYTES {
                return Ok(InstanceTrust::Invalid(
                    "the instance statement is too large".into(),
                ));
            }
            parts.push(bytes);
        }
        let api_origin = self.origin.as_str().trim_end_matches('/');
        let website_origin = website.origin.as_str().trim_end_matches('/');
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as i64)
            .unwrap_or(0);
        let signature = String::from_utf8_lossy(&parts[1]).trim().to_owned();
        let trust = check_instance_statement(
            &parts[0],
            &signature,
            OFFICIAL_INSTANCE_KEYS,
            api_origin,
            website_origin,
            now_ms,
        );
        if trust != InstanceTrust::Official {
            return Ok(trust);
        }
        // The backend must present the same statement, so an official
        // website cannot be put in front of someone else's backend.
        #[derive(Deserialize)]
        struct ApiCopy {
            statement: String,
            signature: String,
        }
        let api_copy: Result<ApiCopy, Error> = self
            .send_json(
                self.client.get(self.endpoint("/v1/instance")),
                Policy::public(),
            )
            .await;
        Ok(match api_copy {
            Ok(copy)
                if copy.statement.as_bytes() == parts[0].as_ref()
                    && copy.signature.trim() == signature =>
            {
                InstanceTrust::Official
            }
            Ok(_) => InstanceTrust::Invalid(
                "the website and the backend present different instance statements".into(),
            ),
            Err(Error::Transport(detail)) => return Err(Error::Transport(detail)),
            Err(_) => InstanceTrust::Invalid(
                "the backend does not present the instance statement its website does".into(),
            ),
        })
    }

    pub async fn verify_website(
        &self,
        website_origin: &str,
        trusted_public_key: Option<&str>,
    ) -> Result<WebsiteVerification, Error> {
        let website = Self::new_with_version(website_origin, &self.app_version)?;
        let manifest_url = website.endpoint("/web-manifest.json");
        let signature_url = website.endpoint("/web-manifest.sig");
        let manifest_response = website
            .client
            .get(manifest_url)
            .header(api::headers::CLIENT, &website.client_header)
            .send_with_policy(Policy::public().without_redirects())
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        if manifest_response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(unsigned_website_result());
        }
        if !manifest_response.status().is_success() {
            return Err(Error::Integrity(
                "website manifest could not be fetched successfully".into(),
            ));
        }
        let manifest_bytes = manifest_response
            .bytes()
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        if manifest_bytes.len() > MAX_MANIFEST_BYTES {
            return Err(Error::Integrity("manifest exceeds size limit".into()));
        }
        let signature_response = website
            .client
            .get(signature_url)
            .header(api::headers::CLIENT, &website.client_header)
            .send_with_policy(Policy::public().without_redirects())
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        if signature_response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(unsigned_website_result());
        }
        if !signature_response.status().is_success() {
            return Err(Error::Integrity(
                "website manifest signature could not be fetched successfully".into(),
            ));
        }
        let signature_text = signature_response
            .text()
            .await
            .map_err(|e| Error::Transport(e.to_string()))?;
        let signature_bytes = STANDARD
            .decode(signature_text.trim())
            .map_err(|_| Error::Integrity("signature is not valid base64".into()))?;
        let signature = Signature::from_slice(&signature_bytes)
            .map_err(|_| Error::Integrity("signature has an invalid length".into()))?;
        let candidates = match trusted_public_key {
            Some(key) => vec![key],
            None => OFFICIAL_WEBSITE_KEYS.to_vec(),
        };
        let mut signed = false;
        for key_text in candidates {
            let key_bytes = decode_public_key(key_text)?;
            let public_key =
                VerifyingKey::from_bytes(&key_bytes).map_err(|_| Error::InvalidPublicKey)?;
            signed |= public_key
                .verify_strict(&manifest_bytes, &signature)
                .is_ok();
        }
        if !signed {
            return Err(Error::Integrity(
                "manifest signature does not match the trusted key".into(),
            ));
        }
        let manifest: AssetManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|_| Error::Integrity("manifest format is invalid".into()))?;
        if manifest.version.trim().is_empty()
            || manifest.source_commit.trim().is_empty()
            || manifest.files.is_empty()
        {
            return Err(Error::Integrity(
                "manifest is missing build identity or assets".into(),
            ));
        }
        let mut paths = std::collections::HashSet::new();
        for entry in &manifest.files {
            let path = safe_asset_path(&entry.path)?;
            if !paths.insert(path.clone()) {
                return Err(Error::Integrity(
                    "manifest contains a duplicate asset path".into(),
                ));
            }
            let url = website.endpoint(&format!("/{path}"));
            let response = website
                .client
                .get(url)
                .header(api::headers::CLIENT, &website.client_header)
                .send_with_policy(Policy::public().without_redirects())
                .await
                .map_err(|e| Error::Transport(e.to_string()))?;
            if !response.status().is_success() {
                return Err(Error::Integrity(format!(
                    "asset {} could not be read",
                    entry.path
                )));
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|e| Error::Transport(e.to_string()))?;
            let expected = decode_sha256(&entry.sha256)?;
            let actual = Sha256::digest(&bytes);
            if actual.as_slice() != expected {
                return Err(Error::Integrity(format!(
                    "asset {} hash mismatch",
                    entry.path
                )));
            }
        }
        Ok(WebsiteVerification {
            verified: true,
            version: Some(manifest.version),
            source_commit: Some(manifest.source_commit),
            files_checked: manifest.files.len(),
            detail: "Website signature and listed asset hashes are valid".into(),
        })
    }
}

fn interpret_pair_response(
    response: Result<DeviceTokenResponse, Error>,
    current_interval_seconds: u32,
) -> Result<PairPoll, Error> {
    match response {
        Ok(credentials) => Ok(PairPoll::Approved {
            account_id: credentials.account_id.to_string(),
            token: credentials.token,
        }),
        Err(Error::Api {
            status: 400, code, ..
        }) if code == api::codes::AUTHORIZATION_PENDING => Ok(PairPoll::Pending {
            interval_seconds: current_interval_seconds,
        }),
        Err(Error::Api {
            status: 400, code, ..
        }) if code == api::codes::SLOW_DOWN => Ok(PairPoll::Pending {
            interval_seconds: current_interval_seconds.saturating_add(5),
        }),
        Err(error) => Err(error),
    }
}

pub fn validate_public_key(text: &str) -> Result<(), Error> {
    let bytes = decode_public_key(text)?;
    VerifyingKey::from_bytes(&bytes)
        .map(|_| ())
        .map_err(|_| Error::InvalidPublicKey)
}

fn decode_public_key(text: &str) -> Result<[u8; 32], Error> {
    let bytes = if text.contains("BEGIN PUBLIC KEY") {
        let body = text
            .lines()
            .filter(|line| !line.starts_with("-----"))
            .collect::<String>();
        STANDARD.decode(body)
    } else {
        STANDARD.decode(text.trim())
    }
    .map_err(|_| Error::InvalidPublicKey)?;
    // The PEM is the standard SubjectPublicKeyInfo wrapper for Ed25519.
    let key = bytes
        .strip_prefix(&[
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        ])
        .ok_or(Error::InvalidPublicKey)?;
    key.try_into().map_err(|_| Error::InvalidPublicKey)
}

fn safe_asset_path(path: &str) -> Result<String, Error> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || path.contains('?')
        || path.contains('#')
        || !path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-'))
    {
        return Err(Error::Integrity(
            "manifest contains an unsafe asset path".into(),
        ));
    }
    Ok(path.into())
}

fn decode_sha256(value: &str) -> Result<[u8; 32], Error> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(Error::Integrity(
            "manifest contains an invalid SHA-256 digest".into(),
        ));
    }
    let mut digest = [0; 32];
    for (index, pair) in value.as_bytes().as_chunks::<2>().0.iter().enumerate() {
        let pair = std::str::from_utf8(pair).map_err(|_| Error::InvalidResponse)?;
        digest[index] = u8::from_str_radix(pair, 16).map_err(|_| Error::InvalidResponse)?;
    }
    Ok(digest)
}

pub fn unsigned_website_result() -> WebsiteVerification {
    WebsiteVerification {
        verified: false,
        version: None,
        source_commit: None,
        files_checked: 0,
        detail: "Not verified: this website does not provide a signed manifest".into(),
    }
}

/// Name shown for this PC in the vault's list of devices.
pub fn device_label() -> String {
    sysinfo::System::host_name()
        .map(|name| name.trim().chars().take(64).collect::<String>())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "VRCX-0-Nanashi".into())
}

pub fn pairing_deadline(expires_in: u32) -> tokio::time::Instant {
    tokio::time::Instant::now() + Duration::from_secs(u64::from(expires_in))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_origins_are_accepted() {
        assert!(RemoteSyncClient::new("http://localhost:8000").is_err());
        assert!(RemoteSyncClient::new("https://example.com/path").is_err());
        assert!(RemoteSyncClient::new("https://user@example.com").is_err());
        assert!(RemoteSyncClient::new("https://example.com").is_ok());
    }

    #[test]
    fn official_key_and_safe_manifest_fields_parse() {
        assert!(decode_public_key(OFFICIAL_WEBSITE_KEYS[0]).is_ok());
        assert_eq!(safe_asset_path("assets/app.js").unwrap(), "assets/app.js");
        assert!(safe_asset_path("../secret").is_err());
        assert!(safe_asset_path("/absolute").is_err());
        assert!(decode_sha256(&"ab".repeat(32)).is_ok());
        assert!(decode_sha256("invalid").is_err());
    }

    fn signed_statement(api: &str, website: &str) -> (Vec<u8>, String, String) {
        use ed25519_dalek::{Signer, SigningKey};
        let key = SigningKey::from_bytes(&[7; 32]);
        let statement =
            format!(r#"{{"v":1,"apiOrigin":"{api}","websiteOrigin":"{website}","issuedAtMs":1000,"expiresAtMs":5000}}"#).into_bytes();
        let signature = STANDARD.encode(key.sign(&statement).to_bytes());
        let mut spki = vec![
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        ];
        spki.extend_from_slice(key.verifying_key().as_bytes());
        (statement, signature, STANDARD.encode(spki))
    }

    #[test]
    fn instance_statement_passes_only_for_the_signed_origins_and_key() {
        let (api, website) = ("https://api.example.com", "https://www.example.com");
        let (statement, signature, key) = signed_statement(api, website);
        let check =
            |statement: &[u8], signature: &str, keys: &[&str], api: &str, website: &str, now| {
                check_instance_statement(statement, signature, keys, api, website, now)
            };
        assert_eq!(
            check(&statement, &signature, &[&key], api, website, 2000),
            InstanceTrust::Official
        );
        // Someone else serving a copy of the official statement.
        assert!(matches!(
            check(
                &statement,
                &signature,
                &[&key],
                "https://api.other.example",
                website,
                2000
            ),
            InstanceTrust::Invalid(_)
        ));
        assert!(matches!(
            check(
                &statement,
                &signature,
                &[&key],
                api,
                "https://www.other.example",
                2000
            ),
            InstanceTrust::Invalid(_)
        ));
        // A statement edited after signing, signed by another key, or expired.
        let mut edited = statement.clone();
        let last = edited.len() - 3;
        edited[last] ^= 1;
        assert!(matches!(
            check(&edited, &signature, &[&key], api, website, 2000),
            InstanceTrust::Invalid(_)
        ));
        assert!(matches!(
            check(
                &statement,
                &signature,
                OFFICIAL_INSTANCE_KEYS,
                api,
                website,
                2000
            ),
            InstanceTrust::Invalid(_)
        ));
        assert!(matches!(
            check(&statement, "not base64", &[&key], api, website, 2000),
            InstanceTrust::Invalid(_)
        ));
        assert!(matches!(
            check(&statement, &signature, &[&key], api, website, 5001),
            InstanceTrust::Invalid(_)
        ));
        // A second pinned key, as during a key rotation.
        assert_eq!(
            check(
                &statement,
                &signature,
                &[OFFICIAL_INSTANCE_KEYS[0], &key],
                api,
                website,
                2000
            ),
            InstanceTrust::Official
        );
        for pinned in OFFICIAL_INSTANCE_KEYS.iter().chain(OFFICIAL_WEBSITE_KEYS) {
            assert!(decode_public_key(pinned).is_ok());
        }
    }

    #[test]
    fn unsigned_result_never_claims_verification() {
        let result = unsigned_website_result();
        assert!(!result.verified);
        assert_eq!(result.files_checked, 0);
        assert!(result.detail.contains("Not verified"));
    }

    #[test]
    fn pairing_handles_pending_slow_down_denial_and_expiry() {
        let make_error = |code: &str| Error::Api {
            status: 400,
            code: code.into(),
            message: String::new(),
        };
        assert!(matches!(
            interpret_pair_response(Err(make_error(api::codes::AUTHORIZATION_PENDING)), 5),
            Ok(PairPoll::Pending {
                interval_seconds: 5
            })
        ));
        assert!(matches!(
            interpret_pair_response(Err(make_error(api::codes::SLOW_DOWN)), 5),
            Ok(PairPoll::Pending {
                interval_seconds: 10
            })
        ));
        for code in [api::codes::ACCESS_DENIED, api::codes::EXPIRED_TOKEN] {
            assert!(matches!(
                interpret_pair_response(Err(make_error(code)), 5),
                Err(Error::Api { .. })
            ));
        }
    }
}
