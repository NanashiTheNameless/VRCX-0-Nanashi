use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use vrcx_0_core::OwnerId;

use serde::Serialize;
use specta::Type;
use tokio_util::sync::CancellationToken;
use vrcx_0_application_core::{RuntimeAuthScope, RuntimeEventBus, TaskSupervisor};
use vrcx_0_contracts::llm::{LlmEndpointDetectModelsResult, LlmRequestOptions, ToolDefinition};
use vrcx_0_mcp::{spawn_in_process_tools, InProcessMcpTools, McpRuntime};

use crate::agent::{run_turn, TurnContext};
use crate::choices::PendingChoices;
use crate::client_tools::{client_tool_defs, is_edit_tool, PendingClientRequests};
use crate::config::{should_apply_playbook, PlaybookMode};
use crate::endpoints::{
    resolve_reasoning_effort, AssistantRuntimeSelection, AssistantRuntimeStatus, EndpointStore,
    LlmEndpointDetectModelsInput, LlmEndpointDto, LlmEndpointUpsertInput, LlmTranslateInput,
};

use crate::error::AssistantError;
use crate::events::AssistantEmitter;
use crate::ports::{AssistantConfig, AssistantLlmClientFactory, AssistantSessionPersistence};
use crate::session::{
    random_hex, ActiveTurn, Role, Session, SessionStore, SessionSummary, TurnStatus,
};

pub struct AssistantController {
    endpoints: EndpointStore,
    bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    tools: Arc<InProcessMcpTools>,
    tool_defs: Arc<Vec<ToolDefinition>>,
    sessions: Arc<SessionStore>,
    choices: PendingChoices,
    client_requests: PendingClientRequests,
    auth_scope: RuntimeAuthScope,
    cancels: Arc<Mutex<HashMap<String, (String, CancellationToken)>>>,
}

