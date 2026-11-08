use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::Value;
use vrcx_0_application::profile::{
    AppUpdateCatalogAsset, AppUpdateCatalogRelease, AppUpdateReleaseCatalogFuture,
    AppUpdateReleaseCatalogPort,
};
use vrcx_0_application_core::{Error, WebClient};
use vrcx_0_contracts::external_api::{self, ExternalApiScope};

const GITHUB_RELEASES_URL: &str =
    "https://api.github.com/repos/NanashiTheNameless/VRCX-0-Nanashi/releases";

/// How long one release list answers every caller. Opening the updater dialog
/// asks for the list and runs a check at the same time, and installing looks
/// the release up again; within this window they share one GitHub request.
const SHARED_LIST_TTL: Duration = Duration::from_secs(60);

pub struct GitHubReleaseCatalogAdapter {
    web: Arc<WebClient>,
    // Held across the request, so concurrent callers wait for the one in
    // flight instead of starting their own.
    recent: tokio::sync::Mutex<Option<(Instant, Vec<AppUpdateCatalogRelease>)>>,
}

impl GitHubReleaseCatalogAdapter {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self {
            web,
            recent: tokio::sync::Mutex::new(None),
        }
    }

    async fn fetch(&self) -> vrcx_0_application_core::Result<Vec<AppUpdateCatalogRelease>> {
        match self.fetch_once().await {
            Err(Attempt::Retry(error)) => {
                tracing::debug!(%error, "retrying the GitHub release list");
                tokio::time::sleep(RETRY_DELAY).await;
                self.fetch_once().await.map_err(Attempt::into_error)
            }
            result => result.map_err(Attempt::into_error),
        }
    }

    async fn fetch_once(&self) -> Result<Vec<AppUpdateCatalogRelease>, Attempt> {
        let mut headers = HashMap::new();
        headers.insert(
            "Accept".to_string(),
            "application/vnd.github+json".to_string(),
        );
        let input = external_api::github_releases_get_input(GITHUB_RELEASES_URL, headers);
        let response = self
            .web
            .execute_external_api(input, ExternalApiScope::UpdateRelease)
            .await
            .map_err(Attempt::Retry)?;
        classify_response(response.status, &response.data)
    }
}

fn classify_response(status: i32, data: &str) -> Result<Vec<AppUpdateCatalogRelease>, Attempt> {
    let result = parse_catalog_response(status, data);
    if status >= 500 {
        result.map_err(Attempt::Retry)
    } else {
        result.map_err(Attempt::GiveUp)
    }
}

/// GitHub's release API sometimes times out or answers 5xx for a moment, so
/// those get one more try. Anything else, such as a rate limit, would fail
/// the same way again.
const RETRY_DELAY: Duration = Duration::from_secs(2);

enum Attempt {
    Retry(Error),
    GiveUp(Error),
}

impl Attempt {
    fn into_error(self) -> Error {
        match self {
            Self::Retry(error) | Self::GiveUp(error) => error,
        }
    }
}

impl AppUpdateReleaseCatalogPort for GitHubReleaseCatalogAdapter {
    fn list_releases(&self) -> AppUpdateReleaseCatalogFuture<'_> {
        Box::pin(async move {
            let mut recent = self.recent.lock().await;
            if let Some((fetched_at, releases)) = recent.as_ref() {
                if fetched_at.elapsed() < SHARED_LIST_TTL {
                    return Ok(releases.clone());
                }
            }
            let releases = self.fetch().await?;
            *recent = Some((Instant::now(), releases.clone()));
            Ok(releases)
        })
    }
}

#[derive(Deserialize)]
struct GitHubReleaseAsset {
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    browser_download_url: Option<String>,
}

impl From<GitHubReleaseAsset> for AppUpdateCatalogAsset {
    fn from(asset: GitHubReleaseAsset) -> Self {
        Self {
            state: asset.state,
            name: asset.name,
            browser_download_url: asset.browser_download_url,
        }
    }
}

