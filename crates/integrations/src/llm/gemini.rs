//! Google Gemini API (`models/{model}:generateContent` / `:streamGenerateContent`).
//!
//! Converts the OpenAI-shaped history into `contents` / `parts`: assistant
//! tool calls become `functionCall` parts and tool results become
//! `functionResponse` parts (Gemini keys them by function name, so names are
//! recovered from the earlier tool call ids). Tool schemas are stripped of
//! JSON Schema keywords Gemini rejects.

use futures_util::StreamExt;
use serde_json::{json, Map, Value};

use super::{
    drain_complete_lines, take_remaining_line, AssistantTurn, ChatMessage, FunctionCall, LlmClient,
    LlmEndpointDetectModelsResult, LlmError, LlmRequestOptions, ToolCall, ToolDefinition,
};

const VERTEX_SUGGESTED_MODELS: &[&str] = &[
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
];

fn is_oauth_access_token(value: &str) -> bool {
    value.starts_with("ya29.")
}

impl LlmClient {
    fn gemini_request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let request = if self.api_key.is_empty() {
            request
        } else if self.api_kind == super::LlmApiKind::VertexAi
            && is_oauth_access_token(&self.api_key)
        {
            // Vertex AI with a `gcloud auth print-access-token` OAuth token.
            request.bearer_auth(&self.api_key)
        } else {
            // Gemini API keys, and Vertex AI express-mode API keys.
            request.header("x-goog-api-key", &self.api_key)
        };
        self.with_extra_headers(request)
    }

    /// Vertex AI has no simple model listing for publisher models, so offer the
    /// common Gemini models; any other model id can be typed in manually.
    pub(super) async fn vertex_list_models(
        &self,
    ) -> Result<LlmEndpointDetectModelsResult, LlmError> {
        Ok(LlmEndpointDetectModelsResult {
            models: VERTEX_SUGGESTED_MODELS
                .iter()
                .map(|model| (*model).to_string())
                .collect(),
            model_reasoning: Vec::new(),
        })
    }

    fn gemini_model_path(&self) -> String {
        let model = self.model.trim();
        if model.starts_with("models/") || model.starts_with("tunedModels/") {
            model.to_string()
        } else {
            format!("models/{model}")
        }
    }

    pub(super) async fn gemini_list_models(
        &self,
    ) -> Result<LlmEndpointDetectModelsResult, LlmError> {
        let mut models = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut url = format!("{}/models?pageSize=1000", self.base_url);
            if let Some(token) = &page_token {
                url.push_str("&pageToken=");
                url.push_str(token);
            }
            let response = self.gemini_request(self.http.get(&url)).send().await?;
            let status = response.status();
            let body = response.text().await?;
            if !status.is_success() {
                return Err(LlmError::Api {
                    status: status.as_u16(),
                    message: body,
                });
            }
            let payload: Value = serde_json::from_str(&body).map_err(|error| LlmError::Api {
                status: status.as_u16(),
                message: format!("unexpected /models response: {error}"),
            })?;
            for entry in payload
                .get("models")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let supports_chat = entry
                    .get("supportedGenerationMethods")
                    .and_then(Value::as_array)
                    .is_none_or(|methods| {
                        methods
                            .iter()
                            .any(|method| method.as_str() == Some("generateContent"))
                    });
                if let Some(name) = entry.get("name").and_then(Value::as_str) {
                    if supports_chat {
                        models.push(name.trim_start_matches("models/").to_string());
                    }
                }
            }
            page_token = payload
                .get("nextPageToken")
                .and_then(Value::as_str)
                .filter(|token| !token.is_empty())
                .map(str::to_string);
            if page_token.is_none() {
                break;
            }
        }
        models.sort();
        Ok(LlmEndpointDetectModelsResult {
            models,
            model_reasoning: Vec::new(),
        })
    }

    pub(super) async fn gemini_complete_chat(
        &self,
        messages: &[ChatMessage],
        _options: &LlmRequestOptions,
    ) -> Result<String, LlmError> {
        let body = gemini_body(messages, &[]);
        let url = format!(
            "{}/{}:generateContent",
            self.base_url,
            self.gemini_model_path()
        );
        let response = self
            .gemini_request(self.http.post(url))
            .json(&body)
            .send()
            .await?;
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(LlmError::Api {
                status: status.as_u16(),
                message: text,
            });
        }
        let payload: Value = serde_json::from_str(&text).map_err(|error| LlmError::Api {
            status: 200,
            message: format!("unexpected generateContent response: {error}"),
        })?;
        let mut state = GeminiStreamState::default();
        state.apply_payload(&payload, &mut |_: &str| {});
        let content = state.content.trim().to_string();
        if content.is_empty() {
            return Err(LlmError::Api {
                status: 200,
                message: "unexpected generateContent response: missing text content".into(),
            });
        }
        Ok(content)
    }

    pub(super) async fn gemini_stream_chat<F>(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        _options: &LlmRequestOptions,
        mut on_text: F,
    ) -> Result<AssistantTurn, LlmError>
    where
        F: FnMut(&str),
    {
        let body = gemini_body(messages, tools);
        let url = format!(
            "{}/{}:streamGenerateContent?alt=sse",
            self.base_url,
            self.gemini_model_path()
        );
        let response = self
            .gemini_request(self.http.post(url))
            .json(&body)
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(LlmError::Api { status, message });
        }
        let mut state = GeminiStreamState::default();
        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk?);
            drain_complete_lines(&mut buffer, |line| state.apply_line(line, &mut on_text));
        }
        if let Some(line) = take_remaining_line(&mut buffer) {
            state.apply_line(&line, &mut on_text);
        }
        Ok(state.finish())
    }
}

