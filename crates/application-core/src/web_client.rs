use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use vrcx_0_contracts::external_api::{
    ExternalApiExecuteResponse, ExternalApiScope, ExternalHttpRequestInput,
    ExternalWebExecuteRequest,
};
use vrcx_0_contracts::{
    RealtimeAuthTokenFetch, RealtimeConnectionOptions, VrchatRequest, VrchatResponse, VrchatScope,
    WebExecuteRequest,
};

use crate::Result;

#[async_trait]
pub trait WebClientPort: Send + Sync {
    fn save_cookies(&self);
    fn proxy_url(&self) -> Option<String>;
    async fn fetch_image(&self, url: &str) -> Result<Vec<u8>>;
    fn realtime_connection_options(&self) -> RealtimeConnectionOptions;
    fn clear_cookies(&self);
    fn clear_cookies_everywhere(&self);
    fn clear_auth_cookies(&self);
    fn cookie_diagnostics(&self) -> Value;
    fn auth_cookie_value(&self) -> Option<String>;
    fn get_cookies(&self) -> String;
    fn set_cookies(&self, b64: &str) -> Result<()>;
    async fn execute(&self, request: WebExecuteRequest) -> Result<(i32, String)>;
    async fn execute_external(&self, request: ExternalWebExecuteRequest) -> Result<(i32, String)>;
    async fn execute_api(&self, input: VrchatRequest, scope: VrchatScope)
        -> Result<VrchatResponse>;
    fn vrchat_config_snapshot(&self, endpoint: &str) -> Option<VrchatResponse>;
    fn clear_vrchat_config_snapshot(&self);
    async fn fetch_realtime_auth_token(&self, endpoint: &str) -> Result<RealtimeAuthTokenFetch>;
    async fn execute_external_api(
        &self,
        input: ExternalHttpRequestInput,
        scope: ExternalApiScope,
    ) -> Result<ExternalApiExecuteResponse>;
    async fn execute_external_api_limited(
        &self,
        input: ExternalHttpRequestInput,
        scope: ExternalApiScope,
        max_response_bytes: usize,
    ) -> Result<ExternalApiExecuteResponse>;
}

pub struct WebClient {
    inner: Arc<dyn WebClientPort>,
    proxy_url: Option<String>,
}

impl WebClient {
    pub fn new(inner: impl WebClientPort + 'static) -> Self {
        let proxy_url = inner.proxy_url();
        Self {
            inner: Arc::new(inner),
            proxy_url,
        }
    }

    pub fn save_cookies(&self) {
        self.inner.save_cookies();
    }

    pub fn proxy_url(&self) -> Option<&str> {
        self.proxy_url.as_deref()
    }

    pub async fn fetch_image(&self, url: &str) -> Result<Vec<u8>> {
        self.inner.fetch_image(url).await
    }

    pub fn realtime_connection_options(&self) -> RealtimeConnectionOptions {
        self.inner.realtime_connection_options()
    }

    pub fn clear_cookies(&self) {
        self.inner.clear_cookies();
    }

    pub fn clear_cookies_everywhere(&self) {
        self.inner.clear_cookies_everywhere();
    }

    pub fn clear_auth_cookies(&self) {
        self.inner.clear_auth_cookies();
    }

    pub fn cookie_diagnostics(&self) -> Value {
        self.inner.cookie_diagnostics()
    }

    pub fn auth_cookie_value(&self) -> Option<String> {
        self.inner.auth_cookie_value()
    }

    pub fn get_cookies(&self) -> String {
        self.inner.get_cookies()
    }

    pub fn set_cookies(&self, b64: &str) -> Result<()> {
        self.inner.set_cookies(b64)
    }

    pub async fn execute(&self, request: WebExecuteRequest) -> Result<(i32, String)> {
        self.inner.execute(request).await
    }

    pub async fn execute_external(
        &self,
        request: ExternalWebExecuteRequest,
    ) -> Result<(i32, String)> {
        self.inner.execute_external(request).await
    }

    pub async fn execute_api(
        &self,
        input: VrchatRequest,
        scope: VrchatScope,
    ) -> Result<VrchatResponse> {
        self.inner.execute_api(input, scope).await
    }

    pub fn vrchat_config_snapshot(&self, endpoint: &str) -> Option<VrchatResponse> {
        self.inner.vrchat_config_snapshot(endpoint)
    }

    pub fn clear_vrchat_config_snapshot(&self) {
        self.inner.clear_vrchat_config_snapshot();
    }

    pub async fn fetch_realtime_auth_token(
        &self,
        endpoint: &str,
    ) -> Result<RealtimeAuthTokenFetch> {
        self.inner.fetch_realtime_auth_token(endpoint).await
    }

    pub async fn execute_external_api(
        &self,
        input: ExternalHttpRequestInput,
        scope: ExternalApiScope,
    ) -> Result<ExternalApiExecuteResponse> {
        self.inner.execute_external_api(input, scope).await
    }

    pub async fn execute_external_api_limited(
        &self,
        input: ExternalHttpRequestInput,
        scope: ExternalApiScope,
        max_response_bytes: usize,
    ) -> Result<ExternalApiExecuteResponse> {
        self.inner
            .execute_external_api_limited(input, scope, max_response_bytes)
            .await
    }
}
