use std::time::Duration;

use async_trait::async_trait;

use crate::Error;

pub const PROXY_STORAGE_KEY: &str = "VRCX_ProxyServer";
pub const PROXY_ENABLED_STORAGE_KEY: &str = "VRCX_ProxyEnabled";
const PROXY_TEST_TIMEOUT: Duration = Duration::from_secs(10);

fn proxy_authority(candidate: &str) -> &str {
    let value = candidate
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(candidate);
    value
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(value)
        .rsplit_once('@')
        .map(|(_, authority)| authority)
        .unwrap_or(value)
}

fn explicit_proxy_port(authority: &str) -> Option<&str> {
    if let Some(rest) = authority.strip_prefix('[') {
        let (_, after_host) = rest.split_once(']')?;
        let port = after_host.strip_prefix(':')?;
        return (!port.is_empty() && port.chars().all(|ch| ch.is_ascii_digit())).then_some(port);
    }

    let (_, port) = authority.rsplit_once(':')?;
    (!port.is_empty() && port.chars().all(|ch| ch.is_ascii_digit())).then_some(port)
}

fn normalize_proxy_url(value: &str) -> Result<Option<String>, Error> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let explicit_port = explicit_proxy_port(proxy_authority(&candidate));
    let url = url::Url::parse(&candidate)
        .map_err(|error| Error::Custom(format!("Invalid proxy URL: {error}")))?;

    let scheme = url.scheme();
    if scheme != "http" && scheme != "socks5" {
        return Err(Error::Custom(format!("Unsupported proxy scheme: {scheme}")));
    }

    url.host()
        .ok_or_else(|| Error::Custom("Proxy URL is missing a host".into()))?;
    if url.port().is_none() {
        if explicit_port.is_some() {
            return Err(Error::Custom(format!(
                "{scheme} proxy URLs using the default port are not supported by the WebView proxy"
            )));
        }
        return Err(Error::Custom("Proxy URL is missing a port".into()));
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(Error::Custom(
            "Proxy URL credentials are not supported".into(),
        ));
    }
    if (!url.path().is_empty() && url.path() != "/")
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::Custom(
            "Proxy URL must only contain scheme, host, and port".into(),
        ));
    }

    let normalized = url.to_string();
    Ok(Some(normalized.trim_end_matches('/').to_string()))
}

fn parse_enabled_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "true" | "1" | "yes" | "on"
    )
}

fn resolve_proxy_enabled(raw_enabled: Option<&str>, raw_proxy_url: &str) -> bool {
    raw_enabled
        .map(parse_enabled_value)
        .unwrap_or_else(|| !raw_proxy_url.trim().is_empty())
}

fn resolve_proxy_url(
    raw_enabled: Option<&str>,
    raw_proxy_url: &str,
) -> Result<Option<String>, Error> {
    if !resolve_proxy_enabled(raw_enabled, raw_proxy_url) {
        return Ok(None);
    }
    normalize_proxy_url(raw_proxy_url)
}

pub fn load_proxy_url(raw_enabled: Option<&str>, raw_proxy_url: &str) -> Option<String> {
    match resolve_proxy_url(raw_enabled, raw_proxy_url) {
        Ok(proxy_url) => proxy_url,
        Err(error) => {
            tracing::warn!(
                error = %error,
                "invalid proxy setting; using direct connection"
            );
            None
        }
    }
}

#[async_trait]
pub trait ProxyConnectivityPort: Send + Sync {
    async fn execute(
        &self,
        normalized_proxy: Option<String>,
        app_version: &str,
    ) -> Result<(i32, String), Error>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProxySettingsTestResult {
    pub normalized_proxy: Option<String>,
    pub status: i32,
}

pub async fn test_proxy_connectivity(
    port: &dyn ProxyConnectivityPort,
    proxy_url: &str,
    app_version: &str,
) -> Result<ProxySettingsTestResult, Error> {
    let normalized_proxy = normalize_proxy_url(proxy_url)?;
    let (status, data) = tokio::time::timeout(
        PROXY_TEST_TIMEOUT,
        port.execute(normalized_proxy.clone(), app_version),
    )
    .await
    .map_err(|_| Error::Custom("Proxy test timed out.".into()))??;
    if status == -1 {
        return Err(Error::Custom(data));
    }
    if !(200..400).contains(&status) {
        return Err(Error::Custom(format!("Proxy test returned HTTP {status}.")));
    }
    Ok(ProxySettingsTestResult {
        normalized_proxy,
        status,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_proxy_url_uses_legacy_non_empty_address_when_enabled_key_is_missing() {
        assert_eq!(
            load_proxy_url(None, "127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
    }

    #[test]
    fn load_proxy_url_uses_direct_when_enabled_key_is_missing_and_address_is_empty() {
        assert_eq!(load_proxy_url(None, ""), None);
    }

    #[test]
    fn load_proxy_url_uses_direct_when_proxy_is_disabled_even_with_address() {
        assert_eq!(load_proxy_url(Some("false"), "127.0.0.1:7890"), None);
    }

    #[test]
    fn load_proxy_url_uses_direct_when_proxy_enabled_but_address_empty() {
        assert_eq!(load_proxy_url(Some("true"), ""), None);
    }

    #[test]
    fn load_proxy_url_falls_back_to_direct_for_invalid_address() {
        assert_eq!(load_proxy_url(Some("true"), "https://127.0.0.1:7890"), None);
    }
}
