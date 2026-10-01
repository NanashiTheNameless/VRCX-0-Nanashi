use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use vrcx_0_application_core::RuntimeOperationStatus;

use serde_json::{json, Value};
use vrcx_0_application_core::{
    AuthenticatedMutationContext, Error, LocalGameContextSnapshot, Result,
};
use vrcx_0_contracts::vrchat_api::VrchatScope as ApiScope;
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::json::RawJson;

use crate::realtime::invite_automation::decision::{
    context_gates, cooldown_gate, evaluate_invite_automation, normalize_invite_automation_mode,
    CooldownView, InviteAutomationConfig, InviteAutomationInput, InviteAutomationSkipReason,
    InviteDecision, InviteLocationFacts, InviteNotificationFacts, SenderAllowlist,
};
use crate::realtime::invite_automation::runtime::{sender_scope_key, InviteOutcome};
use crate::realtime::{RealtimeNotificationProjection, RealtimeSessionContext};
use crate::social_baseline::{
    build_favorites_baseline_from_friend_records, SocialBaselineDeps,
    SocialFavoritesBaselineRequest,
};
use crate::world_enrich::is_meaningful_world_name;

use super::message_dispatch::json_string_field;
use super::RealtimeHostRuntime;

const INVITE_AUTOMATION_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);

impl RealtimeHostRuntime {
    pub(super) fn schedule_invite_automation(
        self: &Arc<Self>,
        projection: &RealtimeNotificationProjection,
    ) {
        for upsert in projection.upserts.iter().filter(|upsert| {
            upsert.run_automation && notification_type(&upsert.notification) == "requestInvite"
        }) {
            let runtime = Arc::clone(self);
            let notification = upsert.notification.clone();
            self.deps.tasks.spawn(async move {
                runtime
                    .run_invite_automation(notification.into_value())
                    .await;
            });
        }
    }

