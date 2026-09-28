//! Amazon Bedrock Converse API (`POST /model/{modelId}/converse`).
//!
//! Authenticates with a Bedrock API key sent as a bearer token (no SigV4).
//! The base URL is the runtime endpoint, e.g.
//! `https://bedrock-runtime.us-east-1.amazonaws.com`. `converse-stream` uses
//! AWS binary event-stream framing, so streaming requests are served by one
//! `converse` call and the reply is emitted as a single text chunk.

use serde_json::{json, Map, Value};

use super::{
    AssistantTurn, ChatMessage, FunctionCall, LlmClient, LlmEndpointDetectModelsResult, LlmError,
    LlmRequestOptions, ToolCall, ToolDefinition,
};

impl LlmClient {
    fn bedrock_request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        self.with_extra_headers(self.authorized(request))
    }

    /// Control-plane host for listing models: `bedrock-runtime.` -> `bedrock.`.
    fn bedrock_control_plane(&self) -> String {
        self.base_url
            .replacen("://bedrock-runtime.", "://bedrock.", 1)
    }

    pub(super) async fn bedrock_list_models(
        &self,
    ) -> Result<LlmEndpointDetectModelsResult, LlmError> {
        let root = self.bedrock_control_plane();
        let url = format!("{root}/foundation-models?byOutputModality=TEXT");
        let response = self.bedrock_request(self.http.get(&url)).send().await?;
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
            message: format!("unexpected foundation-models response: {error}"),
        })?;
        let mut models = payload
            .get("modelSummaries")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.get("modelId").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<Vec<_>>();
        // Newer models are only invocable through cross-region inference profiles.
        if let Ok(response) = self
            .bedrock_request(
                self.http
                    .get(format!("{root}/inference-profiles?maxResults=1000")),
            )
            .send()
            .await
        {
            if let Ok(profiles) = response.json::<Value>().await {
                models.extend(
                    profiles
                        .get("inferenceProfileSummaries")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(|entry| entry.get("inferenceProfileId").and_then(Value::as_str))
                        .map(str::to_string),
                );
            }
        }
        models.sort();
        models.dedup();
        Ok(LlmEndpointDetectModelsResult {
            models,
            model_reasoning: Vec::new(),
        })
    }

    async fn bedrock_converse(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
    ) -> Result<AssistantTurn, LlmError> {
        let url = format!(
            "{}/model/{}/converse",
            self.base_url,
            encode_path_segment(&self.model)
        );
        let response = self
            .bedrock_request(self.http.post(url))
            .json(&bedrock_body(messages, tools))
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
            message: format!("unexpected converse response: {error}"),
        })?;
        Ok(parse_converse_output(&payload))
    }

    pub(super) async fn bedrock_complete_chat(
        &self,
        messages: &[ChatMessage],
        _options: &LlmRequestOptions,
    ) -> Result<String, LlmError> {
        let turn = self.bedrock_converse(messages, &[]).await?;
        let content = turn.content.trim().to_string();
        if content.is_empty() {
            return Err(LlmError::Api {
                status: 200,
                message: "unexpected converse response: missing text content".into(),
            });
        }
        Ok(content)
    }

    pub(super) async fn bedrock_stream_chat<F>(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        _options: &LlmRequestOptions,
        mut on_text: F,
    ) -> Result<AssistantTurn, LlmError>
    where
        F: FnMut(&str),
    {
        let turn = self.bedrock_converse(messages, tools).await?;
        if !turn.content.is_empty() {
            on_text(&turn.content);
        }
        Ok(turn)
    }
}

