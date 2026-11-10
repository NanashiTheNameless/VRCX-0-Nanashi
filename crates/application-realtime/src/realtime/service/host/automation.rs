use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use vrcx_0_application_core::RuntimeOperationStatus;

use serde_json::{json, Value};
use vrcx_0_application_core::{
    AuthenticatedMutationContext, ConfigStore, Error, LocalGameContextSnapshot, Result,
};
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatScope};
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::json::RawJson;
use vrcx_0_core::OwnerId;

use crate::realtime::invite_automation::criteria::{
    age_status_from_user_response, evaluate_access_criteria, friend_status_from_response,
    group_membership_from_response, parse_follow_rules, FactNeeds, FollowRule, SenderFacts,
    FOLLOW_LINK_RULES_CONFIG_KEY,
};
use crate::realtime::invite_automation::decision::{
    context_gates, cooldown_gate, evaluate_invite_automation, normalize_invite_automation_mode,
    normalize_invite_message_slot, sender_allowed_by_favorites, CooldownView,
    InviteAutomationConfig, InviteAutomationInput, InviteAutomationMode,
    InviteAutomationSkipReason, InviteDecision, InviteLocationFacts, InviteNotificationFacts,
    SenderAllowlist,
};
use crate::realtime::invite_automation::runtime::{sender_scope_key, InviteOutcome};
use crate::realtime::party::config::{parse_parties, PARTY_GROUPS_CONFIG_KEY};
use crate::realtime::party::decision::party_of_requester;
use crate::realtime::{RealtimeNotificationProjection, RealtimeSessionContext};
use crate::social_baseline::{
    build_favorites_baseline_from_friend_records, SocialBaselineDeps,
    SocialFavoritesBaselineRequest,
};
use crate::world_enrich::is_meaningful_world_name;

use super::message_dispatch::json_string_field;
use super::RealtimeHostRuntime;

const INVITE_AUTOMATION_REMOTE_MUTATION_INTERVAL: Duration = Duration::from_millis(250);
const AUTO_DECLINE_FRIEND_REQUESTS_CONFIG_KEY: &str = "autoDeclineFriendRequests";
const FOLLOW_FACT_FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const HTTP_TOO_MANY_REQUESTS: i32 = 429;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum FollowRuleCheck {
    NotRun,
    Passed,
    Denied,
    CapReached,
    RateLimited,
}

