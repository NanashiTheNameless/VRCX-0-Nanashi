use vrcx_0_application_core::ProxySettingsTestResult;

pub async fn test_proxy_connectivity(
    proxy_url: &str,
    app_version: &str,
) -> vrcx_0_application_core::Result<ProxySettingsTestResult> {
    vrcx_0_application_core::test_proxy_connectivity(
        &vrcx_0_outbound_adapters::ProxyConnectivityAdapter,
        proxy_url,
        app_version,
    )
    .await
}