    async fn run_invite_automation(self: Arc<Self>, notification: Value) {
        let facts = notification_facts(&notification);
        if facts.sender_user_id.is_empty() {
            self.record_invite_automation_skip(InviteAutomationSkipReason::InvalidNotification);
            return;
        }
        let Some(session) = self.active_invite_session() else {
            self.record_invite_automation_skip(
                InviteAutomationSkipReason::MissingCurrentSessionOrLocation,
            );
            return;
        };
        let scope_key =
            sender_scope_key(&session.endpoint, &session.user_id, &facts.sender_user_id);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let gate = {
            let mut state = match self.state.lock() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!("invite automation state lock failed: {error}");
                    return;
                }
            };
            let cooldown = state.automation.invite.cooldown_view(&scope_key, now_ms);
            match cooldown_gate(&cooldown, now_ms) {
                Err(reason) => Err(reason),
                Ok(()) => {
                    state.automation.invite.begin(&scope_key);
                    Ok(cooldown)
                }
            }
        };
        let cooldown = match gate {
            Ok(cooldown) => cooldown,
            Err(reason) => {
                self.record_invite_automation_skip(reason);
                return;
            }
        };

        let result = self
            .run_invite_automation_inner(facts, session, scope_key.clone(), cooldown, now_ms)
            .await;
        let outcome = match &result {
            Ok(true) => InviteOutcome::Sent,
            Ok(false) => InviteOutcome::Skipped,
            Err(error) => {
                tracing::warn!("invite automation failed: {error}");
                self.deps
                    .sync
                    .record_failure("inviteAutomation", error.to_string());
                InviteOutcome::Failed
            }
        };
        if let Ok(mut state) = self.state.lock() {
            state.automation.invite.finish(&scope_key, outcome, now_ms);
        }
    }

    async fn run_invite_automation_inner(
        &self,
        notification_facts: InviteNotificationFacts,
        session: RealtimeSessionContext,
        scope_key: String,
        cooldown: CooldownView,
        now_ms: i64,
    ) -> Result<bool> {
        let config = load_invite_automation_config(self.deps.store.as_ref())?;
        let location = self.current_invite_location_facts(&session);
        if let Err(reason) = context_gates(&config, &location) {
            self.record_invite_automation_skip(reason);
            return Ok(false);
        }
        let allowlist = self
            .build_sender_allowlist(&session, &notification_facts.sender_user_id)
            .await?;
        let input = InviteAutomationInput {
            notification: notification_facts.clone(),
            config,
            allowlist,
            location,
            cooldown,
            now_ms,
        };
        let decision = evaluate_invite_automation(&input);
        let InviteDecision::Send {
            receiver_user_id,
            instance_id,
            world_id,
        } = decision
        else {
            if let InviteDecision::Skip { reason } = decision {
                self.record_invite_automation_skip(reason);
            }
            return Ok(false);
        };

        let latest_location = self.current_invite_location_facts(&session);
        if latest_location.current_location() != instance_id || !latest_location.is_game_running() {
            self.record_invite_automation_skip(
                InviteAutomationSkipReason::MissingCurrentSessionOrLocation,
            );
            return Ok(false);
        }
        if latest_location.closed_locations.contains(&instance_id) {
            self.record_invite_automation_skip(
                InviteAutomationSkipReason::CurrentLocationNotInvitable,
            );
            return Ok(false);
        }

        let world_name = self
            .world_cache
            .resolve_name(&self.deps.web, &session.endpoint, &world_id)
            .await
            .filter(|name| is_meaningful_world_name(name))
            .unwrap_or_else(|| world_id.clone());
        let (_, request) = self.deps.remote_requests.invite_send(
            session.endpoint.clone(),
            receiver_user_id.clone(),
            json!({
                "instanceId": instance_id,
                "worldId": world_id,
                "worldName": world_name,
                "rsvp": true,
            }),
        )?;
        let mutation = AuthenticatedMutationContext::capture(
            &self.deps.auth_scope,
            self.deps.remote_mutations.as_ref(),
            "Invite automation",
        )?;
        if mutation.scope().current_user_id != session.user_id
            || mutation.scope().endpoint != session.endpoint
        {
            return Err(Error::Custom(
                "Invite automation authentication scope changed.".into(),
            ));
        }
        let mut request = request;
        mutation.apply_scope_to_request(&mut request);
        let response = mutation
            .run_after_wait(INVITE_AUTOMATION_REMOTE_MUTATION_INTERVAL, || async {
                self.deps.web.execute_api(request, ApiScope::Vrchat).await
            })
            .await?;
        if !(200..=299).contains(&response.status) {
            return Err(Error::Custom(format!(
                "invite automation send returned HTTP {}",
                response.status
            )));
        }

        self.cleanup_invite_request_notification(&mutation, &notification_facts)
            .await;
        self.deps.sync.record(
            "inviteAutomation",
            RuntimeOperationStatus::Sent,
            format!("Invite automation sent invite to {receiver_user_id}."),
            1,
        );
        tracing::debug!(scope_key, "invite automation completed");
        Ok(true)
    }

    fn active_invite_session(&self) -> Option<RealtimeSessionContext> {
        self.state.lock().ok().and_then(|state| {
            state
                .connection
                .active_context
                .as_ref()
                .map(|active| active.session.clone())
        })
    }

    fn current_invite_location_facts(
        &self,
        session: &RealtimeSessionContext,
    ) -> InviteLocationFacts {
        let local_game_context = self.local_game_context();
        let closed_locations = self
            .state
            .lock()
            .map(|state| state.automation.invite.closed_locations())
            .unwrap_or_default();
        let current_location = match &local_game_context {
            LocalGameContextSnapshot::Unavailable => String::new(),
            LocalGameContextSnapshot::Available { location, .. } => location.trim().to_string(),
        };
        InviteLocationFacts {
            local_game_context,
            last_location: current_location.clone(),
            current_user_id: session.user_id.clone(),
            closed_locations,
        }
    }

    async fn build_sender_allowlist(
        &self,
        session: &RealtimeSessionContext,
        sender_user_id: &str,
    ) -> Result<SenderAllowlist> {
        // Fetched fresh per evaluation so a newly added favorite is effective
        // immediately; only reached for auto-invite-enabled users on an actual
        // requestInvite, after the cheap config/location/cooldown gates.
        match self.fetch_favorites_snapshot(session).await? {
            Some(snapshot) => Ok(sender_allowlist_from_snapshot(&snapshot, sender_user_id)),
            None => Ok(SenderAllowlist {
                is_favorite: false,
                group_keys_of_sender: HashSet::new(),
            }),
        }
    }

    async fn fetch_favorites_snapshot(
        &self,
        session: &RealtimeSessionContext,
    ) -> Result<Option<Value>> {
        let current_user_snapshot = self
            .current_user_snapshot()
            .unwrap_or_else(|| json!({ "id": session.user_id }));
        let friends_by_id = self
            .friends
            .snapshot()
            .map(|snapshot| snapshot.friends_by_id)
            .unwrap_or_default();
        let output = build_favorites_baseline_from_friend_records(
            SocialBaselineDeps {
                store: Arc::clone(&self.deps.store),
                remote_requests: Arc::clone(&self.deps.remote_requests),
                web: Arc::clone(&self.deps.web),
                auth_scope: self.deps.auth_scope.clone(),
            },
            SocialFavoritesBaselineRequest {
                user_id: session.user_id.clone(),
                endpoint: session.endpoint.clone(),
                current_user_snapshot: RawJson::from(current_user_snapshot),
            },
            &friends_by_id,
        )
        .await?;
        if output.stale {
            return Ok(None);
        }
        Ok(output.snapshot.map(|snapshot| snapshot.into_value()))
    }

    async fn cleanup_invite_request_notification(
        &self,
        mutation: &AuthenticatedMutationContext<'_>,
        facts: &InviteNotificationFacts,
    ) {
        let Ok((_, request)) = self.deps.remote_requests.notification_hide(
            mutation.scope().endpoint.clone(),
            facts.id.clone(),
            facts.version,
            facts.notification_type.clone(),
            facts.sender_user_id.clone(),
        ) else {
            return;
        };
        let mut request = request;
        mutation.apply_scope_to_request(&mut request);
        let result = mutation
            .run_after_wait(INVITE_AUTOMATION_REMOTE_MUTATION_INTERVAL, || async {
                self.deps.web.execute_api(request, ApiScope::Vrchat).await
            })
            .await;
        if let Err(error) = result {
            tracing::warn!("invite automation notification hide failed: {error}");
            return;
        }
        if let Err(error) =
            self.expire_notification(mutation.scope().current_user_id.clone(), facts.id.clone())
        {
            tracing::warn!("invite automation local notification expiration failed: {error}");
        }
        self.deps
            .event_bus
            .emit_realtime_notification_projection(RealtimeNotificationProjection {
                generation: 0,
                expired_ids: vec![facts.id.clone()],
                seen_ids: vec![facts.id.clone()],
                clear_menu_if_no_unseen: true,
                ..RealtimeNotificationProjection::default()
            });
        tracing::debug!(
            notification_id = facts.id,
            notification_type = facts.notification_type,
            "invite automation cleaned notification"
        );
    }

    fn record_invite_automation_skip(&self, reason: InviteAutomationSkipReason) {
        self.deps.sync.record(
            "inviteAutomation",
            RuntimeOperationStatus::Skipped,
            format!("Invite automation skipped: {}.", reason.as_str()),
            0,
        );
    }
}

