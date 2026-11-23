//! Tools the app window answers instead of the MCP server: settings live in
//! the interface, and every edit needs the user's approval there.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::sync::oneshot;
use vrcx_0_contracts::llm::ToolDefinition;

pub(crate) const FIND_SETTINGS: &str = "find_settings";
pub(crate) const READ_DOCS: &str = "read_docs";
pub(crate) const SHOW_IN_SETTINGS: &str = "show_in_settings";
pub(crate) const SHOW_IN_DOCS: &str = "show_in_docs";
pub(crate) const CHANGE_SETTING: &str = "change_setting";
// Fork: VRCX compatibility and profile data, answered by the app window.
pub(crate) const READ_VRCX_WORLD_DATA: &str = "read_vrcx_world_data";
pub(crate) const READ_VRCX_CUSTOM_TAGS: &str = "read_vrcx_custom_tags";
pub(crate) const IMPORT_VRCX_WORLD_DATA: &str = "import_vrcx_world_data";
pub(crate) const MERGE_PROFILE_DATABASE: &str = "merge_profile_database";
pub(crate) const FORGET_VRCX_WORLD_DATA: &str = "forget_vrcx_world_data";
/// Request kind for approving an MCP edit tool before it runs. Not a tool.
pub(crate) const APPROVE_EDIT: &str = "approve_edit";

/// Tools that change the user's data or act for them. Every call waits for the
/// user's approval.
pub(crate) const EDIT_TOOLS: &[&str] = &[
    "favorite_local",
    "favorite_vrchat",
    "favorite_move",
    "set_friend_note",
    "create_reminder",
    "delete_reminder",
    "send_chatbox_message",
    "set_chatbox_afk",
    "update_chatbox",
    CHANGE_SETTING,
    IMPORT_VRCX_WORLD_DATA,
    MERGE_PROFILE_DATABASE,
    FORGET_VRCX_WORLD_DATA,
];

pub(crate) fn is_client_tool(name: &str) -> bool {
    matches!(
        name,
        FIND_SETTINGS
            | READ_DOCS
            | SHOW_IN_DOCS
            | SHOW_IN_SETTINGS
            | CHANGE_SETTING
            | READ_VRCX_WORLD_DATA
            | READ_VRCX_CUSTOM_TAGS
            | IMPORT_VRCX_WORLD_DATA
            | MERGE_PROFILE_DATABASE
            | FORGET_VRCX_WORLD_DATA
    )
}

pub(crate) fn is_edit_tool(name: &str) -> bool {
    EDIT_TOOLS.contains(&name)
}

