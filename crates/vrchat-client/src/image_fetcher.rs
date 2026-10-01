use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use crate::cookies::CookieJar;
use crate::web_client::{build_vrcx_user_agent, contact_user_agent};
use bytes::Bytes;
use reqwest::Client;
use vrcx_0_core::proxy::with_remote_dns;
use vrcx_0_core::vrchat_endpoints::{
    VRCHAT_API_HOST, VRCHAT_ASSETS_HOST, VRCHAT_FILES_HOST, VRCHAT_LEGACY_CLOUDFRONT_HOST,
};
use vrcx_0_http_client::{Policy as HttpPolicy, RequestBuilderExt};

pub type Result<T> = std::result::Result<T, ImageFetchError>;

#[derive(Debug, thiserror::Error)]
pub enum ImageFetchError {
    #[error("{0}")]
    Custom(String),
}

impl vrcx_0_contracts::ApplicationErrorSource for ImageFetchError {
    fn into_application_error(self) -> vrcx_0_contracts::ApplicationErrorPayload {
        match self {
            Self::Custom(message) => vrcx_0_contracts::ApplicationErrorPayload::Custom(message),
        }
    }
}

pub struct ImageFetcher {
    client: Client,
    proxy_configured: bool,
    allowed_hosts: Mutex<HashSet<String>>,
    /// Sent to VRChat's image hosts in place of the client's plain one.
    contact_user_agent: String,
}

impl ImageFetcher {
    pub fn new(
        cookie_jar: Arc<CookieJar>,
        proxy_url: Option<&str>,
        app_version: &str,
    ) -> Result<Self> {
        let user_agent = build_vrcx_user_agent(app_version);
        let contact_user_agent = contact_user_agent(&user_agent);
        vrcx_0_core::tls::install_crypto_provider();
        let mut builder = vrcx_0_http_client::builder()
            .cookie_provider(cookie_jar)
            .user_agent(user_agent)
            .pool_max_idle_per_host(10)
            .tcp_keepalive(std::time::Duration::from_secs(60))
            .connect_timeout(std::time::Duration::from_secs(10))
            .read_timeout(std::time::Duration::from_secs(30));

        if let Some(proxy) = proxy_url {
            builder = builder.proxy(
                reqwest::Proxy::all(with_remote_dns(proxy).as_ref())
                    .map_err(|e| ImageFetchError::Custom(format!("image cache proxy: {e}")))?,
            );
        }

        let client = builder
            .build()
            .map_err(|e| ImageFetchError::Custom(format!("image cache http client: {e}")))?;

        let mut hosts = HashSet::new();
        hosts.insert(VRCHAT_API_HOST.into());
        hosts.insert(VRCHAT_FILES_HOST.into());
        hosts.insert(VRCHAT_LEGACY_CLOUDFRONT_HOST.into());
        hosts.insert(VRCHAT_ASSETS_HOST.into());

        Ok(Self {
            client,
            proxy_configured: proxy_url.is_some(),
            allowed_hosts: Mutex::new(hosts),
            contact_user_agent,
        })
    }

