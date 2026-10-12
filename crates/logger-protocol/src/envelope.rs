use std::fmt;

use argon2::Argon2;
use chacha20poly1305::aead::{Aead, Generate, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

pub const NONCE_LEN: usize = 24;
pub const MIN_PASSWORD_CHARS: usize = 8;
pub const TRANSPORT_SALT: &[u8] = b"vrcx0-transport";
pub const MAX_CLOCK_SKEW_SECS: i64 = 300;
pub const TIMESTAMP_HEADER: &str = "x-vrcx0-timestamp";
pub const PROTOCOL_HEADER: &str = "x-vrcx0-protocol";

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum EnvelopeError {
    #[error("password must be at least {MIN_PASSWORD_CHARS} characters")]
    PasswordTooShort,
    #[error("key derivation failed")]
    KeyDerivation,
    #[error("envelope is malformed")]
    Malformed,
    #[error("envelope could not be authenticated")]
    Unauthenticated,
    #[error("request timestamp is outside the accepted window")]
    StaleTimestamp,
    #[error("encryption failed")]
    Encryption,
}

pub type Nonce = [u8; NONCE_LEN];

#[derive(Clone)]
pub struct SecretKey([u8; 32]);

impl fmt::Debug for SecretKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SecretKey(..)")
    }
}

impl SecretKey {
    pub fn derive(password: &str, salt: &[u8]) -> Result<Self, EnvelopeError> {
        if password.chars().count() < MIN_PASSWORD_CHARS {
            return Err(EnvelopeError::PasswordTooShort);
        }
        let mut key = [0u8; 32];
        Argon2::default()
            .hash_password_into(password.as_bytes(), salt, &mut key)
            .map_err(|_| EnvelopeError::KeyDerivation)?;
        Ok(Self(key))
    }

    pub fn transport(password: &str) -> Result<Self, EnvelopeError> {
        Self::derive(password, TRANSPORT_SALT)
    }

