use std::sync::Arc;

use futures_util::stream::{self, StreamExt, TryStreamExt};
use vrcx_0_application::profile::{
    CommunityThemeCatalog, CommunityThemeManifest, CommunityThemeRemote,
    CommunityThemeRemoteFuture, CommunityThemeStatsById,
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
            let themes = stream::iter(theme_ids)
                .map(|theme_id| async move { self.load_manifest(&theme_id).await })
                .buffered(8)
                .try_collect()
                .await?;
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

    fn load_stats(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeStatsById> {
        Box::pin(async move {
            let body = self
                .execute(
                    protocol::community_theme_stats_input(),
                    protocol::COMMUNITY_THEME_STATS_MAX_BYTES,
                    "stats",
                )
                .await?;
            protocol::parse_community_theme_stats(&body).map_err(protocol_error)
        })
    }

    // Fork: never report theme installs upstream (install-count analytics).
    fn report_install<'a>(&'a self, _theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, bool> {
        Box::pin(async move { Ok(false) })
    }
}

fn protocol_error(error: protocol::CommunityThemeProtocolError) -> Error {
    Error::Custom(error.to_string())
}
