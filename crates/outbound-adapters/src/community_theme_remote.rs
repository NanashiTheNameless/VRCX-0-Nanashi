use std::sync::Arc;

use futures_util::stream::{self, StreamExt};
use vrcx_0_application::profile::{
    CommunityThemeCatalog, CommunityThemeManifest, CommunityThemeRemote, CommunityThemeRemoteFuture,
};
use vrcx_0_application_core::{Error, WebClient};
use vrcx_0_contracts::community_theme_protocol as protocol;
use vrcx_0_integrations::external_api::{ExternalApiScope, ExternalHttpRequestInput};

pub struct ExternalCommunityThemeRemote {
    web: Arc<WebClient>,
}

impl ExternalCommunityThemeRemote {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }

    async fn execute(
        &self,
        input: ExternalHttpRequestInput,
        max_response_bytes: usize,
        context: &str,
    ) -> crate::Result<String> {
        let response = self
            .web
            .execute_external_api_limited(
                input,
                ExternalApiScope::CommunityTheme,
                max_response_bytes,
            )
            .await?;
        protocol::ensure_community_theme_response(
            response.status,
            &response.data,
            max_response_bytes,
            context,
        )
        .map_err(protocol_error)?;
        Ok(response.data)
    }
}

impl CommunityThemeRemote for ExternalCommunityThemeRemote {
    fn load_catalog(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeCatalog> {
        Box::pin(async move {
            let body = self
                .execute(
                    protocol::community_theme_catalog_input(),
                    protocol::COMMUNITY_THEME_CATALOG_MAX_BYTES,
                    "catalog",
                )
                .await?;
            let (schema_version, theme_ids) =
                protocol::parse_community_theme_catalog_index(&body).map_err(protocol_error)?;
            let manifests = stream::iter(theme_ids)
                .map(|theme_id| async move {
                    let manifest = self.load_manifest(&theme_id).await;
                    (theme_id, manifest)
                })
                .buffered(8)
                .collect()
                .await;
            let themes = collect_catalog_manifests(manifests)?;
            Ok(CommunityThemeCatalog {
                source_url: protocol::COMMUNITY_THEME_CATALOG_URL.into(),
                schema_version,
                themes,
            })
        })
    }

    fn load_manifest<'a>(
        &'a self,
        theme_id: &'a str,
    ) -> CommunityThemeRemoteFuture<'a, CommunityThemeManifest> {
        Box::pin(async move {
            let input =
                protocol::community_theme_manifest_input(theme_id).map_err(protocol_error)?;
            let body = self
                .execute(
                    input,
                    protocol::COMMUNITY_THEME_MANIFEST_MAX_BYTES,
                    &format!("manifest {theme_id}"),
                )
                .await?;
            protocol::parse_community_theme_manifest(&body, theme_id).map_err(protocol_error)
        })
    }

    fn load_css<'a>(&'a self, theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, String> {
        Box::pin(async move {
            let input = protocol::community_theme_css_input(theme_id).map_err(protocol_error)?;
            let body = self
                .execute(
                    input,
                    protocol::COMMUNITY_THEME_CSS_MAX_BYTES,
                    &format!("CSS {theme_id}"),
                )
                .await?;
            if body.trim().is_empty() {
                return Err(Error::Custom(format!(
                    "Community theme CSS is empty: {theme_id}."
                )));
            }
            Ok(body)
        })
    }
}

fn collect_catalog_manifests(
    manifests: Vec<(String, crate::Result<CommunityThemeManifest>)>,
) -> crate::Result<Vec<CommunityThemeManifest>> {
    let mut themes = Vec::with_capacity(manifests.len());
    let mut first_error = None;
    for (theme_id, manifest) in manifests {
        match manifest {
            Ok(manifest) => themes.push(manifest),
            Err(error) => {
                tracing::warn!(theme_id, error = %error, "failed to load community theme manifest");
                first_error.get_or_insert(error);
            }
        }
    }
    match first_error {
        Some(error) if themes.is_empty() => Err(error),
        _ => Ok(themes),
    }
}

fn protocol_error(error: protocol::CommunityThemeProtocolError) -> Error {
    Error::Custom(error.to_string())
}

#[cfg(test)]
mod tests {
    use vrcx_0_application::profile::{CommunityThemeAuthor, CommunityThemeManifest};
    use vrcx_0_application_core::Error;

    use super::collect_catalog_manifests;

    fn manifest(id: &str) -> CommunityThemeManifest {
        CommunityThemeManifest {
            id: id.into(),
            name: id.into(),
            version: "1.0.0".into(),
            author: CommunityThemeAuthor {
                name: "Test".into(),
                github: "test".into(),
                url: None,
            },
            description: String::new(),
            tags: Vec::new(),
            tested_with: String::new(),
            remote_assets: false,
            dark_mode: true,
            accent_mode: false,
            preview_url: String::new(),
            readme_url: String::new(),
        }
    }

    #[test]
    fn catalog_skips_manifests_that_fail_to_load() {
        let themes = collect_catalog_manifests(vec![
            ("alpha".into(), Ok(manifest("alpha"))),
            ("broken".into(), Err(Error::Custom("timeout".into()))),
            ("gamma".into(), Ok(manifest("gamma"))),
        ])
        .unwrap();

        let ids: Vec<_> = themes.iter().map(|theme| theme.id.as_str()).collect();
        assert_eq!(ids, ["alpha", "gamma"]);
    }

    #[test]
    fn catalog_fails_when_every_manifest_fails_to_load() {
        let error = collect_catalog_manifests(vec![
            ("alpha".into(), Err(Error::Custom("first".into()))),
            ("beta".into(), Err(Error::Custom("second".into()))),
        ])
        .unwrap_err();

        assert!(error.to_string().contains("first"));
    }
}