pub(super) fn gemini_body(messages: &[ChatMessage], tools: &[ToolDefinition]) -> Value {
    let mut system = Vec::new();
    let mut tool_names_by_id = std::collections::HashMap::new();
    let mut contents: Vec<(String, Vec<Value>)> = Vec::new();
    for message in messages {
        let (role, parts) = match message.role.as_str() {
            "system" => {
                if let Some(content) = message.content.as_deref().filter(|text| !text.is_empty()) {
                    system.push(json!({ "text": content }));
                }
                continue;
            }
            "assistant" => {
                let mut parts = Vec::new();
                if let Some(content) = message.content.as_deref().filter(|text| !text.is_empty()) {
                    parts.push(json!({ "text": content }));
                }
                for call in &message.tool_calls {
                    tool_names_by_id.insert(call.id.clone(), call.function.name.clone());
                    let args = serde_json::from_str::<Value>(&call.function.arguments)
                        .ok()
                        .filter(Value::is_object)
                        .unwrap_or_else(|| json!({}));
                    parts.push(json!({
                        "functionCall": { "name": call.function.name, "args": args }
                    }));
                }
                ("model", parts)
            }
            "tool" => {
                let id = message.tool_call_id.clone().unwrap_or_default();
                let name = tool_names_by_id.get(&id).cloned().unwrap_or(id);
                let content = message.content.clone().unwrap_or_default();
                let response = serde_json::from_str::<Value>(&content)
                    .ok()
                    .filter(Value::is_object)
                    .unwrap_or_else(|| json!({ "result": content }));
                (
                    "user",
                    vec![json!({ "functionResponse": { "name": name, "response": response } })],
                )
            }
            _ => (
                "user",
                vec![json!({ "text": message.content.clone().unwrap_or_default() })],
            ),
        };
        if parts.is_empty() {
            continue;
        }
        match contents.last_mut() {
            Some((last_role, last_parts)) if *last_role == role => last_parts.extend(parts),
            _ => contents.push((role.to_string(), parts)),
        }
    }

    let mut body = Map::new();
    body.insert(
        "contents".into(),
        Value::Array(
            contents
                .into_iter()
                .map(|(role, parts)| json!({ "role": role, "parts": parts }))
                .collect(),
        ),
    );
    if !system.is_empty() {
        body.insert("systemInstruction".into(), json!({ "parts": system }));
    }
    if !tools.is_empty() {
        body.insert(
            "tools".into(),
            json!([{
                "functionDeclarations": tools
                    .iter()
                    .map(|tool| json!({
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": sanitize_schema(&tool.parameters),
                    }))
                    .collect::<Vec<_>>()
            }]),
        );
    }
    Value::Object(body)
}