pub(crate) fn client_tool_defs() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: FIND_SETTINGS.into(),
            description: "Search the app's settings by what they do (words like \"badges\", \
\"overlay timeout\", \"dark theme\"). Returns matching settings with their id, label, \
description, where they are in Settings, current value, the kind of value and allowed \
values, whether you may request a change, and changeBlockedReason when blocked. Clearly \
explain that reason instead of offering a prompt for a blocked setting. Use it before show_in_settings or \
change_setting, and to answer questions about what a setting does."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Words describing the setting. Empty lists the settings tabs."
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: READ_DOCS.into(),
            description: "Read the VRCX-0-Nanashi docs, which ship with the app: a guide to the \
whole app (pages, tools, settings and the features it shares with upstream VRCX-0), what the \
fork changes, install and build notes, telemetry, dates and timezones, the self-hosted \
recorder, security reporting, contributing, the README and the developer notes. Pass `query` \
to search them (returns the best matching sections), `docId` with an optional `section` to \
read one doc or section in full, or nothing to list the docs and their sections. Use it for \
questions about how the app or a feature works, or where a page or button is. Check these \
docs before claiming a feature is absent."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Words to search for." },
                    "docId": { "type": "string", "description": "A docId from the list." },
                    "section": {
                        "type": "string",
                        "description": "A section heading, or its full path as listed."
                    }
                }
            }),
        },
        ToolDefinition {
            name: SHOW_IN_DOCS.into(),
            description: "Open the app's Docs page at a doc, and optionally a section, so the \
user can read it. Use a docId and section from read_docs. The chat closes so the page is \
visible; a card offers the way back."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "docId": { "type": "string" },
                    "section": {
                        "type": "string",
                        "description": "A section heading or path from read_docs."
                    }
                },
                "required": ["docId"]
            }),
        },
        ToolDefinition {
            name: SHOW_IN_SETTINGS.into(),
            description: "Open Settings at a setting or settings card and highlight it, so \
the user can see where it is and change it themselves. Use a settingId or cardId from \
find_settings."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "settingId": { "type": "string" },
                    "cardId": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: CHANGE_SETTING.into(),
            description: "Ask the user to approve changing one setting. The app shows a card \
with the setting, what the change means, the old and new values and where it is in \
Settings, and waits for the user's Allow or Deny in the chat. When the user asks to change \
a supported setting, prefer this tool after find_settings instead of giving manual steps \
or asking for another text confirmation. Only use it when the user asked for the change or \
agreed to it. Returns whether the user approved and the value now in effect."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "settingId": { "type": "string", "description": "Id from find_settings." },
                    "value": { "description": "New value: true or false for an on/off setting, one of the option values for a choice, a number inside the range and in the unit find_settings reported, or text for a text setting (empty text restores the default find_settings describes)." },
                    "reason": {
                        "type": "string",
                        "description": "One plain sentence for the user on what this change does for them."
                    }
                },
                "required": ["settingId", "value", "reason"]
            }),
        },
        ToolDefinition {
            name: READ_VRCX_WORLD_DATA.into(),
            description: "Read Persistent World Info: the values worlds made for VRCX saved \
on this PC. Without worldId, lists the worlds that saved something (with value count, size, \
and whether other worlds may read them) and whether the feature is on. With worldId, returns \
that world's saved keys and values. Read-only."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "worldId": { "type": "string", "description": "A world id from the list." }
                }
            }),
        },
        ToolDefinition {
            name: READ_VRCX_CUSTOM_TAGS.into(),
            description: "Read the custom user tags programs connected over the VRCX IPC pipe \
have set (user id, tag text and color), and whether the pipe is on and how many programs \
are connected. Read-only."
                .into(),
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: IMPORT_VRCX_WORLD_DATA.into(),
            description: "Ask the user to approve importing Persistent World Info that worlds \
saved in VRCX. Without path it reads VRCX's VRCX-WorldData.db from VRCX's data folder; with \
path it reads that file. Values already saved here are kept and the other file is only read. \
An approval card waits for the user's Approve or Decline. Only use it when the user asked \
for the import or agreed to it. Returns how many worlds and values were added."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Optional full path to a world data file. Only files the user picked in a file dialog this session, or inside the app or VRChat data folders, can be read." },
                    "reason": {
                        "type": "string",
                        "description": "One plain sentence for the user on what this does for them."
                    }
                },
                "required": ["reason"]
            }),
        },
        ToolDefinition {
            name: MERGE_PROFILE_DATABASE.into(),
            description: "Ask the user to approve merging another profile's history, notes \
and favorites into this one without changing or deleting anything here. source is \"vrcx\" \
or \"vrcx0\" for that app's data on this PC (settings the user has not set here are added \
too), or \"file\" with path for a VRCX, VRCX-0 or VRCX-0-Nanashi database file (settings are \
not read from a file). A backup of this profile is saved first. An approval card waits for \
the user's Approve or Decline. Only use it when the user asked for the merge or agreed to it."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "source": { "type": "string", "enum": ["vrcx", "vrcx0", "file"] },
                    "path": { "type": "string", "description": "Full path, only for source \"file\". Only files the user picked in a file dialog this session, or inside the app or VRChat data folders, can be read." },
                    "reason": {
                        "type": "string",
                        "description": "One plain sentence for the user on what this does for them."
                    }
                },
                "required": ["source", "reason"]
            }),
        },
        ToolDefinition {
            name: FORGET_VRCX_WORLD_DATA.into(),
            description: "Ask the user to approve deleting everything one world saved \
through Persistent World Info, including its key; the world gets a new key next time. \
This cannot be undone. Use a worldId from read_vrcx_world_data. An approval card waits \
for the user's Approve or Decline. Only use it when the user asked for it."
                .into(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "worldId": { "type": "string", "description": "A world id from read_vrcx_world_data." },
                    "reason": {
                        "type": "string",
                        "description": "One plain sentence for the user on what this does for them."
                    }
                },
                "required": ["worldId", "reason"]
            }),
        },
    ]
}

