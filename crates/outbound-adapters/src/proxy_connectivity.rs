use async_trait::async_trait;
use vrcx_0_application_core::{Error, ProxyConnectivityPort};
use vrcx_0_vrchat_client::web_client::{WebClient, WebExecuteRequest};

const VRC_STATUS_TEST_URL: &str = "https://status.vrchat.com/api/v2/status.json";

pub struct ProxyConnectivityAdapter;

#[async_trait]
impl ProxyConnectivityPort for ProxyConnectivityAdapter {
    async fn execute(
        &self,
        normalized_proxy: Option<String>,
        app_version: &str,
    ) -> Result<(i32, String), Error> {
        let client = WebClient::new(normalized_proxy, None, app_version)
            .map_err(|error| Error::WebClient(error.to_string()))?;
        let request = WebExecuteRequest::new(VRC_STATUS_TEST_URL.into(), "GET".into());
        client
            .execute(request)
            .await
            .map_err(|error| Error::WebClient(error.to_string()))
    }
}