fn encode_path_segment(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

pub(super) fn bedrock_body(messages: &[ChatMessage], tools: &[ToolDefinition]) -> Value {
    let mut system = Vec::new();
    let mut turns: Vec<(String, Vec<Value>)> = Vec::new();
    for message in messages {
        let (role, blocks) = match message.role.as_str() {
            "system" => {
                if let Some(content) = message.content.as_deref().filter(|text| !text.is_empty()) {
                    system.push(json!({ "text": content }));
                }
                continue;
            }
            "assistant" => {
                let mut blocks = Vec::new();
                if let Some(content) = message.content.as_deref().filter(|text| !text.is_empty()) {
                    blocks.push(json!({ "text": content }));
                }
                for call in &message.tool_calls {
                    let input = serde_json::from_str::<Value>(&call.function.arguments)
                        .ok()
                        .filter(Value::is_object)
                        .unwrap_or_else(|| json!({}));
                    blocks.push(json!({
                        "toolUse": {
                            "toolUseId": call.id,
                            "name": call.function.name,
                            "input": input,
                        }
                    }));
                }
                ("assistant", blocks)
            }
            "tool" => (
                "user",
                vec![json!({
                    "toolResult": {
                        "toolUseId": message.tool_call_id.clone().unwrap_or_default(),
                        "content": [{ "text": message.content.clone().unwrap_or_default() }],
                    }
                })],
            ),
            _ => (
                "user",
                vec![json!({ "text": message.content.clone().unwrap_or_default() })],
            ),
        };
        if blocks.is_empty() {
            continue;
        }
        match turns.last_mut() {
            Some((last_role, last_blocks)) if last_role == role => last_blocks.extend(blocks),
            _ => turns.push((role.to_string(), blocks)),
        }
    }
    let mut body = Map::new();
    body.insert(
        "messages".into(),
        Value::Array(
            turns
                .into_iter()
                .map(|(role, content)| json!({ "role": role, "content": content }))
                .collect(),
        ),
    );
    if !system.is_empty() {
        body.insert("system".into(), Value::Array(system));
    }
    if !tools.is_empty() {
        body.insert(
            "toolConfig".into(),
            json!({
                "tools": tools
                    .iter()
                    .map(|tool| json!({
                        "toolSpec": {
                            "name": tool.name,
                            "description": tool.description,
                            "inputSchema": { "json": tool.parameters },
                        }
                    }))
                    .collect::<Vec<_>>()
            }),
        );
    }
    Value::Object(body)
}

fn parse_converse_output(payload: &Value) -> AssistantTurn {
    let mut content = String::new();
    let mut tool_calls = Vec::new();
    for block in payload
        .pointer("/output/message/content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(text) = block.get("text").and_then(Value::as_str) {
            content.push_str(text);
        }
        if let Some(tool_use) = block.get("toolUse") {
            let name = tool_use
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if name.is_empty() {
                continue;
            }
            tool_calls.push(ToolCall {
                id: tool_use
                    .get("toolUseId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("call_{}", tool_calls.len())),
                kind: "function".into(),
                function: FunctionCall {
                    name,
                    arguments: tool_use
                        .get("input")
                        .cloned()
                        .unwrap_or_else(|| json!({}))
                        .to_string(),
                },
            });
        }
    }
    AssistantTurn {
        content,
        tool_calls,
        reasoning_details: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_converse_body_with_tool_history() {
        let mut assistant = ChatMessage::assistant("");
        assistant.content = None;
        assistant.tool_calls.push(ToolCall {
            id: "tu_1".into(),
            kind: "function".into(),
            function: FunctionCall {
                name: "search".into(),
                arguments: r#"{"q":"ada"}"#.into(),
            },
        });
        let body = bedrock_body(
            &[
                ChatMessage::system("Be brief"),
                ChatMessage::user("Who?"),
                assistant,
                ChatMessage::tool("tu_1", "Ada"),
            ],
            &[],
        );
        assert_eq!(body["system"][0]["text"], "Be brief");
        assert_eq!(
            body["messages"][1]["content"][0]["toolUse"]["input"]["q"],
            "ada"
        );
        assert_eq!(
            body["messages"][2]["content"][0]["toolResult"]["toolUseId"],
            "tu_1"
        );
    }

    #[test]
    fn parses_text_and_tool_use_output() {
        let turn = parse_converse_output(&json!({
            "output": { "message": { "content": [
                { "text": "Checking" },
                { "toolUse": { "toolUseId": "tu_2", "name": "search", "input": { "q": "x" } } }
            ] } }
        }));
        assert_eq!(turn.content, "Checking");
        assert_eq!(turn.tool_calls[0].id, "tu_2");
        assert_eq!(turn.tool_calls[0].function.arguments, r#"{"q":"x"}"#);
    }

    #[test]
    fn encodes_model_ids_with_colons() {
        assert_eq!(
            encode_path_segment("anthropic.claude-3-haiku-20240307-v1:0"),
            "anthropic.claude-3-haiku-20240307-v1%3A0"
        );
    }
}
