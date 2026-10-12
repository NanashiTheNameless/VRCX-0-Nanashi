use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;
use vrcx_0_logger_protocol::envelope::{
    open_response, seal_request, SecretKey, PROTOCOL_HEADER, TIMESTAMP_HEADER,
};
use vrcx_0_logger_protocol::wire::{
    ErrorResponse, HelloResponse, PresenceRequest, PresenceResponse, PROTOCOL_VERSION,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, thiserror::Error)]
pub enum FeedLoggerClientError {
    #[error("invalid logger address: {0}")]
    InvalidAddress(String),
    #[error("logger password: {0}")]
    Password(String),
    #[error("logger is unreachable: {0}")]
    Transport(String),
    #[error("logger rejected the password or the request")]
    Unauthorized,
    #[error("logger requires a newer VRCX-0")]
    ClientTooOld,
    #[error("{0}")]
    Rejected(String),
    #[error("logger response could not be read: {0}")]
    Malformed(String),
}

pub struct FeedLoggerClient {
    http: Client,
    base_url: String,
    key: SecretKey,
    clock_offset_ms: AtomicI64,
}

impl FeedLoggerClient {
    pub fn new(address: &str, password: &str) -> Result<Self, FeedLoggerClientError> {
        let base_url = normalize_address(address)?;
        let key = SecretKey::transport(password)
            .map_err(|error| FeedLoggerClientError::Password(error.to_string()))?;
        let http = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(transport_error)?;
        Ok(Self {
            http,
            base_url,
            key,
            clock_offset_ms: AtomicI64::new(0),
        })
    }

    pub async fn hello(&self) -> Result<HelloResponse, FeedLoggerClientError> {
        let sent_at = now_ms();
        let response = self
            .http
            .get(format!("{}/hello", self.base_url))
            .send()
            .await
            .map_err(transport_error)?;
        if !response.status().is_success() {
            return Err(FeedLoggerClientError::Transport(format!(
                "hello returned {}",
                response.status()
            )));
        }
        let hello: HelloResponse = response
            .json()
            .await
            .map_err(|error| malformed(error.without_url()))?;
        self.calibrate(sent_at, now_ms(), hello.server_time.saturating_mul(1000));
        Ok(hello)
    }

    pub async fn presence(
        &self,
        request: &PresenceRequest,
    ) -> Result<PresenceResponse, FeedLoggerClientError> {
        let sent_at = now_ms();
        let response: PresenceResponse = self.call("/presence", request).await?;
        self.calibrate(sent_at, now_ms(), response.server_time_ms);
        Ok(response)
    }

    pub fn clock_offset_ms(&self) -> i64 {
        self.clock_offset_ms.load(Ordering::Relaxed)
    }

    fn calibrate(&self, sent_at_ms: i64, received_at_ms: i64, server_time_ms: i64) {
        let local_midpoint =
            sent_at_ms.saturating_add(received_at_ms.saturating_sub(sent_at_ms) / 2);
        self.clock_offset_ms.store(
            server_time_ms.saturating_sub(local_midpoint),
            Ordering::Relaxed,
        );
    }

    pub async fn call<Request, Response>(
        &self,
        path: &str,
        request: &Request,
    ) -> Result<Response, FeedLoggerClientError>
    where
        Request: Serialize + ?Sized,
        Response: DeserializeOwned,
    {
        let plaintext = serde_json::to_vec(request).map_err(malformed)?;
        let timestamp = now_ms()
            .saturating_add(self.clock_offset_ms())
            .div_euclid(1000);
        let (body, nonce) =
            seal_request(&self.key, "POST", path, timestamp, &plaintext).map_err(malformed)?;
        let response = self
            .http
            .post(format!("{}{path}", self.base_url))
            .header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string())
            .header(TIMESTAMP_HEADER, timestamp.to_string())
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(body)
            .send()
            .await
            .map_err(transport_error)?;
        let status = response.status();
        match status {
            StatusCode::UNAUTHORIZED => return Err(FeedLoggerClientError::Unauthorized),
            StatusCode::UPGRADE_REQUIRED => return Err(FeedLoggerClientError::ClientTooOld),
            _ => {}
        }
        let bytes = response.bytes().await.map_err(transport_error)?;
        let plaintext = open_response(&self.key, &nonce, &bytes)
            .map_err(|_| FeedLoggerClientError::Malformed(format!("unsealed {status} response")))?;
        if status.is_success() {
            return serde_json::from_slice(&plaintext).map_err(malformed);
        }
        let error: ErrorResponse = serde_json::from_slice(&plaintext).map_err(malformed)?;
        Err(FeedLoggerClientError::Rejected(error.message))
    }
}

fn normalize_address(address: &str) -> Result<String, FeedLoggerClientError> {
    let trimmed = address.trim().trim_end_matches('/');
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let url = reqwest::Url::parse(&with_scheme)
        .map_err(|error| FeedLoggerClientError::InvalidAddress(error.to_string()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(FeedLoggerClientError::InvalidAddress(
            "use http:// or https:// with a host".into(),
        ));
    }
    Ok(with_scheme)
}

fn transport_error(error: reqwest::Error) -> FeedLoggerClientError {
    FeedLoggerClientError::Transport(error.without_url().to_string())
}

fn malformed(error: impl std::fmt::Display) -> FeedLoggerClientError {
    FeedLoggerClientError::Malformed(error.to_string())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| {
            i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_recorder_address_given_as_bare_host_and_port_defaults_to_http() {
        assert_eq!(
            normalize_address(" 192.168.1.10:8787/ ").unwrap(),
            "http://192.168.1.10:8787"
        );
    }

    #[test]
    fn a_recorder_address_with_an_explicit_https_scheme_is_kept() {
        assert_eq!(
            normalize_address("https://logger.example.com").unwrap(),
            "https://logger.example.com"
        );
    }

    #[test]
    fn a_recorder_address_with_a_non_http_scheme_is_rejected() {
        for address in ["ftp://logger", "ws://logger:8787"] {
            assert!(matches!(
                normalize_address(address),
                Err(FeedLoggerClientError::InvalidAddress(_))
            ));
        }
    }

    #[test]
    fn the_recorder_clock_offset_is_measured_from_the_middle_of_the_round_trip() {
        let client = FeedLoggerClient::new("127.0.0.1:8787", "password123").unwrap();

        client.calibrate(1_000, 1_400, 6_200);
        assert_eq!(client.clock_offset_ms(), 5_000);

        client.calibrate(10_000, 10_200, 7_100);
        assert_eq!(client.clock_offset_ms(), -3_000);
    }

    #[test]
    fn an_empty_recorder_address_is_rejected() {
        assert!(matches!(
            normalize_address("  "),
            Err(FeedLoggerClientError::InvalidAddress(_))
        ));
    }
}
