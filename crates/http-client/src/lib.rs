use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use hyper_util::client::proxy::matcher::Matcher;
use reqwest::{
    header, Client, ClientBuilder, Method, Request, RequestBuilder, Response, Url, Version,
};

const H3_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const H3_CACHE_TTL: Duration = Duration::from_secs(300);
type Probe = Arc<tokio::sync::Mutex<Option<(Instant, bool)>>>;
static H3_SUPPORT: LazyLock<Mutex<HashMap<String, Probe>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Http(#[from] reqwest::Error),
    #[error("{0}")]
    Policy(&'static str),
    #[error("Remote sensitive requests require HTTP/2 or HTTP/3: {0}")]
    SensitiveTransport(#[source] reqwest::Error),
}

#[derive(Clone, Copy)]
pub struct Policy {
    pub sensitive: bool,
    pub explicit_proxy: bool,
    pub max_redirects: usize,
    pub allow_redirect: fn(&Url) -> bool,
}

impl Policy {
    pub fn sensitive(explicit_proxy: bool) -> Self {
        Self {
            sensitive: true,
            explicit_proxy,
            max_redirects: 10,
            allow_redirect: |_| true,
        }
    }

    pub fn public() -> Self {
        Self {
            sensitive: false,
            ..Self::sensitive(false)
        }
    }

    pub fn without_redirects(mut self) -> Self {
        self.max_redirects = 0;
        self
    }
}

pub fn builder() -> ClientBuilder {
    vrcx_0_core::tls::install_crypto_provider();
    Client::builder().redirect(reqwest::redirect::Policy::none())
}

pub trait RequestBuilderExt {
    fn send_with_policy(
        self,
        policy: Policy,
    ) -> impl Future<Output = Result<Response, Error>> + Send;
}

impl RequestBuilderExt for RequestBuilder {
    async fn send_with_policy(self, policy: Policy) -> Result<Response, Error> {
        let (client, request) = self.build_split();
        execute(&client, request?, policy).await
    }
}

pub fn is_local(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => {
            let host = host.trim_end_matches('.');
            host == "localhost" || host.ends_with(".localhost")
        }
        Some(url::Host::Ipv4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Some(url::Host::Ipv6(ip)) => ip.to_ipv4_mapped().map_or_else(
            || ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
            |ip| ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        ),
        None => false,
    }
}

fn is_proxied(url: &Url, explicit_proxy: bool) -> bool {
    explicit_proxy
        || url
            .as_str()
            .parse::<http::Uri>()
            .map_or(true, |uri| Matcher::from_system().intercept(&uri).is_some())
}

async fn supports_h3(url: &Url, explicit_proxy: bool) -> bool {
    if url.scheme() != "https" || is_proxied(url, explicit_proxy) {
        return false;
    }
    let origin = url.origin().ascii_serialization();
    let probe = {
        let mut cache = H3_SUPPORT.lock().unwrap();
        if cache.len() >= 256 && !cache.contains_key(&origin) {
            cache.clear();
        }
        cache
            .entry(origin.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(None)))
            .clone()
    };
    let mut cached = probe.lock().await;
    if let Some((checked, supported)) = *cached {
        if checked.elapsed() < H3_CACHE_TTL {
            return supported;
        }
    }
    let supported = match builder()
        .no_proxy()
        .http3_prior_knowledge()
        .timeout(H3_PROBE_TIMEOUT)
        .build()
    {
        Ok(client) => probe_h3(&client, &origin).await,
        Err(_) => false,
    };
    *cached = Some((Instant::now(), supported));
    supported
}

async fn probe_h3(client: &Client, origin: &str) -> bool {
    client
        .head(format!("{origin}/"))
        .version(Version::HTTP_3)
        .timeout(H3_PROBE_TIMEOUT)
        .send()
        .await
        .is_ok_and(|response| response.version() == Version::HTTP_3)
}

fn tcp_version(url: &Url, policy: Policy) -> Version {
    if policy.sensitive && !is_local(url) {
        Version::HTTP_2
    } else {
        Version::HTTP_11
    }
}

async fn execute_once(
    client: &Client,
    mut request: Request,
    policy: Policy,
) -> Result<Response, Error> {
    let started = Instant::now();
    let timeout = request.timeout().copied();
    let origin = request.url().origin().ascii_serialization();
    let tcp = tcp_version(request.url(), policy);
    let use_h3 = supports_h3(request.url(), policy.explicit_proxy).await;
    if let Some(timeout) = timeout {
        *request.timeout_mut() = Some(timeout.checked_sub(started.elapsed()).ok_or(
            Error::Policy("HTTP request timed out while negotiating protocols"),
        )?);
    }
    *request.version_mut() = if use_h3 { Version::HTTP_3 } else { tcp };
    let retry = if use_h3 && matches!(*request.method(), Method::GET | Method::HEAD) {
        request.try_clone()
    } else {
        None
    };
    let result = if retry.is_some() {
        tokio::time::timeout(H3_PROBE_TIMEOUT, client.execute(request))
            .await
            .map_err(|_| Error::Policy("HTTP/3 response headers timed out"))
            .and_then(|result| result.map_err(Error::Http))
    } else {
        client.execute(request).await.map_err(Error::Http)
    };
    match result {
        Ok(response) => Ok(response),
        Err(error) => {
            if use_h3 {
                let probe = H3_SUPPORT.lock().unwrap().get(&origin).cloned();
                if let Some(probe) = probe {
                    *probe.lock().await = Some((Instant::now(), false));
                }
            }
            if let Some(mut retry) = retry {
                let can_fallback = match &error {
                    Error::Http(error) => {
                        error.is_connect() || error.is_timeout() || error.is_request()
                    }
                    Error::Policy(_) => true,
                    Error::SensitiveTransport(_) => false,
                };
                if can_fallback {
                    *retry.version_mut() = tcp;
                    if let Some(timeout) = timeout {
                        *retry.timeout_mut() = Some(timeout.checked_sub(started.elapsed()).ok_or(
                            Error::Policy("HTTP request timed out while falling back from HTTP/3"),
                        )?);
                    }
                    return client.execute(retry).await.map_err(|error| {
                        if tcp == Version::HTTP_2 {
                            Error::SensitiveTransport(error)
                        } else {
                            error.into()
                        }
                    });
                }
            }
            Err(match error {
                Error::Http(error) if tcp == Version::HTTP_2 => Error::SensitiveTransport(error),
                error => error,
            })
        }
    }
}

pub async fn execute(
    client: &Client,
    mut request: Request,
    policy: Policy,
) -> Result<Response, Error> {
    let started = Instant::now();
    let timeout = request.timeout().copied();
    for redirect_count in 0..=policy.max_redirects {
        if let Some(timeout) = timeout {
            *request.timeout_mut() = Some(timeout.checked_sub(started.elapsed()).ok_or(
                Error::Policy("HTTP request timed out while negotiating protocols or redirects"),
            )?);
        }
        let previous_url = request.url().clone();
        let previous_method = request.method().clone();
        let previous_headers = request.headers().clone();
        let next = request.try_clone();
        let response = execute_once(client, request, policy).await?;
        if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308)
            || policy.max_redirects == 0
        {
            return Ok(response);
        }
        let Some(location) = response
            .headers()
            .get(header::LOCATION)
            .and_then(|v| v.to_str().ok())
        else {
            return Ok(response);
        };
        let Ok(next_url) = previous_url.join(location) else {
            return Ok(response);
        };
        if !(policy.allow_redirect)(&next_url) {
            return Ok(response);
        }
        if redirect_count == policy.max_redirects {
            return Err(Error::Policy("Too many HTTP redirects"));
        }
        if !matches!(next_url.scheme(), "http" | "https")
            || (previous_url.scheme() == "https" && next_url.scheme() != "https")
            || !next_url.username().is_empty()
            || next_url.password().is_some()
        {
            return Err(Error::Policy("Refusing an unsafe HTTP redirect"));
        }
        let convert_to_get = (response.status().as_u16() == 303 && previous_method != Method::HEAD)
            || (matches!(response.status().as_u16(), 301 | 302) && previous_method == Method::POST);
        let mut next = match next {
            Some(next) => next,
            None if convert_to_get => {
                let mut next = Request::new(Method::GET, previous_url.clone());
                *next.headers_mut() = previous_headers;
                next
            }
            None => return Ok(response),
        };
        if convert_to_get {
            *next.method_mut() = Method::GET;
            *next.body_mut() = None;
            for header in [
                header::CONTENT_LENGTH,
                header::CONTENT_TYPE,
                header::TRANSFER_ENCODING,
            ] {
                next.headers_mut().remove(header);
            }
        }
        if previous_url.origin() != next_url.origin() {
            for name in [
                "authorization",
                "cookie",
                "proxy-authorization",
                "x-api-key",
                "x-goog-api-key",
                "api-key",
            ] {
                next.headers_mut().remove(name);
            }
        }
        next.headers_mut().remove(header::HOST);
        *next.url_mut() = next_url;
        request = next;
    }
    unreachable!()
}

#[cfg(test)]
mod tests;