/// Gemini accepts an OpenAPI subset of JSON Schema and rejects some keywords.
fn sanitize_schema(schema: &Value) -> Value {
    match schema {
        Value::Object(map) => Value::Object(
            map.iter()
                .filter(|(key, _)| {
                    !matches!(
                        key.as_str(),
                        "additionalProperties"
                            | "$schema"
                            | "$id"
                            | "$ref"
                            | "$defs"
                            | "definitions"
                    )
                })
                .map(|(key, value)| (key.clone(), sanitize_schema(value)))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(sanitize_schema).collect()),
        other => other.clone(),
    }
}

#[derive(Default)]
struct GeminiStreamState {
    content: String,
    tool_calls: Vec<ToolCall>,
}

impl GeminiStreamState {
    fn apply_line<F: FnMut(&str)>(&mut self, line: &str, on_text: &mut F) {
        let Some(data) = line.trim_end().strip_prefix("data:") else {
            return;
        };
        if let Ok(payload) = serde_json::from_str::<Value>(data.trim()) {
            self.apply_payload(&payload, on_text);
        }
    }

    fn apply_payload<F: FnMut(&str)>(&mut self, payload: &Value, on_text: &mut F) {
        let parts = payload
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|candidates| candidates.first())
            .and_then(|candidate| candidate.pointer("/content/parts"))
            .and_then(Value::as_array);
        for part in parts.into_iter().flatten() {
            if part.get("thought").and_then(Value::as_bool) == Some(true) {
                continue;
            }
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                if !text.is_empty() {
                    on_text(text);
                    self.content.push_str(text);
                }
            }
            if let Some(call) = part.get("functionCall") {
                let name = call
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if name.is_empty() {
                    continue;
                }
                let id = call
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("call_{}", self.tool_calls.len()));
                self.tool_calls.push(ToolCall {
                    id,
                    kind: "function".into(),
                    function: FunctionCall {
                        name,
                        arguments: call
                            .get("args")
                            .cloned()
                            .unwrap_or_else(|| json!({}))
                            .to_string(),
                    },
                });
            }
        }
    }

    fn finish(self) -> AssistantTurn {
        AssistantTurn {
            content: self.content,
            tool_calls: self.tool_calls,
            reasoning_details: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_tool_results_back_to_function_names() {
        let mut assistant = ChatMessage::assistant("");
        assistant.content = None;
        assistant.tool_calls.push(ToolCall {
            id: "call_0".into(),
            kind: "function".into(),
            function: FunctionCall {
                name: "search".into(),
                arguments: r#"{"q":"ada"}"#.into(),
            },
        });
        let messages = vec![
            ChatMessage::system("Be brief"),
            ChatMessage::user("Who is Ada?"),
            assistant,
            ChatMessage::tool("call_0", "not json"),
        ];
        let tools = vec![ToolDefinition {
            name: "search".into(),
            description: "Search".into(),
            parameters: json!({
                "type": "object",
                "additionalProperties": false,
                "properties": { "q": { "type": "string" } }
            }),
        }];

        let body = gemini_body(&messages, &tools);

        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "Be brief");
        assert_eq!(body["contents"][1]["role"], "model");
        assert_eq!(
            body["contents"][1]["parts"][0]["functionCall"]["args"]["q"],
            "ada"
        );
        assert_eq!(
            body["contents"][2]["parts"][0]["functionResponse"]["name"],
            "search"
        );
        assert_eq!(
            body["contents"][2]["parts"][0]["functionResponse"]["response"]["result"],
            "not json"
        );
        assert!(body["tools"][0]["functionDeclarations"][0]["parameters"]
            .get("additionalProperties")
            .is_none());
    }

    #[test]
    fn collects_streamed_text_and_function_calls() {
        let mut state = GeminiStreamState::default();
        let mut streamed = String::new();
        for line in [
            r#"data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}"#,
            r#"data: {"candidates":[{"content":{"parts":[{"text":"lo"},{"functionCall":{"name":"search","args":{"q":"ada"}}}]}}]}"#,
        ] {
            state.apply_line(line, &mut |text: &str| streamed.push_str(text));
        }
        let turn = state.finish();
        assert_eq!(streamed, "Hello");
        assert_eq!(turn.tool_calls[0].function.name, "search");
        assert_eq!(turn.tool_calls[0].function.arguments, r#"{"q":"ada"}"#);
    }
}