#[derive(Deserialize)]
struct GitHubRelease {
    #[serde(default)]
    tag_name: Option<String>,
    #[serde(default)]
    assets: Vec<GitHubReleaseAsset>,
    #[serde(default)]
    html_url: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

impl From<GitHubRelease> for AppUpdateCatalogRelease {
    fn from(release: GitHubRelease) -> Self {
        Self {
            tag_name: release.tag_name,
            assets: release.assets.into_iter().map(Into::into).collect(),
            html_url: release.html_url,
            name: release.name,
            prerelease: release.prerelease,
            published_at: release
                .published_at
                .as_deref()
                .and_then(vrcx_0_core::time::parse_epoch_seconds),
            body: release.body,
        }
    }
}

fn parse_catalog_response(
    status: i32,
    data: &str,
) -> vrcx_0_application_core::Result<Vec<AppUpdateCatalogRelease>> {
    if status != 200 {
        return Err(Error::Custom(format!(
            "GitHub release request failed ({status})."
        )));
    }
    let value: Value = serde_json::from_str(data)?;
    if let Some(message) = value.get("message").and_then(Value::as_str) {
        return Err(Error::Custom(message.to_string()));
    }
    let releases = match value {
        Value::Array(_) => serde_json::from_value::<Vec<GitHubRelease>>(value)?,
        other => vec![serde_json::from_value::<GitHubRelease>(other)?],
    };
    Ok(releases
        .into_iter()
        .filter(|release| {
            release
                .tag_name
                .as_deref()
                .is_some_and(vrcx_0_core::update_compatibility::supports_current_profile)
        })
        .map(Into::into)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{classify_response, parse_catalog_response, Attempt};

    #[test]
    fn catalog_response_maps_github_json_to_application_releases() {
        let releases = parse_catalog_response(
            200,
            r#"[{"tag_name":"v3.0.1","prerelease":false,"assets":[{"state":"uploaded","name":"version_manifest.json","browser_download_url":"https://example.test/version_manifest.json"}]}]"#,
        )
        .unwrap();

        assert_eq!(releases.len(), 1);
        assert_eq!(releases[0].tag_name.as_deref(), Some("v3.0.1"));
        assert_eq!(releases[0].assets.len(), 1);
        assert_eq!(
            releases[0].assets[0].browser_download_url.as_deref(),
            Some("https://example.test/version_manifest.json")
        );
    }

    #[test]
    fn catalog_excludes_releases_from_before_the_profile_rename() {
        let releases = parse_catalog_response(200, r#"[{"tag_name":"v3.0.0"},{"tag_name":"v3.0.0-Nightly-abcdef0"},{"tag_name":"v3.0.1-Nightly-123abcd"},{"tag_name":"v3.0.1"}]"#).unwrap();
        assert_eq!(releases.len(), 2);
        assert_eq!(
            releases[0].tag_name.as_deref(),
            Some("v3.0.1-Nightly-123abcd")
        );
        assert_eq!(releases[1].tag_name.as_deref(), Some("v3.0.1"));
    }

    #[test]
    fn catalog_response_preserves_http_and_api_errors() {
        assert_eq!(
            parse_catalog_response(503, "unavailable")
                .unwrap_err()
                .to_string(),
            "GitHub release request failed (503)."
        );
        assert_eq!(
            parse_catalog_response(200, r#"{"message":"rate limited"}"#)
                .unwrap_err()
                .to_string(),
            "rate limited"
        );
    }

    #[test]
    fn only_server_errors_are_retried() {
        assert!(matches!(
            classify_response(504, "<html>Gateway Timeout</html>"),
            Err(Attempt::Retry(_))
        ));
        assert!(matches!(classify_response(502, ""), Err(Attempt::Retry(_))));
        assert!(matches!(
            classify_response(403, r#"{"message":"API rate limit exceeded"}"#),
            Err(Attempt::GiveUp(_))
        ));
        assert!(matches!(
            classify_response(404, r#"{"message":"Not Found"}"#),
            Err(Attempt::GiveUp(_))
        ));
        assert!(matches!(
            classify_response(200, r#"[{"tag_name":"v3.0.1"}]"#),
            Ok(releases) if releases.len() == 1
        ));
    }
}
