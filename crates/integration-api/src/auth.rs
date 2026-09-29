use vrcx_0_local_server::{generate_token, is_allowed_authority, tokens_match};

use crate::IntegrationApiError;

pub(crate) const BASE_SUBPROTOCOL: &str = "vrcx0.integration.v1";
const TOKEN_SUBPROTOCOL_PREFIX: &str = "vrcx0.integration.token.";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct IntegrationApiAuthPolicy {
    pub port: u16,
    pub token: String,
    pub allow_lan_connections: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub(crate) enum IntegrationApiAuthError {
    #[error("Integration API requests used an invalid host header")]
    InvalidHost,
    #[error("Integration API request token was missing or invalid")]
    Unauthorized,
}

pub(crate) fn generate_integration_api_token() -> Result<String, IntegrationApiError> {
    generate_token().map_err(IntegrationApiError::from)
}

pub(crate) fn authorize_integration_api_request(
    policy: &IntegrationApiAuthPolicy,
    authorization: Option<&str>,
    host: Option<&str>,
    subprotocols: Option<&str>,
) -> Result<(), IntegrationApiAuthError> {
    if !is_allowed_authority(host, policy.port, policy.allow_lan_connections) {
        return Err(IntegrationApiAuthError::InvalidHost);
    }

    let subprotocol_tokens = subprotocols
        .into_iter()
        .flat_map(|value| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let supplied_token = if let Some(authorization) = authorization {
        authorization.strip_prefix("Bearer ")
    } else {
        subprotocol_tokens
            .iter()
            .find_map(|value| value.strip_prefix(TOKEN_SUBPROTOCOL_PREFIX))
    }
    .ok_or(IntegrationApiAuthError::Unauthorized)?;

    if !tokens_match(supplied_token, &policy.token) {
        return Err(IntegrationApiAuthError::Unauthorized);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(allow_lan_connections: bool) -> IntegrationApiAuthPolicy {
        IntegrationApiAuthPolicy {
            port: 8799,
            token: "secret-token".into(),
            allow_lan_connections,
        }
    }

    #[test]
    fn bearer_auth_accepts_loopback_hosts() {
        assert_eq!(
            authorize_integration_api_request(
                &policy(false),
                Some("Bearer secret-token"),
                Some("127.0.0.1:8799"),
                None
            ),
            Ok(())
        );
        assert!(authorize_integration_api_request(
            &policy(false),
            Some("Bearer secret-token"),
            Some("evil.test:8799"),
            None
        )
        .is_err());
    }

    #[test]
    fn websocket_subprotocol_auth_selects_only_the_base_protocol() {
        assert_eq!(
            authorize_integration_api_request(
                &policy(false),
                None,
                Some("localhost:8799"),
                Some("vrcx0.integration.v1, vrcx0.integration.token.secret-token")
            ),
            Ok(())
        );
    }

    #[test]
    fn bearer_path_has_priority_over_subprotocol_token() {
        assert_eq!(
            authorize_integration_api_request(
                &policy(false),
                Some("Bearer wrong"),
                Some("localhost:8799"),
                Some("vrcx0.integration.v1, vrcx0.integration.token.secret-token")
            ),
            Err(IntegrationApiAuthError::Unauthorized)
        );
    }

    #[test]
    fn missing_and_incorrect_tokens_are_indistinguishable() {
        assert_eq!(
            authorize_integration_api_request(
                &policy(false),
                None,
                Some("localhost:8799"),
                Some("vrcx0.integration.v1")
            ),
            Err(IntegrationApiAuthError::Unauthorized)
        );
        assert_eq!(
            authorize_integration_api_request(
                &policy(false),
                Some("Bearer incorrect"),
                Some("localhost:8799"),
                None
            ),
            Err(IntegrationApiAuthError::Unauthorized)
        );
    }

    #[test]
    fn disallowed_authority_maps_to_invalid_host() {
        assert_eq!(
            authorize_integration_api_request(
                &policy(false),
                Some("Bearer secret-token"),
                Some("192.168.1.20:8799"),
                None
            ),
            Err(IntegrationApiAuthError::InvalidHost)
        );
    }
}
