use std::sync::OnceLock;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, Generate, KeyInit},
    XChaCha20Poly1305, XNonce,
};

const ENCRYPTED_PREFIX: &str = "enc1:";
const MACHINE_SLOT_SEPARATOR: &str = ",";
const MAX_MACHINE_SLOTS: usize = 4;
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;
pub const CLEANUP_COMPLETED_CONFIG_KEY: &str = "secretsAtRestCleanupCompletedV1";

struct SecretsAtRest {
    key: Option<[u8; 32]>,
    encrypt_writes: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SealedSecret {
    pub stored: String,
    pub encrypted: bool,
}

impl SealedSecret {
    fn plaintext(plaintext: &str) -> Self {
        Self {
            stored: plaintext.to_string(),
            encrypted: false,
        }
    }
}

static SECRETS: OnceLock<SecretsAtRest> = OnceLock::new();

fn seal_with_nonce(key: &[u8; 32], nonce: &XNonce, plaintext: &str) -> Option<String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).ok()?;
    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).ok()?;
    let mut payload = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    payload.extend_from_slice(nonce.as_ref());
    payload.extend_from_slice(&ciphertext);
    Some(format!("{ENCRYPTED_PREFIX}{}", STANDARD.encode(payload)))
}

fn try_seal_with(key: &[u8; 32], plaintext: &str) -> Option<String> {
    let nonce = XNonce::try_generate().ok()?;
    seal_with_nonce(key, &nonce, plaintext)
}

fn decode_slot(encoded: &str) -> Option<Vec<u8>> {
    let payload = STANDARD.decode(encoded).ok()?;
    (payload.len() >= NONCE_LEN + TAG_LEN).then_some(payload)
}

fn sealed_slots(stored: &str) -> Option<Vec<&str>> {
    let encoded = stored.strip_prefix(ENCRYPTED_PREFIX)?;
    let slots: Vec<&str> = encoded.split(MACHINE_SLOT_SEPARATOR).collect();
    slots
        .iter()
        .all(|slot| decode_slot(slot).is_some())
        .then_some(slots)
}

fn open_slot(key: &[u8; 32], encoded: &str) -> Option<String> {
    let payload = decode_slot(encoded)?;
    let (nonce, ciphertext) = payload.split_at(NONCE_LEN);
    let nonce = XNonce::try_from(nonce).ok()?;
    let cipher = XChaCha20Poly1305::new_from_slice(key).ok()?;
    let plaintext = cipher.decrypt(&nonce, ciphertext).ok()?;
    String::from_utf8(plaintext).ok()
}

fn open_with(key: Option<&[u8; 32]>, stored: &str) -> Option<String> {
    if !stored.starts_with(ENCRYPTED_PREFIX) {
        return Some(stored.to_string());
    }
    let key = key?;
    sealed_slots(stored)?
        .into_iter()
        .find_map(|slot| open_slot(key, slot))
}

fn other_machine_slots<'a>(key: &[u8; 32], previous: Option<&'a str>) -> Vec<&'a str> {
    previous
        .and_then(sealed_slots)
        .unwrap_or_default()
        .into_iter()
        .filter(|slot| open_slot(key, slot).is_none())
        .take(MAX_MACHINE_SLOTS - 1)
        .collect()
}

fn seal_keeping_other_machines(
    key: &[u8; 32],
    previous: Option<&str>,
    plaintext: &str,
) -> Option<String> {
    let mut stored = try_seal_with(key, plaintext)?;
    for slot in other_machine_slots(key, previous) {
        stored.push_str(MACHINE_SLOT_SEPARATOR);
        stored.push_str(slot);
    }
    Some(stored)
}

fn promote_own_slot_with(key: &[u8; 32], stored: &str) -> Option<String> {
    let mut slots = sealed_slots(stored)?;
    let own = slots
        .iter()
        .position(|slot| open_slot(key, slot).is_some())?;
    if own == 0 {
        return None;
    }
    let own_slot = slots.remove(own);
    slots.insert(0, own_slot);
    Some(format!(
        "{ENCRYPTED_PREFIX}{}",
        slots.join(MACHINE_SLOT_SEPARATOR)
    ))
}

fn is_other_machine_secret_with(key: Option<&[u8; 32]>, stored: &str) -> bool {
    let Some(slots) = sealed_slots(stored) else {
        return false;
    };
    key.is_none_or(|key| slots.iter().all(|slot| open_slot(key, slot).is_none()))
}

fn seal_with_state(
    state: Option<&SecretsAtRest>,
    previous: Option<&str>,
    plaintext: &str,
) -> SealedSecret {
    let Some(state) = state else {
        return SealedSecret::plaintext(plaintext);
    };
    if !state.encrypt_writes {
        return SealedSecret::plaintext(plaintext);
    }
    let Some(key) = state.key.as_ref() else {
        return SealedSecret::plaintext(plaintext);
    };
    match seal_keeping_other_machines(key, previous, plaintext) {
        Some(sealed) => SealedSecret {
            stored: sealed,
            encrypted: true,
        },
        None => {
            tracing::warn!("failed to encrypt a stored secret; falling back to plaintext");
            SealedSecret::plaintext(plaintext)
        }
    }
}