    pub fn seal(&self, plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, EnvelopeError> {
        let nonce = XNonce::try_generate().map_err(|_| EnvelopeError::Encryption)?;
        let ciphertext = self
            .cipher()
            .encrypt(
                &nonce,
                Payload {
                    msg: plaintext,
                    aad,
                },
            )
            .map_err(|_| EnvelopeError::Encryption)?;
        let mut sealed = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        sealed.extend_from_slice(nonce.as_ref());
        sealed.extend_from_slice(&ciphertext);
        Ok(sealed)
    }

    pub fn open(&self, sealed: &[u8], aad: &[u8]) -> Result<Vec<u8>, EnvelopeError> {
        let nonce = XNonce::from(nonce_of(sealed)?);
        self.cipher()
            .decrypt(
                &nonce,
                Payload {
                    msg: &sealed[NONCE_LEN..],
                    aad,
                },
            )
            .map_err(|_| EnvelopeError::Unauthenticated)
    }

    fn cipher(&self) -> XChaCha20Poly1305 {
        XChaCha20Poly1305::new(&self.0.into())
    }
}

#[cfg(feature = "server")]
pub struct OpenedRequest {
    pub plaintext: Vec<u8>,
    pub nonce: Nonce,
}

pub fn seal_request(
    key: &SecretKey,
    method: &str,
    path: &str,
    timestamp: i64,
    plaintext: &[u8],
) -> Result<(Vec<u8>, Nonce), EnvelopeError> {
    let sealed = key.seal(plaintext, &request_aad(method, path, timestamp))?;
    let nonce = nonce_of(&sealed)?;
    Ok((sealed, nonce))
}

#[cfg(feature = "server")]
pub fn open_request(
    key: &SecretKey,
    method: &str,
    path: &str,
    timestamp: i64,
    now: i64,
    body: &[u8],
) -> Result<OpenedRequest, EnvelopeError> {
    if now.abs_diff(timestamp) > MAX_CLOCK_SKEW_SECS.unsigned_abs() {
        return Err(EnvelopeError::StaleTimestamp);
    }
    let plaintext = key.open(body, &request_aad(method, path, timestamp))?;
    Ok(OpenedRequest {
        plaintext,
        nonce: nonce_of(body)?,
    })
}

#[cfg(feature = "server")]
pub fn seal_response(
    key: &SecretKey,
    request_nonce: &Nonce,
    plaintext: &[u8],
) -> Result<Vec<u8>, EnvelopeError> {
    key.seal(plaintext, &response_aad(request_nonce))
}

pub fn open_response(
    key: &SecretKey,
    request_nonce: &Nonce,
    body: &[u8],
) -> Result<Vec<u8>, EnvelopeError> {
    key.open(body, &response_aad(request_nonce))
}

fn nonce_of(sealed: &[u8]) -> Result<Nonce, EnvelopeError> {
    sealed
        .get(..NONCE_LEN)
        .and_then(|nonce| Nonce::try_from(nonce).ok())
        .ok_or(EnvelopeError::Malformed)
}

fn request_aad(method: &str, path: &str, timestamp: i64) -> Vec<u8> {
    format!("vrcx0-request\n{method}\n{path}\n{timestamp}").into_bytes()
}

fn response_aad(request_nonce: &Nonce) -> Vec<u8> {
    let mut aad = b"vrcx0-response\n".to_vec();
    aad.extend_from_slice(request_nonce);
    aad
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWORD: &str = "correct horse battery";
    const SENT_AT: i64 = 1_000;

    fn key() -> SecretKey {
        SecretKey::transport(PASSWORD).unwrap()
    }

    fn status_request(key: &SecretKey) -> (Vec<u8>, Nonce) {
        seal_request(key, "POST", "/status", SENT_AT, b"{}").unwrap()
    }

    #[test]
    fn a_password_needs_at_least_eight_characters() {
        assert_eq!(
            SecretKey::transport("パスワード12").unwrap_err(),
            EnvelopeError::PasswordTooShort
        );
        assert!(SecretKey::transport("パスワード123").is_ok());
    }

    #[test]
    fn the_recorder_reads_exactly_what_the_desktop_sealed() {
        let key = key();
        let (body, nonce) = status_request(&key);

        let opened = open_request(&key, "POST", "/status", SENT_AT, SENT_AT, &body).unwrap();

        assert_eq!(opened.plaintext, b"{}");
        assert_eq!(opened.nonce, nonce);
    }

    #[test]
    fn a_desktop_clock_up_to_five_minutes_off_is_accepted() {
        let key = key();
        let (body, _) = status_request(&key);

        for now in [SENT_AT - MAX_CLOCK_SKEW_SECS, SENT_AT + MAX_CLOCK_SKEW_SECS] {
            assert!(open_request(&key, "POST", "/status", SENT_AT, now, &body).is_ok());
        }
    }

    #[test]
    fn a_request_from_a_clock_more_than_five_minutes_off_is_refused() {
        let key = key();
        let (body, _) = status_request(&key);

        for now in [
            SENT_AT - MAX_CLOCK_SKEW_SECS - 1,
            SENT_AT + MAX_CLOCK_SKEW_SECS + 1,
        ] {
            assert_eq!(
                open_request(&key, "POST", "/status", SENT_AT, now, &body).err(),
                Some(EnvelopeError::StaleTimestamp)
            );
        }
    }

    #[test]
    fn an_absurd_timestamp_is_refused_without_overflowing() {
        let key = key();
        let (body, _) = status_request(&key);

        assert_eq!(
            open_request(&key, "POST", "/status", i64::MIN, SENT_AT, &body).err(),
            Some(EnvelopeError::StaleTimestamp)
        );
    }

    #[test]
    fn someone_with_another_password_cannot_open_or_forge_a_request() {
        let (body, _) = status_request(&key());
        let other = SecretKey::transport("another long password").unwrap();
        let (forged, _) = status_request(&other);

        assert_eq!(
            open_request(&other, "POST", "/status", SENT_AT, SENT_AT, &body).err(),
            Some(EnvelopeError::Unauthenticated)
        );
        assert_eq!(
            open_request(&key(), "POST", "/status", SENT_AT, SENT_AT, &forged).err(),
            Some(EnvelopeError::Unauthenticated)
        );
    }

    #[test]
    fn a_request_cannot_be_redirected_to_another_action() {
        let key = key();
        let (body, _) = seal_request(&key, "POST", "/presence", SENT_AT, b"{}").unwrap();

        for (method, path) in [("POST", "/unpair"), ("GET", "/presence")] {
            assert_eq!(
                open_request(&key, method, path, SENT_AT, SENT_AT, &body).err(),
                Some(EnvelopeError::Unauthenticated),
                "{method} {path}"
            );
        }
    }

    #[test]
    fn a_request_cannot_be_moved_to_another_time() {
        let key = key();
        let (body, _) = status_request(&key);

        assert_eq!(
            open_request(&key, "POST", "/status", SENT_AT + 1, SENT_AT, &body).err(),
            Some(EnvelopeError::Unauthenticated)
        );
    }

    #[test]
    fn a_tampered_request_is_refused() {
        let key = key();
        let (mut body, _) = status_request(&key);
        let last = body.len() - 1;
        body[last] ^= 1;

        assert_eq!(
            open_request(&key, "POST", "/status", SENT_AT, SENT_AT, &body).err(),
            Some(EnvelopeError::Unauthenticated)
        );
    }

    #[test]
    fn a_response_only_opens_for_the_request_it_answers() {
        let key = key();
        let (_, answered) = status_request(&key);
        let (_, unrelated) = status_request(&key);
        let response = seal_response(&key, &answered, b"ok").unwrap();

        assert_eq!(open_response(&key, &answered, &response).unwrap(), b"ok");
        assert_eq!(
            open_response(&key, &unrelated, &response).err(),
            Some(EnvelopeError::Unauthenticated)
        );
    }

    #[test]
    fn someone_with_another_password_cannot_read_a_response() {
        let key = key();
        let (_, nonce) = status_request(&key);
        let response = seal_response(&key, &nonce, b"ok").unwrap();
        let other = SecretKey::transport("another long password").unwrap();

        assert_eq!(
            open_response(&other, &nonce, &response).err(),
            Some(EnvelopeError::Unauthenticated)
        );
    }
}