/// What the user decided on an approval card.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EditDecision {
    Approved,
    Declined,
}

impl EditDecision {
    pub(crate) fn from_response(response: Option<&Value>) -> Self {
        match response
            .and_then(|value| value.get("decision"))
            .and_then(Value::as_str)
        {
            Some("approved") => Self::Approved,
            _ => Self::Declined,
        }
    }
}

type PendingRequest = (String, oneshot::Sender<Option<Value>>);

#[derive(Clone, Default)]
pub(crate) struct PendingClientRequests(Arc<Mutex<HashMap<String, PendingRequest>>>);

impl PendingClientRequests {
    pub(crate) fn register(
        &self,
        request_id: String,
        session_id: String,
    ) -> oneshot::Receiver<Option<Value>> {
        let (sender, receiver) = oneshot::channel();
        self.0
            .lock()
            .unwrap()
            .insert(request_id, (session_id, sender));
        receiver
    }

    pub(crate) fn remove(&self, request_id: &str) {
        self.0.lock().unwrap().remove(request_id);
    }

    pub(crate) fn answer(&self, session_id: &str, request_id: &str, response: Option<Value>) {
        let mut pending = self.0.lock().unwrap();
        if pending
            .get(request_id)
            .is_some_and(|(owner_session, _)| owner_session == session_id)
        {
            if let Some((_, sender)) = pending.remove(request_id) {
                let _ = sender.send(response);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn answer_reaches_only_the_session_that_asked() {
        let pending = PendingClientRequests::default();
        let mut receiver = pending.register("req_1".into(), "session_a".into());
        pending.answer("session_b", "req_1", Some(json!({ "ok": true })));
        assert!(receiver.try_recv().is_err());
        pending.answer("session_a", "req_1", Some(json!({ "ok": true })));
        assert_eq!(receiver.await.unwrap(), Some(json!({ "ok": true })));
    }

    #[test]
    fn anything_but_an_explicit_approval_declines() {
        assert_eq!(
            EditDecision::from_response(Some(&json!({ "decision": "approved" }))),
            EditDecision::Approved
        );
        for response in [
            None,
            Some(json!({})),
            Some(json!({ "decision": "yes" })),
            Some(json!({ "decision": "declined" })),
            Some(json!({ "decision": "approved_all" })),
            Some(json!("approved")),
        ] {
            assert_eq!(
                EditDecision::from_response(response.as_ref()),
                EditDecision::Declined
            );
        }
    }

    #[test]
    fn every_client_tool_has_a_definition_and_edits_need_approval() {
        let names: Vec<String> = client_tool_defs().into_iter().map(|t| t.name).collect();
        for name in &names {
            assert!(is_client_tool(name));
        }
        assert_eq!(names.len(), 10);
        assert!(is_edit_tool(FORGET_VRCX_WORLD_DATA));
        assert!(is_edit_tool(CHANGE_SETTING));
        assert!(is_edit_tool(IMPORT_VRCX_WORLD_DATA));
        assert!(is_edit_tool(MERGE_PROFILE_DATABASE));
        assert!(!is_edit_tool(READ_VRCX_WORLD_DATA));
        assert!(!is_edit_tool(READ_VRCX_CUSTOM_TAGS));
        assert!(is_edit_tool("create_reminder"));
        assert!(is_edit_tool("favorite_move"));
        assert!(is_edit_tool("send_chatbox_message"));
        assert!(!is_edit_tool(FIND_SETTINGS));
        assert!(!is_edit_tool(READ_DOCS));
        assert!(!is_edit_tool(SHOW_IN_SETTINGS));
    }
}
