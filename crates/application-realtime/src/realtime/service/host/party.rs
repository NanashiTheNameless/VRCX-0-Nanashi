use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use vrcx_0_application_core::{
    AuthenticatedMutationContext, ConfigStore, Error, LocalGameContextSnapshot, Result,
    RuntimeOperationStatus,
};
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatScope};
use vrcx_0_core::location::parse_location;

use crate::realtime::invite_automation::criteria::{
    parse_follow_rules, FollowRule, FOLLOW_LINK_RULES_CONFIG_KEY,
};
use crate::realtime::invite_automation::decision::can_invite_from_location;
use crate::realtime::party::config::{
    normalize_consent_emoji, normalize_consent_hours, parse_parties, Party, BOOP_BACK_EMOJI_ID,
    CONSENT_BOOP_BACK_CONFIG_KEY, CONSENT_EMOJI_CONFIG_KEY, CONSENT_HOURS_CONFIG_KEY,
    CONSENT_STATE_CONFIG_KEY, PARTY_GROUPS_CONFIG_KEY,
};
use crate::realtime::party::consent::{BoopInput, ConsentBook};
use crate::realtime::party::decision::{
    decide_follow, outbound_candidates, FollowAction, FollowTiming, OutboundReason, SelfContext,
};
use crate::realtime::{RealtimeNotificationProjection, RealtimeSessionContext};
use crate::world_enrich::is_meaningful_world_name;

use super::automation::{invite_automation_send_body, notification_type, FollowRuleCheck};
use super::message_dispatch::json_string_field;
use super::RealtimeHostRuntime;

const PARTY_MUTATION_INTERVAL: Duration = Duration::from_millis(250);
/// The game log settles on the new instance a little after VRChat reports
/// the move; waiting avoids inviting people into the previous instance.
const OWN_MOVE_SETTLE_DELAY: Duration = Duration::from_secs(15);
const HTTP_TOO_MANY_REQUESTS: i32 = 429;

/// Serializes read-modify-write of the stored consent book.
static CONSENT_BOOK_LOCK: Mutex<()> = Mutex::new(());

struct PartySettings {
    parties: Vec<Party>,
    follow_rules: Vec<FollowRule>,
    /// Only set while a follow link rule is enabled.
    follow_emoji: Option<String>,
    boop_back: bool,
    consent_hours: i64,
}

fn load_party_settings(config: &dyn ConfigStore) -> Result<PartySettings> {
    let follow_rules =
        parse_follow_rules(&config.get_json(FOLLOW_LINK_RULES_CONFIG_KEY, json!([]))?);
    let follow_emoji = if follow_rules.is_empty() {
        None
    } else {
        normalize_consent_emoji(&config.get_string(CONSENT_EMOJI_CONFIG_KEY, "")?)
    };
    Ok(PartySettings {
        parties: parse_parties(&config.get_json(PARTY_GROUPS_CONFIG_KEY, json!([]))?),
        follow_rules,
        follow_emoji,
        boop_back: config.get_bool(CONSENT_BOOP_BACK_CONFIG_KEY, false)?,
        consent_hours: normalize_consent_hours(
            &config.get_json(CONSENT_HOURS_CONFIG_KEY, Value::Null)?,
        ),
    })
}