pub(super) fn notification_type(notification: &Value) -> String {
    json_string_field(notification.get("type"))
}

pub(super) fn notification_facts(notification: &Value) -> InviteNotificationFacts {
    InviteNotificationFacts {
        id: json_string_field(notification.get("id")),
        notification_type: notification_type(notification),
        sender_user_id: json_string_field(notification.get("senderUserId")),
        version: notification.i64_field("version").unwrap_or(1),
    }
}

fn load_invite_automation_config(
    store: &dyn crate::RealtimeStore,
) -> Result<InviteAutomationConfig> {
    let mode =
        normalize_invite_automation_mode(&store.get_string("autoAcceptInviteRequests", "Off")?);
    let groups = store.get_json("autoAcceptInviteGroups", json!([]))?;
    let selected_groups = groups
        .as_array()
        .into_iter()
        .flatten()
        .map(|value| json_string_field(Some(value)))
        .filter(|value| !value.is_empty())
        .collect();
    Ok(InviteAutomationConfig {
        mode,
        selected_groups,
    })
}

fn sender_allowlist_from_snapshot(snapshot: &Value, sender_user_id: &str) -> SenderAllowlist {
    let sender_user_id = sender_user_id.trim();
    let mut group_keys = HashSet::new();
    collect_sender_groups(
        &mut group_keys,
        snapshot.get("groupedFavoriteFriendIdsByGroupKey"),
        "",
        sender_user_id,
    );
    collect_sender_groups(
        &mut group_keys,
        snapshot.get("localFriendFavorites"),
        "local:",
        sender_user_id,
    );
    let is_favorite = json_array_contains_user(snapshot.get("favoriteFriendIds"), sender_user_id);
    SenderAllowlist {
        is_favorite,
        group_keys_of_sender: group_keys,
    }
}

fn collect_sender_groups(
    groups: &mut HashSet<String>,
    value: Option<&Value>,
    key_prefix: &str,
    sender_user_id: &str,
) {
    let Some(object) = value.and_then(Value::as_object) else {
        return;
    };
    for (group_key, user_ids) in object {
        if json_array_contains_user(Some(user_ids), sender_user_id) {
            groups.insert(format!("{key_prefix}{group_key}"));
        }
    }
}

fn json_array_contains_user(value: Option<&Value>, sender_user_id: &str) -> bool {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|value| json_string_field(Some(value)) == sender_user_id)
}