fn open_with_state(state: Option<&SecretsAtRest>, stored: &str) -> Option<String> {
    let Some(state) = state else {
        return Some(stored.to_string());
    };
    open_with(state.key.as_ref(), stored)
}

pub fn init_secrets(key: Option<[u8; 32]>, encrypt_writes: bool) {
    if SECRETS
        .set(SecretsAtRest {
            key,
            encrypt_writes,
        })
        .is_err()
    {
        tracing::warn!("secrets-at-rest state was already initialized; ignoring duplicate init");
    }
}

pub fn seal_secret(plaintext: &str) -> String {
    seal_secret_with_status(None, plaintext).stored
}

pub fn seal_secret_with_status(previous: Option<&str>, plaintext: &str) -> SealedSecret {
    seal_with_state(SECRETS.get(), previous, plaintext)
}

pub fn open_secret(stored: &str) -> Option<String> {
    open_with_state(SECRETS.get(), stored)
}

pub fn is_sealed_secret(stored: &str) -> bool {
    stored.starts_with(ENCRYPTED_PREFIX)
}

pub fn promote_own_slot(stored: &str) -> Option<String> {
    let key = SECRETS.get()?.key.as_ref()?;
    promote_own_slot_with(key, stored)
}

pub fn is_other_machine_secret(stored: &str) -> bool {
    SECRETS
        .get()
        .is_some_and(|state| is_other_machine_secret_with(state.key.as_ref(), stored))
}

pub fn is_encrypting_writes() -> bool {
    SECRETS
        .get()
        .is_some_and(|state| state.encrypt_writes && state.key.is_some())
}