pub struct AssistantControllerDeps {
    pub config: AssistantConfig,
    pub llm_factory: AssistantLlmClientFactory,
    pub proxy_url: Option<String>,
    pub bus: RuntimeEventBus,
    pub tasks: TaskSupervisor,
    pub mcp_runtime: McpRuntime,
    pub session_persistence: AssistantSessionPersistence,
    pub auth_scope: RuntimeAuthScope,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SendResult {
    pub session_id: String,
    pub turn_id: String,
}

impl AssistantController {
    pub async fn new(deps: AssistantControllerDeps) -> Result<Self, AssistantError> {
        let endpoints = EndpointStore::new(deps.config, deps.llm_factory, deps.proxy_url);
        let tools = Arc::new(spawn_in_process_tools(deps.mcp_runtime).await?);
        let tool_defs = Arc::new(load_tool_defs(&tools).await?);
        Ok(Self {
            endpoints,
            bus: deps.bus,
            tasks: deps.tasks,
            tools,
            tool_defs,
            sessions: Arc::new(SessionStore::with_persistence(deps.session_persistence)),
            choices: PendingChoices::default(),
            client_requests: PendingClientRequests::default(),
            auth_scope: deps.auth_scope,
            cancels: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn endpoint_list(&self) -> Result<Vec<LlmEndpointDto>, AssistantError> {
        self.endpoints.list()
    }

    pub fn endpoint_upsert(
        &self,
        input: LlmEndpointUpsertInput,
    ) -> Result<LlmEndpointDto, AssistantError> {
        self.endpoints.upsert(input)
    }

    pub fn endpoint_delete(&self, id: &str) -> Result<(), AssistantError> {
        self.endpoints.delete(id)
    }

    pub async fn endpoint_detect_models(
        &self,
        input: LlmEndpointDetectModelsInput,
    ) -> Result<LlmEndpointDetectModelsResult, AssistantError> {
        self.endpoints.detect_models(input).await
    }

    pub fn runtime_status(&self) -> Result<AssistantRuntimeStatus, AssistantError> {
        self.endpoints.runtime_status()
    }

    pub fn set_follow_custom_proxy(&self, enabled: bool) -> Result<bool, AssistantError> {
        self.endpoints.set_follow_custom_proxy(enabled)
    }

    pub fn follow_custom_proxy(&self) -> Result<bool, AssistantError> {
        self.endpoints.follow_custom_proxy()
    }

    pub fn assistant_reasoning_effort(&self) -> Result<String, AssistantError> {
        self.endpoints.assistant_reasoning_effort()
    }

    pub fn set_assistant_reasoning_effort(&self, effort: &str) -> Result<String, AssistantError> {
        self.endpoints.set_assistant_reasoning_effort(effort)
    }

    pub fn set_session_runtime(
        &self,
        session_id: &str,
        endpoint_id: Option<String>,
        model: Option<String>,
        allow_edit_requests: bool,
        playbook_mode: PlaybookMode,
    ) -> Result<Session, AssistantError> {
        let selection =
            self.set_default_runtime(endpoint_id, model, allow_edit_requests, playbook_mode)?;
        self.sessions
            .set_runtime(&self.owner_user_id(), session_id, selection)
            .map_err(AssistantError::from)?
            .ok_or(AssistantError::SessionNotFound)
    }

    pub fn set_default_runtime(
        &self,
        endpoint_id: Option<String>,
        model: Option<String>,
        allow_edit_requests: bool,
        playbook_mode: PlaybookMode,
    ) -> Result<AssistantRuntimeSelection, AssistantError> {
        let selection = AssistantRuntimeSelection {
            endpoint_id,
            model,
            allow_edit_requests,
            playbook_mode,
        };
        self.endpoints.set_last_selection(&selection)?;
        Ok(selection)
    }

    pub async fn translate(&self, input: LlmTranslateInput) -> Result<String, AssistantError> {
        self.endpoints.translate(input).await
    }

    /// Fork: plain-language reminder draft for the Reminders page.
    pub async fn draft_reminder(
        &self,
        text: &str,
        now_local: &str,
    ) -> Result<crate::reminder_draft::ReminderDraft, AssistantError> {
        self.endpoints.draft_reminder(text, now_local).await
    }

    pub fn list_sessions(&self) -> Vec<SessionSummary> {
        self.sessions.list(&self.owner_user_id())
    }

    pub fn get_session(&self, session_id: &str) -> Result<Option<Session>, AssistantError> {
        self.sessions
            .get(&self.owner_user_id(), session_id)
            .map_err(AssistantError::from)
    }

    pub fn new_session(&self) -> Session {
        let runtime = self.endpoints.last_selection().unwrap_or_default();
        self.sessions
            .create_session_with_runtime(&self.owner_user_id(), runtime)
    }

    pub fn set_entity_panel_open(&self, session_id: &str, open: bool) {
        if self
            .sessions
            .is_visible_to(session_id, &self.owner_user_id())
        {
            self.sessions.set_entity_panel_open(session_id, open);
        }
    }

    pub fn rename_session(&self, session_id: &str, title: &str) -> Result<(), AssistantError> {
        self.sessions
            .rename(&self.owner_user_id(), session_id, title)
            .map_err(AssistantError::from)
    }

    pub fn set_session_pinned(&self, session_id: &str, pinned: bool) -> Result<(), AssistantError> {
        self.sessions
            .set_pinned(&self.owner_user_id(), session_id, pinned)
            .map_err(AssistantError::from)
    }

    pub fn delete_session(&self, session_id: &str) {
        let owner_user_id = self.owner_user_id();
        if self.sessions.is_visible_to(session_id, &owner_user_id) {
            self.cancel_visible(session_id);
            self.sessions.delete(&owner_user_id, session_id);
        }
    }

    pub fn cancel(&self, session_id: &str) {
        if self
            .sessions
            .is_visible_to(session_id, &self.owner_user_id())
        {
            self.cancel_visible(session_id);
        }
    }

    pub fn answer_client_request(
        &self,
        session_id: &str,
        request_id: &str,
        response: Option<serde_json::Value>,
    ) {
        if self
            .sessions
            .is_visible_to(session_id, &self.owner_user_id())
        {
            self.client_requests
                .answer(session_id, request_id, response);
        }
    }

    pub fn answer_choice(&self, session_id: &str, choice_id: &str, user_id: Option<String>) {
        if self
            .sessions
            .is_visible_to(session_id, &self.owner_user_id())
        {
            self.choices.answer(session_id, choice_id, user_id);
        }
    }

    fn cancel_visible(&self, session_id: &str) {
        if let Some((_, token)) = self.cancels.lock().unwrap().remove(session_id) {
            token.cancel();
        }
    }

    /// Replaces an earlier user message: stops any running turn, drops that
    /// message and everything after it, and sends the new text in its place.
    pub async fn edit_message(
        &self,
        session_id: String,
        user_index: u32,
        text: String,
        locale: Option<String>,
    ) -> Result<SendResult, AssistantError> {
        let owner_user_id = self.owner_user_id();
        if !self.sessions.is_visible_to(&session_id, &owner_user_id) {
            return Err(AssistantError::SessionNotFound);
        }
        self.cancel_visible(&session_id);
        if !self
            .sessions
            .truncate_at_user_message(&owner_user_id, &session_id, user_index as usize)
            .map_err(AssistantError::from)?
        {
            return Err(AssistantError::SessionNotFound);
        }
        self.send_message(Some(session_id), text, locale).await
    }

    pub async fn send_message(
        &self,
        session_id: Option<String>,
        text: String,
        locale: Option<String>,
    ) -> Result<SendResult, AssistantError> {
        let runtime = self.endpoints.last_selection()?;
        let owner_user_id = self.owner_user_id();
        let session = self
            .sessions
            .ensure_session_with_runtime(&owner_user_id, session_id, runtime)
            .map_err(AssistantError::from)?
            .ok_or(AssistantError::SessionNotFound)?;
        let endpoint_id = session
            .endpoint_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or(AssistantError::NotConfigured)?;
        let model = session
            .model
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or(AssistantError::NotConfigured)?;
        let endpoint = self.endpoints.resolve(endpoint_id)?;
        let client = self.endpoints.llm_client(&endpoint, model)?;

        let stored_effort = self
            .endpoints
            .assistant_reasoning_effort()
            .unwrap_or_default();
        let options = LlmRequestOptions {
            reasoning_effort: resolve_reasoning_effort(
                &endpoint.base_url,
                &endpoint.model_reasoning,
                model,
                &stored_effort,
            ),
            forbid_tool_calls: false,
        };

        let tool_defs = visible_tool_defs(&self.tool_defs, session.allow_edit_requests);

        let session_id = session.id.clone();
        let turn_id = format!("turn_{}", random_hex());

        // Record the user message synchronously, before spawning the turn, so a
        // rapid second send can never let a superseded turn's task push it later
        // (which reordered or duplicated messages in history).
        if !self
            .sessions
            .push_message(&session_id, Role::User, text)
            .map_err(AssistantError::from)?
        {
            return Err(AssistantError::SessionNotFound);
        }

        let cancel = CancellationToken::new();
        // Install the new turn as active and swap in its cancel token before
        // tearing down any previous turn, so a superseded turn sees it is no
        // longer current and exits without clobbering this one.
        self.sessions.set_active_turn(
            &session_id,
            Some(ActiveTurn {
                turn_id: turn_id.clone(),
                status: TurnStatus::Running,
            }),
        );
        let previous = self
            .cancels
            .lock()
            .unwrap()
            .insert(session_id.clone(), (turn_id.clone(), cancel.clone()));
        if let Some((_, previous_token)) = previous {
            previous_token.cancel();
        }

        let context = TurnContext {
            tools: Arc::clone(&self.tools),
            sessions: Arc::clone(&self.sessions),
            choices: self.choices.clone(),
            client_requests: self.client_requests.clone(),
            emitter: AssistantEmitter::new(
                self.bus.clone(),
                owner_user_id,
                session_id.clone(),
                turn_id.clone(),
            ),
            client,
            tool_defs,
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            locale,
            cancel,
            apply_playbook: should_apply_playbook(session.playbook_mode, &endpoint.base_url),
            allow_edit_requests: session.allow_edit_requests,
            options,
        };

        let cleanup = CancelCleanup {
            cancels: Arc::clone(&self.cancels),
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
        };
        self.tasks.spawn(async move {
            run_turn(context).await;
            drop(cleanup);
        });

        Ok(SendResult {
            session_id,
            turn_id,
        })
    }

    fn owner_user_id(&self) -> OwnerId {
        OwnerId::new(self.auth_scope.snapshot().current_user_id)
    }
}

/// Edit tools are hidden while the user has turned off edit requests. When
/// shown, every call still waits for the user's approval in the app, so text
/// from other people (a friend's bio, say) cannot make an edit on its own.
fn visible_tool_defs(
    tool_defs: &Arc<Vec<ToolDefinition>>,
    allow_edit_requests: bool,
) -> Arc<Vec<ToolDefinition>> {
    if allow_edit_requests {
        return Arc::clone(tool_defs);
    }
    Arc::new(
        tool_defs
            .iter()
            .filter(|tool| !is_edit_tool(&tool.name))
            .cloned()
            .collect(),
    )
}

async fn load_tool_defs(tools: &InProcessMcpTools) -> Result<Vec<ToolDefinition>, AssistantError> {
    let mut defs: Vec<ToolDefinition> = tools
        .list_tools()
        .await?
        .into_iter()
        .map(|tool| ToolDefinition {
            name: tool.name,
            description: tool.description,
            parameters: provider_safe_parameters(tool.parameters),
        })
        .collect();
    defs.extend(client_tool_defs());
    Ok(defs)
}

/// OpenAI-compatible providers reject an object schema without `properties`
/// (HTTP 400 "object schema missing properties"), which is what an argument-
/// less tool derives to.
fn provider_safe_parameters(mut parameters: serde_json::Value) -> serde_json::Value {
    if let Some(schema) = parameters.as_object_mut() {
        if schema.get("type").and_then(serde_json::Value::as_str) == Some("object") {
            schema
                .entry("properties")
                .or_insert_with(|| serde_json::json!({}));
        }
    }
    parameters
}

/// Removes the per-session cancel token when a turn task finishes, but only if
/// it still owns the slot - a turn superseded by a newer one must not evict the
/// newer turn's token (which would leave the new turn uncancellable).
struct CancelCleanup {
    cancels: Arc<Mutex<HashMap<String, (String, CancellationToken)>>>,
    session_id: String,
    turn_id: String,
}

impl Drop for CancelCleanup {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.cancels.lock() {
            if guard
                .get(&self.session_id)
                .is_some_and(|(turn_id, _)| turn_id == &self.turn_id)
            {
                guard.remove(&self.session_id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argumentless_tool_schemas_gain_empty_properties() {
        assert_eq!(
            provider_safe_parameters(serde_json::json!({"type": "object"})),
            serde_json::json!({"type": "object", "properties": {}})
        );
        let with_properties = serde_json::json!({
            "type": "object",
            "properties": {"id": {"type": "string"}}
        });
        assert_eq!(
            provider_safe_parameters(with_properties.clone()),
            with_properties
        );
    }

    #[test]
    fn edit_tools_stay_hidden_while_edit_requests_are_off() {
        let tool_defs = Arc::new(
            [
                "get_copresence_summary",
                "find_settings",
                "show_in_settings",
                "change_setting",
                "favorite_local",
                "favorite_vrchat",
                "set_friend_note",
                "create_reminder",
                "delete_reminder",
            ]
            .map(|name| crate::test_support::tool_def(name, serde_json::Value::Null))
            .to_vec(),
        );

        let hidden = visible_tool_defs(&tool_defs, false);
        let names: Vec<&str> = hidden.iter().map(|tool| tool.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "get_copresence_summary",
                "find_settings",
                "show_in_settings"
            ]
        );

        let armed = visible_tool_defs(&tool_defs, true);
        assert_eq!(armed.len(), tool_defs.len());
    }

    #[test]
    fn superseded_turn_cleanup_keeps_newer_cancel_token() {
        let cancels: Arc<Mutex<HashMap<String, (String, CancellationToken)>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let first_token = CancellationToken::new();
        let second_token = CancellationToken::new();

        cancels
            .lock()
            .unwrap()
            .insert("session_1".into(), ("turn_a".into(), first_token.clone()));
        let cleanup = CancelCleanup {
            cancels: Arc::clone(&cancels),
            session_id: "session_1".into(),
            turn_id: "turn_a".into(),
        };

        let previous = cancels
            .lock()
            .unwrap()
            .insert("session_1".into(), ("turn_b".into(), second_token.clone()));
        previous.unwrap().1.cancel();
        drop(cleanup);

        let guard = cancels.lock().unwrap();
        let (turn_id, token) = guard.get("session_1").unwrap();
        assert_eq!(turn_id, "turn_b");
        assert!(!token.is_cancelled());
        assert!(first_token.is_cancelled());
    }
}
