use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use vrcx_0_application_core::{
    BackgroundCapabilitySession, CurrentUserSnapshot, RuntimeEventPayload,
};

use super::AuthenticatedRuntimeSession;

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedSessionSnapshot {
    pub auth_scope_generation: u64,
    pub user_id: String,
    pub display_name: String,
    pub endpoint: String,
    pub websocket: String,
    pub current_user_snapshot: CurrentUserSnapshot,
}

#[derive(Clone, Debug, Default, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedSessionProjection {
    pub revision: u64,
    pub session: Option<AuthenticatedSessionSnapshot>,
}

impl RuntimeEventPayload for AuthenticatedSessionProjection {
    const EVENT_NAME: &'static str = "authenticatedSessionProjection";
}

pub fn establish_authenticated_session_projection(
    current: &AuthenticatedSessionProjection,
    session: &AuthenticatedRuntimeSession,
    auth_scope_generation: u64,
) -> AuthenticatedSessionProjection {
    AuthenticatedSessionProjection {
        revision: current.revision.saturating_add(1),
        session: Some(AuthenticatedSessionSnapshot {
            auth_scope_generation,
            user_id: session.user_id.clone(),
            display_name: session.display_name.clone(),
            endpoint: session.endpoint.clone(),
            websocket: session.websocket.clone(),
            current_user_snapshot: CurrentUserSnapshot::from_value(
                session.current_user.as_value().clone(),
            ),
        }),
    }
}

pub fn clear_authenticated_session_projection(
    current: &AuthenticatedSessionProjection,
) -> AuthenticatedSessionProjection {
    AuthenticatedSessionProjection {
        revision: current.revision.saturating_add(1),
        session: None,
    }
}

pub fn replace_authenticated_session_user_if_session_matches(
    session_slot: &Arc<Mutex<AuthenticatedSessionProjection>>,
    expected: &BackgroundCapabilitySession,
    snapshot: Value,
) -> bool {
    let mut slot = session_slot
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if !authenticated_session_projection_matches(Some(&slot), expected) {
        return false;
    }
    let Some(session) = slot.session.as_mut() else {
        return false;
    };
    session.current_user_snapshot = CurrentUserSnapshot::from_value(snapshot);
    let display_name = session.current_user_snapshot.display_name();
    if !display_name.is_empty() {
        session.display_name = display_name.to_string();
    }
    slot.revision = slot.revision.saturating_add(1);
    true
}

pub fn authenticated_session_projection_matches(
    projection: Option<&AuthenticatedSessionProjection>,
    expected: &BackgroundCapabilitySession,
) -> bool {
    projection
        .and_then(|projection| projection.session.as_ref())
        .map(|current| {
            current.auth_scope_generation == expected.auth_scope_generation
                && current.user_id == expected.current_user_id
                && current.endpoint == expected.endpoint
                && current.websocket == expected.websocket
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session() -> AuthenticatedRuntimeSession {
        AuthenticatedRuntimeSession::from_user(
            json!({
                "id": "usr_owner",
                "displayName": "Projected User",
                "username": "projected_user",
            }),
            "https://api.example.test/api/1/".into(),
            "wss://pipeline.example.test/".into(),
        )
    }

    #[test]
    fn establishing_projection_preserves_the_authenticated_session_contract() {
        let projection = establish_authenticated_session_projection(
            &AuthenticatedSessionProjection::default(),
            &session(),
            7,
        );

        assert_eq!(projection.revision, 1);
        let projected_session = projection.session.expect("authenticated session");
        assert_eq!(projected_session.auth_scope_generation, 7);
        assert_eq!(projected_session.user_id, "usr_owner");
        assert_eq!(projected_session.display_name, "Projected User");
        assert_eq!(projected_session.endpoint, "https://api.example.test/api/1");
        assert_eq!(projected_session.websocket, "wss://pipeline.example.test");
        assert_eq!(
            projected_session.current_user_snapshot.as_value()["id"],
            "usr_owner"
        );
    }

    #[test]
    fn clearing_projection_advances_revision_and_removes_the_session() {
        let established = establish_authenticated_session_projection(
            &AuthenticatedSessionProjection::default(),
            &session(),
            7,
        );

        let cleared = clear_authenticated_session_projection(&established);

        assert_eq!(cleared.revision, 2);
        assert!(cleared.session.is_none());
    }

    #[test]
    fn current_user_replacement_advances_the_projection() {
        let established = establish_authenticated_session_projection(
            &AuthenticatedSessionProjection::default(),
            &session(),
            7,
        );
        let slot = Arc::new(Mutex::new(established));
        let expected = BackgroundCapabilitySession {
            auth_scope_generation: 7,
            current_user_id: "usr_owner".into(),
            endpoint: "https://api.example.test/api/1".into(),
            websocket: "wss://pipeline.example.test".into(),
            current_user_snapshot: Value::Null.into(),
        };
        assert!(replace_authenticated_session_user_if_session_matches(
            &slot,
            &expected,
            json!({ "id": "usr_owner", "displayName": "Updated User" }),
        ));

        let projection = slot.lock().unwrap().clone();
        assert_eq!(projection.revision, 2);
        assert_eq!(projection.session.unwrap().display_name, "Updated User");
    }

    #[test]
    fn current_user_replacement_rejects_a_previous_login_generation() {
        let established = establish_authenticated_session_projection(
            &AuthenticatedSessionProjection::default(),
            &session(),
            8,
        );
        let slot = Arc::new(Mutex::new(established));
        let expected = BackgroundCapabilitySession {
            auth_scope_generation: 7,
            current_user_id: "usr_owner".into(),
            endpoint: "https://api.example.test/api/1".into(),
            websocket: "wss://pipeline.example.test".into(),
            current_user_snapshot: Value::Null.into(),
        };
        assert!(!replace_authenticated_session_user_if_session_matches(
            &slot,
            &expected,
            json!({ "id": "usr_owner", "displayName": "Stale User" }),
        ));
        assert_eq!(slot.lock().unwrap().revision, 1);
    }
}
