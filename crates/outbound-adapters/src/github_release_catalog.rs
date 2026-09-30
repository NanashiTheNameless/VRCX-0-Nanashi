use std::collections::HashMap;
use std::sync::Arc;

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

pub struct GitHubReleaseCatalogAdapter {
    web: Arc<WebClient>,
}

impl GitHubReleaseCatalogAdapter {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }
}

impl AppUpdateReleaseCatalogPort for GitHubReleaseCatalogAdapter {
    fn list_releases(&self) -> AppUpdateReleaseCatalogFuture<'_> {
        Box::pin(async move {
            let mut headers = HashMap::new();
            headers.insert(
                "Accept".to_string(),
                "application/vnd.github+json".to_string(),
            );
            let input = external_api::github_releases_get_input(GITHUB_RELEASES_URL, headers);
            let response = self
                .web
                .execute_external_api(input, ExternalApiScope::UpdateRelease)
                .await?;
            parse_catalog_response(response.status, &response.data)
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
            published_at: release.published_at,
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
    Ok(releases.into_iter().map(Into::into).collect())
}

#[cfg(test)]
mod tests {
    use super::parse_catalog_response;

    #[test]
    fn catalog_response_maps_github_json_to_application_releases() {
        let releases = parse_catalog_response(
            200,
            r#"[{"tag_name":"v2.15.0","prerelease":false,"assets":[{"state":"uploaded","name":"version_manifest.json","browser_download_url":"https://example.test/version_manifest.json"}]}]"#,
        )
        .unwrap();

        assert_eq!(releases.len(), 1);
        assert_eq!(releases[0].tag_name.as_deref(), Some("v2.15.0"));
        assert_eq!(releases[0].assets.len(), 1);
        assert_eq!(
            releases[0].assets[0].browser_download_url.as_deref(),
            Some("https://example.test/version_manifest.json")
        );
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
}