fn load_consents(config: &dyn ConfigStore) -> Result<ConsentBook> {
    Ok(ConsentBook::from_json(
        &config.get_json(CONSENT_STATE_CONFIG_KEY, json!({}))?,
    ))
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl RealtimeHostRuntime {
    fn update_consents<T>(&self, update: impl FnOnce(&mut ConsentBook) -> T) -> Result<T> {
        let _guard = CONSENT_BOOK_LOCK
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let config = self.deps.config.as_ref();
        let mut book = load_consents(config)?;
        let before = book.clone();
        let output = update(&mut book);
        if book != before {
            config.set_json(CONSENT_STATE_CONFIG_KEY, &book.to_json())?;
        }
        Ok(output)
    }

    fn party_automation_paused(&self, now_ms: i64) -> bool {
        self.state
            .lock()
            .map(|state| state.automation.invite.is_rate_limited(now_ms))
            .unwrap_or(true)
    }

    async fn run_party_mutation(
        &self,
        session: &RealtimeSessionContext,
        request: VrchatRequest,
        label: &'static str,
    ) -> Result<()> {
        let mutation = AuthenticatedMutationContext::capture(
            &self.deps.auth_scope,
            self.deps.remote_mutations.as_ref(),
            label,
        )?;
        if mutation.scope().current_user_id != session.user_id
            || mutation.scope().endpoint != session.endpoint
        {
            return Err(Error::Custom(format!(
                "{label} authentication scope changed."
            )));
        }
        let mut request = request;
        mutation.apply_scope_to_request(&mut request);
        let response = mutation
            .run_after_wait(PARTY_MUTATION_INTERVAL, || async {
                self.web.execute_api(request, VrchatScope::Vrchat).await
            })
            .await?;
        if response.status == HTTP_TOO_MANY_REQUESTS {
            self.note_invite_automation_rate_limited(now_ms());
        }
        if !(200..=299).contains(&response.status) {
            return Err(Error::Custom(format!(
                "{label} returned HTTP {}",
                response.status
            )));
        }
        Ok(())
    }

    fn record_party(&self, status: RuntimeOperationStatus, message: String) {
        self.deps.sync.record("partyAutomation", status, message, 0);
    }

    // ---- Boops: consent and Stop ----

    pub(super) fn schedule_party_boops(
        self: &Arc<Self>,
        projection: &RealtimeNotificationProjection,
    ) {
        for upsert in projection.upserts.iter().filter(|upsert| {
            upsert.run_automation && notification_type(&upsert.notification) == "boop"
        }) {
            let sender = json_string_field(upsert.notification.get("senderUserId"));
            let emoji = upsert
                .notification
                .get("details")
                .map(|details| json_string_field(details.get("emojiId")))
                .unwrap_or_default();
            if sender.is_empty() || emoji.is_empty() {
                continue;
            }
            let runtime = Arc::clone(self);
            self.deps.tasks.spawn(async move {
                runtime.handle_party_boop(sender, emoji).await;
            });
        }
    }

    async fn handle_party_boop(&self, sender: String, emoji: String) {
        let settings = match load_party_settings(self.deps.config.as_ref()) {
            Ok(settings) => settings,
            Err(error) => {
                tracing::warn!("party consent config read failed: {error}");
                return;
            }
        };
        let now_secs = now_ms() / 1000;
        let effect = match self.update_consents(|book| {
            book.apply_boop(BoopInput {
                sender_user_id: &sender,
                emoji_id: &emoji,
                now: now_secs,
                follow_emoji: settings.follow_emoji.as_deref(),
                parties: &settings.parties,
            })
        }) {
            Ok(effect) => effect,
            Err(error) => {
                tracing::warn!("party consent update failed: {error}");
                return;
            }
        };
        if effect.revoked {
            self.record_party(
                RuntimeOperationStatus::Persisted,
                format!("{sender} booped Stop: automatic invites to them are canceled."),
            );
        }
        if !effect.granted_anything() {
            return;
        }
        self.record_party(
            RuntimeOperationStatus::Persisted,
            format!("{sender} opted in to automatic invites by boop."),
        );
        if settings.boop_back {
            self.send_boop_back(&sender).await;
        }
    }

    async fn send_boop_back(&self, user_id: &str) {
        let now = now_ms();
        let Some(session) = self.active_invite_session() else {
            return;
        };
        let allowed = self
            .state
            .lock()
            .map(|mut state| {
                !state.automation.invite.is_rate_limited(now)
                    && state.automation.party.take_boop_back(now)
            })
            .unwrap_or(false);
        if !allowed {
            return;
        }
        let request = match self.deps.remote_requests.boop_send(
            session.endpoint.clone(),
            user_id.to_string(),
            BOOP_BACK_EMOJI_ID.to_string(),
        ) {
            Ok(request) => request,
            Err(error) => {
                tracing::warn!("party boop back request failed: {error}");
                return;
            }
        };
        if let Err(error) = self
            .run_party_mutation(&session, request, "Party consent boop back")
            .await
        {
            tracing::warn!("party boop back failed: {error}");
        }
    }

    // ---- Following a member who moved ----

    pub(super) fn schedule_party_follow(self: &Arc<Self>, entries: &[FeedLiveEntry]) {
        let moves: Vec<(String, String)> = entries
            .iter()
            .filter_map(|entry| match entry {
                FeedLiveEntry::Gps {
                    user_id, location, ..
                } => Some((user_id.clone(), location.clone())),
                _ => None,
            })
            .collect();
        if moves.is_empty() {
            return;
        }
        let has_parties = self
            .deps
            .config
            .get_json(PARTY_GROUPS_CONFIG_KEY, json!([]))
            .map(|value| !parse_parties(&value).is_empty())
            .unwrap_or(false);
        if !has_parties {
            return;
        }
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            for (mover, location) in moves {
                if let Err(error) = runtime.handle_party_move(&mover, &location).await {
                    tracing::warn!("party follow failed: {error}");
                    runtime
                        .deps
                        .sync
                        .record_failure("partyAutomation", error.to_string());
                }
            }
        });
    }

    async fn handle_party_move(&self, mover: &str, location: &str) -> Result<()> {
        let now = now_ms();
        let Some(session) = self.active_invite_session() else {
            return Ok(());
        };
        if self.party_automation_paused(now) {
            return Ok(());
        }
        let settings = load_party_settings(self.deps.config.as_ref())?;
        let book = load_consents(self.deps.config.as_ref())?;
        let (game_running, own_location, players) = match self.local_game_context() {
            LocalGameContextSnapshot::Available {
                is_game_running,
                location,
                player_user_ids,
                ..
            } => (is_game_running, location, player_user_ids),
            LocalGameContextSnapshot::Unavailable => (false, String::new(), Vec::new()),
        };
        let timing = {
            let state = self
                .state
                .lock()
                .map_err(|error| Error::Custom(error.to_string()))?;
            FollowTiming {
                now_ms: now,
                last_follow_at_ms: state.automation.party.last_follow_at_ms(),
                last_own_move_at_ms: state.automation.party.last_own_move_at_ms(),
                consent_hours: settings.consent_hours,
            }
        };
        let action = decide_follow(
            &settings.parties,
            &book,
            mover,
            location,
            &SelfContext {
                user_id: &session.user_id,
                game_running,
                location: &own_location,
                player_user_ids: &players,
            },
            &timing,
        );
        let request = match &action {
            FollowAction::Skip(reason) => {
                tracing::debug!(mover, reason = reason.as_str(), "party follow skipped");
                return Ok(());
            }
            FollowAction::SelfInvite {
                world_id,
                instance_id,
                ..
            } => Some(self.deps.remote_requests.instance_self_invite(
                session.endpoint.clone(),
                world_id.clone(),
                instance_id.clone(),
            )?),
            FollowAction::RequestInvite { user_id, .. } => Some(
                self.deps
                    .remote_requests
                    .request_invite_send(session.endpoint.clone(), user_id.clone())?,
            ),
            FollowAction::Launch { .. } => None,
        };
        if let Ok(mut state) = self.state.lock() {
            state.automation.party.record_follow(now);
        }
        match (action, request) {
            (FollowAction::Launch { location, .. }, _) => {
                let Some(launcher) = &self.deps.game_launcher else {
                    return Ok(());
                };
                if launcher.launch_into(&location)? {
                    self.record_party(
                        RuntimeOperationStatus::Sent,
                        format!("Launched VRChat to follow {mover}."),
                    );
                }
            }
            (FollowAction::SelfInvite { .. }, Some(request)) => {
                self.run_party_mutation(&session, request, "Party follow self-invite")
                    .await?;
                self.record_party(
                    RuntimeOperationStatus::Sent,
                    format!("Sent you an invite to follow {mover}."),
                );
            }
            (FollowAction::RequestInvite { .. }, Some(request)) => {
                self.run_party_mutation(&session, request, "Party follow request invite")
                    .await?;
                self.record_party(
                    RuntimeOperationStatus::Sent,
                    format!("Asked {mover} for an invite to follow them."),
                );
            }
            _ => {}
        }
        Ok(())
    }

    // ---- Inviting people who opted in, after an own move ----

    pub(super) fn schedule_party_own_move(self: &Arc<Self>) {
        let config = self.deps.config.as_ref();
        let has_parties = config
            .get_json(PARTY_GROUPS_CONFIG_KEY, json!([]))
            .map(|value| !parse_parties(&value).is_empty())
            .unwrap_or(false);
        let has_consents = load_consents(config)
            .map(|book| book.user_ids().next().is_some())
            .unwrap_or(false);
        if !has_parties && !has_consents {
            return;
        }
        let runtime = Arc::clone(self);
        self.deps.tasks.spawn(async move {
            tokio::time::sleep(OWN_MOVE_SETTLE_DELAY).await;
            if let Err(error) = runtime.handle_party_own_move().await {
                tracing::warn!("party outbound invites failed: {error}");
                runtime
                    .deps
                    .sync
                    .record_failure("partyAutomation", error.to_string());
            }
        });
    }

    async fn handle_party_own_move(&self) -> Result<()> {
        let now = now_ms();
        let Some(session) = self.active_invite_session() else {
            return Ok(());
        };
        let LocalGameContextSnapshot::Available {
            is_game_running: true,
            location,
            player_user_ids,
            ..
        } = self.local_game_context()
        else {
            return Ok(());
        };
        let moved = self
            .state
            .lock()
            .map(|mut state| state.automation.party.observe_own_location(&location, now))
            .unwrap_or(false);
        if !moved || self.party_automation_paused(now) {
            return Ok(());
        }
        let location_facts = self.current_invite_location_facts(&session);
        let parsed = parse_location(&location);
        if !can_invite_from_location(&location_facts, &parsed) {
            tracing::debug!("party outbound invites skipped: location not invitable");
            return Ok(());
        }
        let settings = load_party_settings(self.deps.config.as_ref())?;
        let me = SelfContext {
            user_id: &session.user_id,
            game_running: true,
            location: &location,
            player_user_ids: &player_user_ids,
        };
        let candidates = outbound_candidates(
            &settings.parties,
            &load_consents(self.deps.config.as_ref())?,
            settings.follow_emoji.as_deref(),
            &me,
            now / 1000,
            settings.consent_hours,
        );
        let world_name = self
            .world_cache
            .resolve_name(&session.endpoint, &parsed.world_id)
            .await
            .filter(|name| is_meaningful_world_name(name))
            .unwrap_or_else(|| parsed.world_id.clone());

        for candidate in candidates {
            let now = now_ms();
            if self.party_automation_paused(now) {
                break;
            }
            if candidate.reason == OutboundReason::FollowLink {
                match self
                    .check_follow_rules(&session, &candidate.user_id, &settings.follow_rules, now)
                    .await
                    .0
                {
                    FollowRuleCheck::Passed => {}
                    FollowRuleCheck::RateLimited => {
                        self.note_invite_automation_rate_limited(now);
                        break;
                    }
                    FollowRuleCheck::CapReached => break,
                    FollowRuleCheck::NotRun | FollowRuleCheck::Denied => continue,
                }
            }
            // Consent is read again right before sending, so a Stop that
            // arrived meanwhile always wins.
            let still_consents = outbound_candidates(
                &settings.parties,
                &load_consents(self.deps.config.as_ref())?,
                settings.follow_emoji.as_deref(),
                &me,
                now / 1000,
                settings.consent_hours,
            )
            .iter()
            .any(|current| current.user_id == candidate.user_id);
            let still_here = matches!(
                self.local_game_context(),
                LocalGameContextSnapshot::Available { location: ref current, .. } if *current == location
            );
            if !still_here {
                break;
            }
            if !still_consents {
                continue;
            }
            let reserved = self
                .state
                .lock()
                .map(|mut state| {
                    state
                        .automation
                        .party
                        .take_outbound_invite(&candidate.user_id, now)
                })
                .unwrap_or(false);
            if !reserved {
                continue;
            }
            let (_, request) = self.deps.remote_requests.invite_send(
                session.endpoint.clone(),
                candidate.user_id.clone(),
                invite_automation_send_body(&location, &parsed.world_id, &world_name, None),
            )?;
            match self
                .run_party_mutation(&session, request, "Party outbound invite")
                .await
            {
                Ok(()) => {
                    self.update_consents(|book| {
                        book.record_invite(&candidate.user_id, now / 1000)
                    })?;
                    self.record_party(
                        RuntimeOperationStatus::Sent,
                        format!("Invited {} who opted in by boop.", candidate.user_id),
                    );
                }
                Err(error) => {
                    tracing::warn!("party outbound invite failed: {error}");
                    if self.party_automation_paused(now_ms()) {
                        break;
                    }
                }
            }
        }
        Ok(())
    }
}
