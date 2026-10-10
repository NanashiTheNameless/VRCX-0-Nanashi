use std::collections::HashMap;

use vrcx_0_nanashi_website_protocol::{
    api::batch,
    chunk::{self, ChunkDraft, OpenedChunk},
    ids::{ChunkId, SourceId, VaultId},
    keys::VaultKeys,
    manifest::{self, Manifest},
};

use crate::Error;

pub use vrcx_0_nanashi_website_protocol::keys::SignerKey;
pub use vrcx_0_nanashi_website_protocol::secret::SyncSecret;

#[derive(Debug)]
pub struct VerifiedBatch {
    pub chunks: Vec<(u64, OpenedChunk)>,
    pub server_gaps: Vec<(u64, u64)>,
    pub source_gaps: Vec<(String, u64, u64)>,
    pub next_cursor: u64,
}

pub fn generate_sync_secret() -> Result<SyncSecret, Error> {
    SyncSecret::generate().map_err(|error| Error::Incompatible(error.to_string()))
}

pub fn parse_recovery_string(input: &str) -> Result<SyncSecret, Error> {
    SyncSecret::from_recovery_string(input).map_err(|error| Error::Incompatible(error.to_string()))
}

pub fn parse_own_key(input: &str) -> Result<SyncSecret, Error> {
    SyncSecret::parse_own_key(input).map_err(|error| Error::Incompatible(error.to_string()))
}

pub fn recovery_string(secret: &SyncSecret) -> zeroize::Zeroizing<String> {
    secret.to_recovery_string()
}

pub fn derive_vault_keys(secret: &SyncSecret, vault_id: &str) -> Result<VaultKeys, Error> {
    let vault_id = vault_id
        .parse::<VaultId>()
        .map_err(|error| Error::Incompatible(error.to_string()))?;
    Ok(VaultKeys::derive(secret, vault_id))
}

pub fn new_device_signer() -> Result<SignerKey, Error> {
    SignerKey::generate().map_err(|error| Error::Incompatible(error.to_string()))
}

pub fn open_manifest(
    blob: &[u8],
    server_seq: u64,
    keys: &VaultKeys,
    highest_manifest_seq: Option<u64>,
) -> Result<Manifest, Error> {
    manifest::open_manifest(blob, server_seq, keys, highest_manifest_seq)
        .map_err(|error| Error::Integrity(error.to_string()))
}

pub fn seal_manifest(manifest: &Manifest, keys: &VaultKeys) -> Result<Vec<u8>, Error> {
    manifest::seal_manifest(manifest, keys).map_err(|error| Error::Integrity(error.to_string()))
}

pub fn seal_chunk(
    draft: &ChunkDraft,
    signer: &SignerKey,
    keys: &VaultKeys,
) -> Result<(ChunkId, Vec<u8>), Error> {
    let sealed = chunk::seal_chunk(draft, signer, &keys.public().vault_pk)
        .map_err(|error| Error::Integrity(error.to_string()))?;
    Ok((sealed.chunk_id, sealed.blob))
}

/// Decode and authenticate an API batch before callers see any rows. Cursor
/// and provenance changes must be committed only after this function succeeds.
pub fn verify_batch(
    bytes: &[u8],
    after_cursor: u64,
    compacted_through_seq: u64,
    keys: &VaultKeys,
    manifest: &Manifest,
    own_source_id: SourceId,
    source_sequences: &mut HashMap<String, u64>,
) -> Result<VerifiedBatch, Error> {
    let frames = batch::decode(bytes).map_err(|error| Error::Integrity(error.to_string()))?;
    let mut chunks = Vec::new();
    let mut server_gaps = Vec::new();
    let mut source_gaps = Vec::new();
    let mut expected_server = after_cursor
        .saturating_add(1)
        .max(compacted_through_seq.saturating_add(1));
    let mut next_cursor = after_cursor.max(compacted_through_seq);

    for frame in frames {
        if frame.seq <= compacted_through_seq {
            next_cursor = next_cursor.max(frame.seq);
            continue;
        }
        if frame.seq > expected_server {
            server_gaps.push((expected_server, frame.seq - 1));
        }
        let opened = chunk::open_chunk(frame.blob, keys.vault_id(), frame.chunk_id, keys, manifest)
            .map_err(|error| Error::Integrity(error.to_string()))?;
        if opened.header.source_id != own_source_id {
            let source = opened.header.source_id.to_string();
            if let Some(previous) = source_sequences.get(&source).copied() {
                if opened.header.source_seq > previous.saturating_add(1) {
                    source_gaps.push((source.clone(), previous + 1, opened.header.source_seq - 1));
                }
            }
            source_sequences
                .entry(source)
                .and_modify(|sequence| *sequence = (*sequence).max(opened.header.source_seq))
                .or_insert(opened.header.source_seq);
            chunks.push((frame.seq, opened));
        }
        next_cursor = frame.seq;
        expected_server = frame.seq.saturating_add(1);
    }

    Ok(VerifiedBatch {
        chunks,
        server_gaps,
        source_gaps,
        next_cursor,
    })
}

/// The receiving side of a key transfer: a one-time key pair whose public
/// half goes to the server and whose fingerprint is shown to the user.
pub struct TransferReceiver {
    key: vrcx_0_nanashi_website_protocol::seal::SealPrivateKey,
}

impl TransferReceiver {
    pub fn new() -> Self {
        Self {
            key: vrcx_0_nanashi_website_protocol::seal::SealPrivateKey::generate(),
        }
    }

    pub fn public_key(&self) -> String {
        vrcx_0_nanashi_website_protocol::b64::encode(self.key.public().as_bytes())
    }