pub fn is_initialized() -> bool {
    SECRETS.get().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; 32] = [7; 32];
    const OTHER_KEY: [u8; 32] = [9; 32];

    #[test]
    fn cipher_roundtrip_rejects_wrong_keys_and_damage() {
        let sealed = try_seal_with(&KEY, "secret-value").unwrap();
        assert!(sealed.starts_with("enc1:"));
        assert_eq!(
            open_with(Some(&KEY), &sealed).as_deref(),
            Some("secret-value")
        );
        assert_eq!(open_with(Some(&OTHER_KEY), &sealed), None);
        assert_eq!(open_with(None, &sealed), None);
        assert_eq!(open_with(Some(&KEY), "enc1:broken"), None);
        assert_eq!(
            open_with(Some(&KEY), "plain-value").as_deref(),
            Some("plain-value")
        );
    }

    #[test]
    fn cipher_storage_format_matches_the_v1_golden_vector() {
        let nonce_bytes = std::array::from_fn(|index| index as u8);
        let nonce = XNonce::from(nonce_bytes);
        let sealed = seal_with_nonce(&KEY, &nonce, "secret-value").unwrap();

        assert_eq!(
            sealed,
            "enc1:AAECAwQFBgcICQoLDA0ODxAREhMUFRYX23LI959odtNEq/QiQ/C2yr8LrhAlISSgLCWQcQ=="
        );
        assert_eq!(
            open_with(Some(&KEY), &sealed).as_deref(),
            Some("secret-value")
        );
    }

    #[test]
    fn state_controls_reads_and_writes_without_global_initialization() {
        let disabled = SecretsAtRest {
            key: Some(KEY),
            encrypt_writes: false,
        };
        let missing_key = SecretsAtRest {
            key: None,
            encrypt_writes: true,
        };
        let enabled = SecretsAtRest {
            key: Some(KEY),
            encrypt_writes: true,
        };

        assert_eq!(
            seal_with_state(None, None, "plain"),
            SealedSecret::plaintext("plain")
        );
        assert_eq!(
            open_with_state(None, "enc1:not-decoded").as_deref(),
            Some("enc1:not-decoded")
        );
        assert_eq!(
            seal_with_state(Some(&disabled), None, "plain"),
            SealedSecret::plaintext("plain")
        );
        assert_eq!(
            seal_with_state(Some(&missing_key), None, "plain"),
            SealedSecret::plaintext("plain")
        );

        let SealedSecret {
            stored: sealed,
            encrypted,
        } = seal_with_state(Some(&enabled), None, "plain");
        assert!(encrypted);
        assert!(is_sealed_secret(&sealed));
        assert_eq!(
            open_with_state(Some(&enabled), &sealed).as_deref(),
            Some("plain")
        );
        assert_eq!(
            open_with_state(Some(&disabled), &sealed).as_deref(),
            Some("plain")
        );
        assert_eq!(open_with_state(Some(&missing_key), &sealed), None);
    }

    fn slot_count(stored: &str) -> usize {
        sealed_slots(stored).map_or(0, |slots| slots.len())
    }

    #[test]
    fn resealing_keeps_other_machine_slots_and_replaces_its_own() {
        let windows = try_seal_with(&KEY, "windows-cookie").unwrap();

        let both = seal_keeping_other_machines(&OTHER_KEY, Some(&windows), "linux-cookie").unwrap();
        assert_eq!(slot_count(&both), 2);
        assert!(both.starts_with("enc1:"));
        assert_eq!(
            open_with(Some(&KEY), &both).as_deref(),
            Some("windows-cookie")
        );
        assert_eq!(
            open_with(Some(&OTHER_KEY), &both).as_deref(),
            Some("linux-cookie")
        );

        let refreshed = seal_keeping_other_machines(&KEY, Some(&both), "windows-cookie-2").unwrap();
        assert_eq!(slot_count(&refreshed), 2);
        assert_eq!(
            open_with(Some(&KEY), &refreshed).as_deref(),
            Some("windows-cookie-2")
        );
        assert_eq!(
            open_with(Some(&OTHER_KEY), &refreshed).as_deref(),
            Some("linux-cookie")
        );

        let only_own =
            seal_keeping_other_machines(&KEY, Some(&windows), "windows-cookie-3").unwrap();
        assert_eq!(slot_count(&only_own), 1);
    }

    #[test]
    fn resealing_caps_machine_slots_by_dropping_the_least_recent() {
        let keys: Vec<[u8; 32]> = (1..=6).map(|byte| [byte; 32]).collect();
        let mut stored: Option<String> = None;
        for (index, key) in keys.iter().enumerate() {
            stored = Some(
                seal_keeping_other_machines(key, stored.as_deref(), &format!("cookie-{index}"))
                    .unwrap(),
            );
        }
        let stored = stored.unwrap();

        assert_eq!(slot_count(&stored), MAX_MACHINE_SLOTS);
        assert_eq!(
            open_with(Some(&keys[5]), &stored).as_deref(),
            Some("cookie-5")
        );
        assert_eq!(
            open_with(Some(&keys[2]), &stored).as_deref(),
            Some("cookie-2")
        );
        assert_eq!(open_with(Some(&keys[1]), &stored), None);
        assert_eq!(open_with(Some(&keys[0]), &stored), None);
    }

    #[test]
    fn promoting_moves_the_used_slot_first_without_resealing() {
        let windows = try_seal_with(&KEY, "windows-cookie").unwrap();
        let linux_first =
            seal_keeping_other_machines(&OTHER_KEY, Some(&windows), "linux-cookie").unwrap();
        let windows_slot = windows.strip_prefix(ENCRYPTED_PREFIX).unwrap();

        let promoted = promote_own_slot_with(&KEY, &linux_first).unwrap();
        assert_eq!(slot_count(&promoted), 2);
        assert!(promoted.starts_with(&format!("{ENCRYPTED_PREFIX}{windows_slot},")));
        assert_eq!(
            open_with(Some(&OTHER_KEY), &promoted).as_deref(),
            Some("linux-cookie")
        );

        assert_eq!(promote_own_slot_with(&KEY, &promoted), None);
        assert_eq!(promote_own_slot_with(&KEY, &windows), None);
        assert_eq!(promote_own_slot_with(&[1; 32], &linux_first), None);
        assert_eq!(promote_own_slot_with(&KEY, "plain-value"), None);
    }

    #[test]
    fn resealing_after_promotion_evicts_the_least_recently_used_machine() {
        let keys: Vec<[u8; 32]> = (1..=5).map(|byte| [byte; 32]).collect();
        let mut stored = String::new();
        for (index, key) in keys.iter().take(4).enumerate() {
            stored = seal_keeping_other_machines(key, Some(&stored), &format!("cookie-{index}"))
                .unwrap();
        }
        stored = promote_own_slot_with(&keys[0], &stored).unwrap();

        let stored = seal_keeping_other_machines(&keys[4], Some(&stored), "cookie-4").unwrap();

        assert_eq!(slot_count(&stored), MAX_MACHINE_SLOTS);
        assert_eq!(
            open_with(Some(&keys[0]), &stored).as_deref(),
            Some("cookie-0")
        );
        assert_eq!(open_with(Some(&keys[1]), &stored), None);
    }

    #[test]
    fn damaged_or_plaintext_previous_values_are_not_kept_as_machine_slots() {
        let windows = try_seal_with(&KEY, "windows-cookie").unwrap();
        for previous in [
            "plain-value".to_string(),
            "enc1:broken".to_string(),
            format!("{windows}A"),
            format!("{windows},broken"),
        ] {
            let sealed =
                seal_keeping_other_machines(&OTHER_KEY, Some(&previous), "linux-cookie").unwrap();
            assert_eq!(slot_count(&sealed), 1, "{previous}");
            assert!(!is_other_machine_secret_with(Some(&OTHER_KEY), &previous));
        }
    }

    #[test]
    fn other_machine_secrets_are_intact_values_this_key_cannot_open() {
        let windows = try_seal_with(&KEY, "windows-cookie").unwrap();
        let both = seal_keeping_other_machines(&OTHER_KEY, Some(&windows), "linux-cookie").unwrap();

        assert!(is_other_machine_secret_with(Some(&OTHER_KEY), &windows));
        assert!(is_other_machine_secret_with(None, &windows));
        assert!(!is_other_machine_secret_with(Some(&KEY), &windows));
        assert!(!is_other_machine_secret_with(Some(&KEY), &both));
        assert!(!is_other_machine_secret_with(Some(&OTHER_KEY), &both));
    }
}