    pub async fn fetch_image(&self, url: &str) -> Result<Bytes> {
        let parsed = validate_image_url(url, &self.allowed_hosts.lock().unwrap())?;

        let mut request = self.client.get(parsed.clone());
        if parsed.host_str().is_some_and(is_vrchat_image_host) {
            request = request.header(reqwest::header::USER_AGENT, &self.contact_user_agent);
        }
        let response = request
            .send_with_policy(HttpPolicy::sensitive(self.proxy_configured))
            .await
            .map_err(|e| ImageFetchError::Custom(format!("image fetch: {e}")))?;

        if !response.status().is_success() {
            return Err(ImageFetchError::Custom(format!(
                "image fetch status: {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| ImageFetchError::Custom(format!("image read: {e}")))?;

        Ok(bytes)
    }
}

/// VRChat's domains, plus the legacy CloudFront host VRChat still serves
/// images from.
fn is_vrchat_image_host(host: &str) -> bool {
    vrcx_0_core::user_agent::is_vrchat_host(host)
        || host.eq_ignore_ascii_case(VRCHAT_LEGACY_CLOUDFRONT_HOST)
}

fn validate_image_url(url: &str, allowed_hosts: &HashSet<String>) -> Result<reqwest::Url> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|e| ImageFetchError::Custom(format!("invalid image url: {e}")))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| ImageFetchError::Custom("image url has no host".into()))?;
    if !allowed_hosts.contains(host) {
        return Err(ImageFetchError::Custom(format!(
            "invalid image host: {host}"
        )));
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn original_vrcx_hosts() -> HashSet<String> {
        [
            VRCHAT_API_HOST,
            VRCHAT_FILES_HOST,
            VRCHAT_LEGACY_CLOUDFRONT_HOST,
            VRCHAT_ASSETS_HOST,
        ]
        .into_iter()
        .map(str::to_string)
        .collect()
    }

    fn local_fetcher(client: Client) -> ImageFetcher {
        ImageFetcher {
            client,
            proxy_configured: false,
            allowed_hosts: Mutex::new(HashSet::from(["127.0.0.1".into()])),
            contact_user_agent: String::new(),
        }
    }

    async fn serve_once(
        status: &str,
        body: &str,
        delay: Duration,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let task = tokio::spawn(async move {
            tokio::time::timeout(Duration::from_secs(5), async {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0_u8; 1024];
                let _ = socket.read(&mut request).await;
                tokio::time::sleep(delay).await;
                let _ = socket.write_all(response.as_bytes()).await;
            })
            .await
            .expect("image test server did not finish within five seconds");
        });
        (format!("http://{address}/image.png"), task)
    }

    #[test]
    fn image_url_policy_accepts_the_original_exact_host_allowlist() {
        let hosts = original_vrcx_hosts();

        for host in &hosts {
            let url = format!("https://{host}/image/file_1/1/256");
            assert_eq!(
                validate_image_url(&url, &hosts).unwrap().host_str(),
                Some(host.as_str())
            );
        }
    }

    #[test]
    fn image_url_policy_rejects_deceptive_or_unknown_hosts() {
        let hosts = original_vrcx_hosts();

        for url in [
            "https://api.vrchat.cloud.evil.example/image.png",
            "https://api.vrchat.cloud@evil.example/image.png",
            "https://vrchat.cloud/image.png",
            "https://127.0.0.1/image.png",
        ] {
            assert!(validate_image_url(url, &hosts).is_err(), "{url}");
        }
    }

    #[test]
    fn image_url_policy_rejects_invalid_and_hostless_urls() {
        let hosts = original_vrcx_hosts();

        assert!(validate_image_url("not a url", &hosts).is_err());
        assert!(validate_image_url("file:///tmp/image.png", &hosts).is_err());
    }

    #[tokio::test]
    async fn image_fetcher_returns_success_bodies_and_rejects_error_statuses() {
        vrcx_0_core::tls::install_crypto_provider();
        let fetcher = local_fetcher(Client::builder().no_proxy().build().unwrap());
        let (ok_url, ok_server) = serve_once("200 OK", "image-bytes", Duration::ZERO).await;
        assert_eq!(
            fetcher.fetch_image(&ok_url).await.unwrap().as_ref(),
            b"image-bytes"
        );
        ok_server.await.unwrap();

        let (error_url, error_server) =
            serve_once("503 Service Unavailable", "unavailable", Duration::ZERO).await;
        let error = fetcher.fetch_image(&error_url).await.unwrap_err();
        assert!(error.to_string().contains("image fetch status: 503"));
        error_server.await.unwrap();
    }

    #[tokio::test]
    async fn image_fetcher_honors_the_configured_read_timeout() {
        vrcx_0_core::tls::install_crypto_provider();
        let client = Client::builder()
            .no_proxy()
            .read_timeout(Duration::from_millis(20))
            .build()
            .unwrap();
        let fetcher = local_fetcher(client);
        let (url, server) = serve_once("200 OK", "late", Duration::from_millis(200)).await;

        let result = tokio::time::timeout(Duration::from_secs(2), fetcher.fetch_image(&url)).await;
        server.abort();
        let _ = server.await;
        let error = result
            .expect("configured read timeout did not fire")
            .unwrap_err();
        assert!(error.to_string().contains("image fetch:"));
    }

    #[test]
    fn contact_user_agent_goes_to_vrchat_image_hosts_only() {
        for host in [
            VRCHAT_API_HOST,
            VRCHAT_FILES_HOST,
            VRCHAT_ASSETS_HOST,
            VRCHAT_LEGACY_CLOUDFRONT_HOST,
        ] {
            assert!(is_vrchat_image_host(host), "{host}");
        }
        assert!(!is_vrchat_image_host("127.0.0.1"));
        assert!(!is_vrchat_image_host("example.test"));
    }
}