    pub fn display_code(&self, transfer_id: &str) -> Result<String, Error> {
        vrcx_0_nanashi_website_protocol::transfer::display_code(transfer_id, &self.key.public())
            .map_err(|error| Error::Integrity(error.to_string()))
    }

    pub fn open(
        &self,
        account_id: &str,
        transfer_id: &str,
        sealed: &[u8],
    ) -> Result<SyncSecret, Error> {
        let account = account_id
            .parse()
            .map_err(|_| Error::Integrity("invalid account id".into()))?;
        vrcx_0_nanashi_website_protocol::transfer::open_secret(
            &self.key,
            &account,
            transfer_id,
            sealed,
        )
        .map_err(|error| Error::Integrity(error.to_string()))
    }
}

impl Default for TransferReceiver {
    fn default() -> Self {
        Self::new()
    }
}

pub fn transfer_id_from_code(code: &str) -> Result<String, Error> {
    vrcx_0_nanashi_website_protocol::transfer::parse_code(code)
        .map(|(transfer_id, _)| transfer_id)
        .map_err(|error| Error::Integrity(error.to_string()))
}

/// Seals the sync secret for the device that showed `code`. It refuses when
/// the key the server handed over does not match the code the user typed,
/// which is how a server substituting its own key is caught.
pub fn seal_transfer(
    code: &str,
    epk: &str,
    account_id: &str,
    secret: &SyncSecret,
) -> Result<(String, Vec<u8>), Error> {
    use vrcx_0_nanashi_website_protocol::{b64, seal::SealPublicKey, transfer};
    let integrity =
        |error: vrcx_0_nanashi_website_protocol::error::Error| Error::Integrity(error.to_string());
    let (transfer_id, fingerprint) = transfer::parse_code(code).map_err(integrity)?;
    let epk =
        SealPublicKey::from_bytes(&b64::decode(epk).map_err(integrity)?).map_err(integrity)?;
    let account = account_id
        .parse()
        .map_err(|_| Error::Integrity("invalid account id".into()))?;
    let sealed = transfer::seal_secret(&epk, &fingerprint, &account, &transfer_id, secret)
        .map_err(integrity)?;
    Ok((transfer_id, sealed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use vrcx_0_nanashi_website_protocol::{
        chunk::{ChunkBody, ChunkKind, CoveragePeriod},
        ids::SourceId,
        manifest::{Manifest, SignerEntry, SignerKind},
        secret::SyncSecret,
    };

    #[test]
    fn keys_and_recovery_string_use_the_protocol_crate() {
        let secret = generate_sync_secret().unwrap();
        let recovery = recovery_string(&secret);
        assert_eq!(parse_recovery_string(&recovery).unwrap(), secret);
        assert!(parse_own_key("password phrase").is_err());
        assert!(derive_vault_keys(&secret, "bad-vault").is_err());
    }

    #[test]
    fn a_transferred_key_opens_only_for_the_device_that_showed_the_code() {
        let account = "acc_aaaaaaaaaaaaaaaaaaaaaaaaaa";
        let secret = generate_sync_secret().unwrap();
        let receiver = TransferReceiver::new();
        let code = receiver.display_code("ABCDEFGH").unwrap();
        assert_eq!(
            transfer_id_from_code(&code.to_lowercase()).unwrap(),
            "ABCDEFGH"
        );

        let (transfer_id, sealed) =
            seal_transfer(&code, &receiver.public_key(), account, &secret).unwrap();
        assert_eq!(
            receiver.open(account, &transfer_id, &sealed).unwrap(),
            secret
        );
        assert!(TransferReceiver::new()
            .open(account, &transfer_id, &sealed)
            .is_err());
        assert!(receiver
            .open("acc_bbbbbbbbbbbbbbbbbbbbbbbbbb", &transfer_id, &sealed)
            .is_err());

        // A server that swaps in its own key cannot produce a matching code.
        let attacker = TransferReceiver::new();
        assert!(seal_transfer(&code, &attacker.public_key(), account, &secret).is_err());
    }

    #[test]
    fn verified_batch_reports_missing_sequences_and_ignores_own_source() {
        let vault_id = VaultId::random().unwrap();
        let secret = SyncSecret::generate().unwrap();
        let keys = VaultKeys::derive(&secret, vault_id);
        let source = SourceId::random().unwrap();
        let own = SourceId::random().unwrap();
        let signer = SignerKey::generate().unwrap();
        let mut manifest = Manifest::new(vault_id, None);
        manifest.add_signer(SignerEntry::new(
            &signer.public(),
            SignerKind::Device,
            "test",
            0,
        ));
        let draft = ChunkDraft {
            vault_id,
            source_id: source,
            source_seq: 3,
            kind: ChunkKind::Rows,
            created_at_ms: 10,
            app_version: "test".into(),
            coverage: vec![CoveragePeriod {
                start_ms: 1,
                end_ms: 2,
            }],
            dropped_rows: 0,
            body: ChunkBody {
                streams: [("feed_status".into(), vec![json!({"status":"Online"})])]
                    .into_iter()
                    .collect(),
            },
        };
        let (chunk_id, blob) = seal_chunk(&draft, &signer, &keys).unwrap();
        let mut batch_bytes = Vec::new();
        batch::encode_frame(&mut batch_bytes, 4, &chunk_id, &blob).unwrap();
        let mut source_sequences = HashMap::from([(source.to_string(), 1)]);
        let result = verify_batch(
            &batch_bytes,
            2,
            0,
            &keys,
            &manifest,
            own,
            &mut source_sequences,
        )
        .unwrap();
        assert_eq!(result.server_gaps, vec![(3, 3)]);
        assert_eq!(result.source_gaps, vec![(source.to_string(), 2, 2)]);
        assert_eq!(result.chunks.len(), 1);
        assert_eq!(result.next_cursor, 4);
    }
}