pub(super) struct FriendRequestAutoDecline {
    pub(super) facts: InviteNotificationFacts,
    session: RealtimeSessionContext,
}

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

    pub(super) fn friend_requests_to_auto_decline(
        &self,
        projection: &RealtimeNotificationProjection,
    ) -> Vec<FriendRequestAutoDecline> {
        let enabled = match self
            .deps
            .config
            .get_bool(AUTO_DECLINE_FRIEND_REQUESTS_CONFIG_KEY, false)
        {
            Ok(enabled) => enabled,
            Err(error) => {
                tracing::warn!("friend request auto-decline config read failed: {error}");
                return Vec::new();
            }
        };
        if !enabled {
            return Vec::new();
        }
        let Some(session) = self.active_invite_session() else {
            return Vec::new();
        };
        projection
            .upserts
            .iter()
            .filter(|upsert| {
                upsert.run_automation && notification_type(&upsert.notification) == "friendRequest"
            })
            .filter_map(|upsert| {
                match self.never_met_friend_request(&session, &upsert.notification) {
                    Ok(facts) => facts.map(|facts| FriendRequestAutoDecline {
                        facts,
                        session: session.clone(),
                    }),
                    Err(error) => {
                        tracing::warn!("friend request auto-decline lookup failed: {error}");
                        None
                    }
                }
            })
            .collect()
    }

    fn never_met_friend_request(
        &self,
        session: &RealtimeSessionContext,
        notification: &Value,
    ) -> Result<Option<InviteNotificationFacts>> {
        let facts = notification_facts(notification);
        if facts.id.is_empty() || facts.sender_user_id.is_empty() {
            return Ok(None);
        }
        let sender_display_name = json_string_field(notification.get("senderUsername"));
        let join_count = self.deps.stores.game_log.game_log_join_count(
            &OwnerId::new(session.user_id.clone()),
            &facts.sender_user_id,
            &sender_display_name,
        )?;
        Ok((join_count == 0).then_some(facts))
    }

    pub(super) fn schedule_friend_request_auto_decline(
        self: &Arc<Self>,
        declines: Vec<FriendRequestAutoDecline>,
    ) {
        for decline in declines {
            let runtime = Arc::clone(self);
            self.deps.tasks.spawn(async move {
                if let Err(error) = runtime.decline_friend_request(decline).await {
                    tracing::warn!("friend request auto-decline failed: {error}");
                    runtime
                        .deps
                        .sync
                        .record_failure("friendRequestAutoDecline", error.to_string());
                }
            });
        }
    }

    async fn decline_friend_request(&self, decline: FriendRequestAutoDecline) -> Result<()> {
        let FriendRequestAutoDecline { facts, session } = decline;
        let mutation = AuthenticatedMutationContext::capture(
            &self.deps.auth_scope,
            self.deps.remote_mutations.as_ref(),
            "Friend request auto-decline",
        )?;
        if mutation.scope().current_user_id != session.user_id
            || mutation.scope().endpoint != session.endpoint
        {
            return Err(Error::Custom(
                "Friend request auto-decline authentication scope changed.".into(),
            ));
        }
        self.hide_automation_notification(&mutation, &facts, "friend request auto-decline")
            .await?;
        self.deps.sync.record(
            "friendRequestAutoDecline",
            RuntimeOperationStatus::Sent,
            format!(
                "Auto-declined a friend request from {} who was never met.",
                facts.sender_user_id
            ),
            1,
        );
        Ok(())
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
            Ok(outcome) => *outcome,
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
    ) -> Result<InviteOutcome> {
        let config = load_invite_automation_config(self.deps.config.as_ref())?;
        let location = self.current_invite_location_facts(&session);
        if let Err(reason) = context_gates(&config, &location) {
            self.record_invite_automation_skip(reason);
            return Ok(InviteOutcome::Skipped);
        }
        let (allowlist, rule_check) = self
            .build_sender_allowlist(
                &session,
                &notification_facts.sender_user_id,
                &config,
                now_ms,
            )
            .await?;
        match rule_check {
            FollowRuleCheck::CapReached => {
                self.record_invite_automation_skip(
                    InviteAutomationSkipReason::FollowCheckCapReached,
                );
                return Ok(InviteOutcome::Skipped);
            }
            FollowRuleCheck::RateLimited => {
                self.note_invite_automation_rate_limited(now_ms);
                return Ok(InviteOutcome::Skipped);
            }
            FollowRuleCheck::NotRun | FollowRuleCheck::Passed | FollowRuleCheck::Denied => {}
        }
        let message_slot = config.message_slot;
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
                let denied = rule_check == FollowRuleCheck::Denied
                    && reason == InviteAutomationSkipReason::SenderNotAllowlisted;
                self.record_invite_automation_skip(reason);
                if denied {
                    return Ok(InviteOutcome::Denied);
                }
            }
            return Ok(InviteOutcome::Skipped);
        };

        let latest_location = self.current_invite_location_facts(&session);
        if latest_location.current_location() != instance_id || !latest_location.is_game_running() {
            self.record_invite_automation_skip(
                InviteAutomationSkipReason::MissingCurrentSessionOrLocation,
            );
            return Ok(InviteOutcome::Skipped);
        }
        if latest_location.closed_locations.contains(&instance_id) {
            self.record_invite_automation_skip(
                InviteAutomationSkipReason::CurrentLocationNotInvitable,
            );
            return Ok(InviteOutcome::Skipped);
        }
        let via_follow_rule = rule_check == FollowRuleCheck::Passed;
        if via_follow_rule {
            let budget_left = self
                .state
                .lock()
                .map(|mut state| state.automation.invite.follow_invite_budget_left(now_ms))
                .unwrap_or(false);
            if !budget_left {
                self.record_invite_automation_skip(
                    InviteAutomationSkipReason::FollowInviteCapReached,
                );
                return Ok(InviteOutcome::Skipped);
            }
        }

        let world_name = self
            .world_cache
            .resolve_name(&session.endpoint, &world_id)
            .await
            .filter(|name| is_meaningful_world_name(name))
            .unwrap_or_else(|| world_id.clone());
        let (_, request) = self.deps.remote_requests.invite_send(
            session.endpoint.clone(),
            receiver_user_id.clone(),
            invite_automation_send_body(&instance_id, &world_id, &world_name, message_slot),
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
                self.web.execute_api(request, VrchatScope::Vrchat).await
            })
            .await?;
        if response.status == HTTP_TOO_MANY_REQUESTS {
            self.note_invite_automation_rate_limited(now_ms);
        }
        if !(200..=299).contains(&response.status) {
            return Err(Error::Custom(format!(
                "invite automation send returned HTTP {}",
                response.status
            )));
        }

        if via_follow_rule {
            if let Ok(mut state) = self.state.lock() {
                state.automation.invite.record_follow_invite(now_ms);
            }
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
        Ok(InviteOutcome::Sent)
    }

    pub(super) fn active_invite_session(&self) -> Option<RealtimeSessionContext> {
        self.state.lock().ok().and_then(|state| {
            state
                .connection
                .active_context
                .as_ref()
                .map(|active| active.session.clone())
        })
    }

    pub(super) fn current_invite_location_facts(
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
        let current_user_status = self
            .current_user_snapshot()
            .map(|user| json_string_field(user.get("status")))
            .unwrap_or_default();
        InviteLocationFacts {
            local_game_context,
            last_location: current_location.clone(),
            current_user_id: session.user_id.clone(),
            current_user_status,
            closed_locations,
        }
    }

    async fn build_sender_allowlist(
        &self,
        session: &RealtimeSessionContext,
        sender_user_id: &str,
        config: &InviteAutomationConfig,
        now_ms: i64,
    ) -> Result<(SenderAllowlist, FollowRuleCheck)> {
        // Fetched fresh per evaluation so a newly added favorite is effective
        // immediately; only reached for auto-invite-enabled users on an actual
        // requestInvite, after the cheap config/location/cooldown gates.
        let favorites_snapshot = if config.mode == InviteAutomationMode::Off {
            None
        } else {
            self.fetch_favorites_snapshot(session).await?
        };
        let mut allowlist = match favorites_snapshot {
            Some(snapshot) => sender_allowlist_from_snapshot(&snapshot, sender_user_id),
            None => SenderAllowlist {
                is_favorite: false,
                group_keys_of_sender: HashSet::new(),
                follow_rule_id: None,
                party_id: None,
            },
        };
        if sender_allowed_by_favorites(config, &allowlist) {
            return Ok((allowlist, FollowRuleCheck::NotRun));
        }
        if let Some(party) = party_of_requester(&config.parties, sender_user_id) {
            allowlist.party_id = Some(party.id.clone());
            return Ok((allowlist, FollowRuleCheck::Passed));
        }
        if config.follow_rules.is_empty() {
            return Ok((allowlist, FollowRuleCheck::NotRun));
        }
        let (check, rule_id) = self
            .check_follow_rules(session, sender_user_id, &config.follow_rules, now_ms)
            .await;
        allowlist.follow_rule_id = rule_id;
        Ok((allowlist, check))
    }

    /// Checks a user against the follow link rules with fresh VRChat data,
    /// within the hourly check budget. Returns the first passing rule's id.
    pub(super) async fn check_follow_rules(
        &self,
        session: &RealtimeSessionContext,
        user_id: &str,
        rules: &[FollowRule],
        now_ms: i64,
    ) -> (FollowRuleCheck, Option<String>) {
        if rules.is_empty() {
            return (FollowRuleCheck::NotRun, None);
        }
        let check_allowed = self
            .state
            .lock()
            .map(|mut state| state.automation.invite.take_follow_check(now_ms))
            .unwrap_or(false);
        if !check_allowed {
            return (FollowRuleCheck::CapReached, None);
        }
        let mut needs = FactNeeds::default();
        for rule in rules {
            needs.merge(rule.criteria.needs());
        }
        let Some(facts) = self
            .fetch_sender_facts(&session.endpoint, user_id, &needs)
            .await
        else {
            return (FollowRuleCheck::RateLimited, None);
        };
        let mut denials = Vec::new();
        for rule in rules {
            match evaluate_access_criteria(&rule.criteria, &facts) {
                Ok(()) => return (FollowRuleCheck::Passed, Some(rule.id.clone())),
                Err(reason) => denials.push(reason.as_str()),
            }
        }
        tracing::debug!(user_id, ?denials, "follow link rules denied");
        (FollowRuleCheck::Denied, None)
    }

    /// Reads only what the rules need, through the signed-in user's own
    /// session. Anything that fails stays unknown, which every rule denies.
    /// Returns `None` as soon as VRChat answers 429, without further lookups.
    async fn fetch_sender_facts(
        &self,
        endpoint: &str,
        user_id: &str,
        needs: &FactNeeds,
    ) -> Option<SenderFacts> {
        let mut facts = SenderFacts::default();
        let remote = &self.deps.remote_requests;
        if needs.friend_status {
            if let Ok((_, request)) = remote.friend_status(endpoint.into(), user_id.into()) {
                if let Some((status, body)) = self.fetch_follow_fact(request).await {
                    if status == HTTP_TOO_MANY_REQUESTS {
                        return None;
                    }
                    facts.is_friend = friend_status_from_response(status, &body);
                }
            }
        }
        if needs.user_profile {
            if let Ok((_, request)) = remote.user(endpoint.into(), user_id.into()) {
                if let Some((status, body)) = self.fetch_follow_fact(request).await {
                    if status == HTTP_TOO_MANY_REQUESTS {
                        return None;
                    }
                    facts.age_verification_status =
                        age_status_from_user_response(status, &body, user_id);
                }
            }
        }
        for group_id in &needs.group_ids {
            let membership =
                match remote.group_member(endpoint.into(), group_id.clone(), user_id.into()) {
                    Ok(request) => match self.fetch_follow_fact(request).await {
                        Some((HTTP_TOO_MANY_REQUESTS, _)) => return None,
                        Some((status, body)) => {
                            group_membership_from_response(status, &body, group_id, user_id)
                        }
                        None => None,
                    },
                    Err(_) => None,
                };
            facts.group_memberships.insert(group_id.clone(), membership);
            if membership == Some(true) {
                break;
            }
        }
        Some(facts)
    }

    pub(super) fn note_invite_automation_rate_limited(&self, now_ms: i64) {
        if let Ok(mut state) = self.state.lock() {
            state.automation.invite.note_rate_limited(now_ms);
        }
        self.record_invite_automation_skip(InviteAutomationSkipReason::RateLimitBackoff);
    }

    async fn fetch_follow_fact(&self, request: VrchatRequest) -> Option<(i32, Value)> {
        match tokio::time::timeout(
            FOLLOW_FACT_FETCH_TIMEOUT,
            self.web.execute_api(request, VrchatScope::Vrchat),
        )
        .await
        {
            Ok(Ok(response)) => Some((
                response.status,
                serde_json::from_str(&response.data).unwrap_or(Value::Null),
            )),
            _ => None,
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
                friend_log: Arc::clone(&self.deps.stores.friend_log),
                favorites: Arc::clone(&self.deps.stores.favorites),
                config: Arc::clone(&self.deps.config),
                remote_requests: Arc::clone(&self.deps.remote_requests),
                web: Arc::clone(&self.web),
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
        if let Err(error) = self
            .hide_automation_notification(mutation, facts, "invite automation")
            .await
        {
            tracing::warn!("invite automation notification hide failed: {error}");
        }
    }

    async fn hide_automation_notification(
        &self,
        mutation: &AuthenticatedMutationContext<'_>,
        facts: &InviteNotificationFacts,
        label: &str,
    ) -> Result<()> {
        let (_, request) = self.deps.remote_requests.notification_hide(
            mutation.scope().endpoint.clone(),
            facts.id.clone(),
            facts.version,
            facts.notification_type.clone(),
            facts.sender_user_id.clone(),
        )?;
        let mut request = request;
        mutation.apply_scope_to_request(&mut request);
        mutation
            .run_after_wait(INVITE_AUTOMATION_REMOTE_MUTATION_INTERVAL, || async {
                self.web.execute_api(request, VrchatScope::Vrchat).await
            })
            .await?;
        let projection = RealtimeNotificationProjection {
            generation: 0,
            expired_ids: vec![facts.id.clone()],
            seen_ids: vec![facts.id.clone()],
            clear_menu_if_no_unseen: true,
            ..RealtimeNotificationProjection::default()
        };
        match self.expire_notification(mutation.scope().current_user_id.clone(), facts.id.clone()) {
            Ok(()) => {
                if let Some(observer) = &self.deps.notification_projection_observer {
                    observer.observe_realtime_notification_projection(&projection);
                }
            }
            Err(error) => {
                tracing::warn!("{label} local notification expiration failed: {error}");
            }
        }
        self.deps.event_bus.emit(projection);
        tracing::debug!(
            notification_id = facts.id,
            notification_type = facts.notification_type,
            "{label} cleaned notification"
        );
        Ok(())
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

fn load_invite_automation_config(config: &dyn ConfigStore) -> Result<InviteAutomationConfig> {
    let mode =
        normalize_invite_automation_mode(&config.get_string("autoAcceptInviteRequests", "Off")?);
    Ok(InviteAutomationConfig {
        mode,
        selected_groups: config_string_list(config, "autoAcceptInviteGroups")?,
        allowed_statuses: config_string_list(config, "autoAcceptInviteStatuses")?,
        message_slot: normalize_invite_message_slot(
            &config.get_string("autoAcceptInviteMessageSlot", "")?,
        ),
        follow_rules: parse_follow_rules(
            &config.get_json(FOLLOW_LINK_RULES_CONFIG_KEY, json!([]))?,
        ),
        parties: parse_parties(&config.get_json(PARTY_GROUPS_CONFIG_KEY, json!([]))?),
    })
}

pub(super) fn invite_automation_send_body(
    instance_id: &str,
    world_id: &str,
    world_name: &str,
    message_slot: Option<i32>,
) -> Value {
    let mut body = json!({
        "instanceId": instance_id,
        "worldId": world_id,
        "worldName": world_name,
        "rsvp": true,
    });
    if let Some(message_slot) = message_slot {
        body["messageSlot"] = Value::from(message_slot);
    }
    body
}

fn config_string_list(config: &dyn ConfigStore, key: &str) -> Result<Vec<String>> {
    Ok(config
        .get_json(key, json!([]))?
        .as_array()
        .into_iter()
        .flatten()
        .map(|value| json_string_field(Some(value)))
        .filter(|value| !value.is_empty())
        .collect())
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
        follow_rule_id: None,
        party_id: None,
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

#[cfg(test)]
mod tests;
