use futures_util::future::BoxFuture;

use vrcx_0_contracts::community_theme_protocol as protocol;

use vrcx_0_application_core::{Error, Result};

use super::types::{CommunityThemeCatalog, CommunityThemeManifest};

pub type CommunityThemeRemoteFuture<'a, T> = BoxFuture<'a, Result<T>>;

pub trait CommunityThemeRemote: Send + Sync {
    fn load_catalog(&self) -> CommunityThemeRemoteFuture<'_, CommunityThemeCatalog>;
    fn load_manifest<'a>(
        &'a self,
        theme_id: &'a str,
    ) -> CommunityThemeRemoteFuture<'a, CommunityThemeManifest>;
    fn load_css<'a>(&'a self, theme_id: &'a str) -> CommunityThemeRemoteFuture<'a, String>;
}

pub(super) fn protocol_error(error: protocol::CommunityThemeProtocolError) -> Error {
    Error::Custom(error.to_string())
}
