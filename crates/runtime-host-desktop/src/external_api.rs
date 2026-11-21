use std::collections::HashMap;
use std::sync::Arc;

use vrcx_0_application::avatars::cloudflare_block;
use vrcx_0_application_core::{
    Error, Result, RuntimeDiagnostics, RuntimeOperationStatus, RuntimeSyncEngine, WebClient,
};
use vrcx_0_integrations::external_api::{self, ExternalHttpRequestInput};

pub use vrcx_0_integrations::external_api::{
    CodeSearchProvider, ExternalApiAvatarSearchResponse, ExternalApiExecuteResponse,
};

#[derive(Clone)]
pub struct ExternalApiRuntime {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
}

impl ExternalApiRuntime {
    pub fn new(
        web: Arc<WebClient>,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
    ) -> Self {
        Self {
            web,
            diagnostics,
            sync,
        }
    }

    pub async fn avatar_search(
        &self,
        url: String,
        vrcx_id: String,
    ) -> Result<ExternalApiAvatarSearchResponse> {
        let response = self
            .execute(
                "app__external_api_avatar_search_get",
                "Searching external avatar provider.",
                external_api::ExternalApiScope::AvatarSearch,
                || {
                    let url = require_text(url, "ExternalApiAvatarSearchGet requires url.")?;
                    let vrcx_id =
                        require_text(vrcx_id, "ExternalApiAvatarSearchGet requires vrcxId.")?;
                    Ok(external_api::avatar_search_get_input(&url, &vrcx_id))
                },
            )
            .await?;
        let server_blocked = response.status != 200 && cloudflare_block(&response.data).is_some();
        Ok(ExternalApiAvatarSearchResponse {
            status: response.status,
            data: response.data,
            raw: response.raw,
            server_blocked,
        })
    }

    pub async fn youtube_video_metadata(
        &self,
        video_id: String,
        api_key: String,
    ) -> Result<ExternalApiExecuteResponse> {
        self.execute(
            "app__external_api_youtube_video_metadata_get",
            "Getting YouTube video metadata.",
            external_api::ExternalApiScope::Youtube,
            || {
                let video_id = require_text(
                    video_id,
                    "ExternalApiYoutubeVideoMetadataGet requires videoId.",
                )?;
                let api_key = require_text(
                    api_key,
                    "ExternalApiYoutubeVideoMetadataGet requires apiKey.",
                )?;
                Ok(external_api::youtube_video_metadata_get_input(
                    &video_id, &api_key,
                ))
            },
        )
        .await
    }

    /// Fork: searches the web for VRChat codes with the engine the user
    /// chose. Only the query and what that engine needs are sent.
    pub async fn code_search(
        &self,
        provider: external_api::CodeSearchProvider,
        query: String,
        api_key: String,
        search_engine_id: String,
        endpoint: String,
    ) -> Result<ExternalApiExecuteResponse> {
        self.execute(
            "app__external_api_code_search_get",
            "Searching the web for VRChat codes.",
            external_api::ExternalApiScope::CodeSearch,
            || {
                let query = require_text(query, "ExternalApiCodeSearchGet requires query.")?;
                let query: String = query.chars().take(200).collect();
                external_api::code_search_get_input(
                    provider,
                    &query,
                    &api_key,
                    &search_engine_id,
                    &endpoint,
                )
                .map_err(|error| Error::Custom(error.to_string()))
            },
        )
        .await
    }

    pub async fn github_releases(
        &self,
        url: String,
        headers: HashMap<String, String>,
    ) -> Result<ExternalApiExecuteResponse> {
        self.execute(
            "app__external_api_github_releases_get",
            "Getting external update release metadata.",
            external_api::ExternalApiScope::UpdateRelease,
            || {
                let url = require_text(url, "ExternalApiGithubReleasesGet requires url.")?;
                Ok(external_api::github_releases_get_input(&url, headers))
            },
        )
        .await
    }

    pub async fn github_contributors(
        &self,
        url: String,
        headers: HashMap<String, String>,
    ) -> Result<ExternalApiExecuteResponse> {
        self.execute(
            "app__external_api_github_contributors_get",
            "Getting GitHub contributors metadata.",
            external_api::ExternalApiScope::GithubContributors,
            || {
                let url = require_text(url, "ExternalApiGithubContributorsGet requires url.")?;
                Ok(external_api::github_contributors_get_input(&url, headers))
            },
        )
        .await
    }

    pub async fn image_data_url(&self, url: String) -> Result<ExternalApiExecuteResponse> {
        self.execute(
            "app__external_api_image_data_url_get",
            "Getting external image data.",
            external_api::ExternalApiScope::Image,
            || {
                let url = require_text(url, "ExternalApiImageDataUrlGet requires url.")?;
                Ok(external_api::image_data_url_get_input(&url))
            },
        )
        .await
    }

    async fn execute(
        &self,
        command: &'static str,
        detail: &'static str,
        scope: external_api::ExternalApiScope,
        build: impl FnOnce() -> Result<ExternalHttpRequestInput>,
    ) -> Result<ExternalApiExecuteResponse> {
        self.diagnostics
            .record_command(command, RuntimeOperationStatus::Running, detail);
        let request = match build() {
            Ok(input) => external_api::build_web_execute_request_with_policy(
                input,
                scope,
                &external_api::ExternalApiPolicy,
            )
            .map_err(|error| Error::Custom(error.to_string())),
            Err(error) => Err(error),
        };
        let result = match request {
            Ok(request) => self
                .web
                .execute_external(request)
                .await
                .and_then(|(status, data)| {
                    if status == -1 {
                        Err(Error::Custom(data))
                    } else {
                        Ok(external_api::execute_response(status, data, scope))
                    }
                }),
            Err(error) => Err(error),
        };
        match &result {
            Ok(response) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Ok,
                    format!("status={}", response.status),
                );
                self.sync.record(
                    "external-api",
                    RuntimeOperationStatus::Ready,
                    format!("{command} completed with status {}.", response.status),
                    0,
                );
            }
            Err(error) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Error,
                    error.to_string(),
                );
                self.sync.record_failure("external-api", error.to_string());
            }
        }
        result
    }
}

fn require_text(value: String, message: &str) -> Result<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(Error::Custom(message.into()));
    }
    Ok(value)
}
