//! Anthropic Messages API (`POST /v1/messages`).
//!
//! Converts the OpenAI-shaped [`ChatMessage`] history the assistant keeps into
//! Anthropic's format: system prompts are hoisted into `system`, assistant tool
//! calls become `tool_use` blocks, and tool results become `tool_result`
//! blocks inside a user turn. Consecutive same-role turns are merged because
//! the API requires user/assistant alternation.

use futures_util::StreamExt;
use serde_json::{json, Map, Value};

use super::{
    drain_complete_lines, take_remaining_line, AssistantTurn, ChatMessage, FunctionCall, LlmClient,
    LlmEndpointDetectModelsResult, LlmError, LlmRequestOptions, ToolCall, ToolDefinition,
};

const ANTHROPIC_VERSION: &str = "2023-06-01";
const DEFAULT_MAX_TOKENS: u32 = 8192;

impl LlmClient {
    fn anthropic_request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let request = request.header("anthropic-version", ANTHROPIC_VERSION);
        let request = if self.api_key.is_empty() {
            request
        } else {
            request.header("x-api-key", &self.api_key)
        };
        self.with_extra_headers(request)
    }

    pub(super) async fn anthropic_list_models(
        &self,
    ) -> Result<LlmEndpointDetectModelsResult, LlmError> {
        let url = format!("{}/models?limit=1000", self.base_url);
        let response = self.anthropic_request(self.http.get(&url)).send().await?;
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
        let mut models = payload
            .get("data")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.get("id").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<Vec<_>>();
        models.sort();
        Ok(LlmEndpointDetectModelsResult {
            models,
            model_reasoning: Vec::new(),
        })
    }

    pub(super) async fn anthropic_complete_chat(
        &self,
        messages: &[ChatMessage],
        _options: &LlmRequestOptions,
    ) -> Result<String, LlmError> {
        let body = anthropic_body(&self.model, messages, &[], false);
        let response = self
            .anthropic_request(self.http.post(format!("{}/messages", self.base_url)))
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
            message: format!("unexpected messages response: {error}"),
        })?;
        let content = payload
            .get("content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<String>();
        let content = content.trim().to_string();
        if content.is_empty() {
            return Err(LlmError::Api {
                status: 200,
                message: "unexpected messages response: missing text content".into(),
            });
        }
        Ok(content)
    }

    pub(super) async fn anthropic_stream_chat<F>(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        _options: &LlmRequestOptions,
        mut on_text: F,
    ) -> Result<AssistantTurn, LlmError>
    where
        F: FnMut(&str),
    {
        let body = anthropic_body(&self.model, messages, tools, true);
        let response = self
            .anthropic_request(self.http.post(format!("{}/messages", self.base_url)))
            .json(&body)
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(LlmError::Api { status, message });
        }

        let mut state = AnthropicStreamState::default();
        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk?);
            drain_complete_lines(&mut buffer, |line| state.apply_line(line, &mut on_text));
        }
        if let Some(line) = take_remaining_line(&mut buffer) {
            state.apply_line(&line, &mut on_text);
        }
        if let Some(message) = state.error {
            return Err(LlmError::Api {
                status: 200,
                message,
            });
        }
        Ok(state.finish())
    }
}

pub(super) fn anthropic_body(
    model: &str,
    messages: &[ChatMessage],
    tools: &[ToolDefinition],
    stream: bool,
) -> Value {
    let (system, converted) = convert_messages(messages);
    let mut body = Map::new();
    body.insert("model".into(), json!(model));
    body.insert("max_tokens".into(), json!(DEFAULT_MAX_TOKENS));
    body.insert("messages".into(), Value::Array(converted));
    body.insert("stream".into(), json!(stream));
    if !system.is_empty() {
        body.insert("system".into(), json!(system));
    }
    if !tools.is_empty() {
        body.insert(
            "tools".into(),
            Value::Array(
                tools
                    .iter()
                    .map(|tool| {
                        json!({
                            "name": tool.name,
                            "description": tool.description,
                            "input_schema": tool.parameters,
                        })
                    })
                    .collect(),
            ),
        );
    }
    Value::Object(body)
}

fn convert_messages(messages: &[ChatMessage]) -> (String, Vec<Value>) {
    let mut system = Vec::new();
    let mut turns: Vec<(String, Vec<Value>)> = Vec::new();
    for message in messages {
        let (role, blocks) = match message.role.as_str() {
            "system" => {
                if let Some(content) = message.content.as_deref().filter(|text| !text.is_empty()) {
                    system.push(content.to_string());
                }
                continue;
            }
            "assistant" => {
                let mut blocks = Vec::new();
                if let Some(content) = message.content.as_deref().filter(|text| !text.is_empty()) {
                    blocks.push(json!({ "type": "text", "text": content }));
                }
                for call in &message.tool_calls {
                    let input = serde_json::from_str::<Value>(&call.function.arguments)
                        .ok()
                        .filter(Value::is_object)
                        .unwrap_or_else(|| json!({}));
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.function.name,
                        "input": input,
                    }));
                }
                ("assistant", blocks)
            }
            "tool" => (
                "user",
                vec![json!({
                    "type": "tool_result",
                    "tool_use_id": message.tool_call_id.clone().unwrap_or_default(),
                    "content": message.content.clone().unwrap_or_default(),
                })],
            ),
            _ => (
                "user",
                vec![json!({
                    "type": "text",
                    "text": message.content.clone().unwrap_or_default(),
                })],
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
    let messages = turns
        .into_iter()
        .map(|(role, content)| json!({ "role": role, "content": content }))
        .collect();
    (system.join("\n\n"), messages)
}

#[derive(Default)]
struct PendingToolUse {
    id: String,
    name: String,
    input_json: String,
}

#[derive(Default)]
struct AnthropicStreamState {
    content: String,
    tools: Vec<(usize, PendingToolUse)>,
    error: Option<String>,
}

impl AnthropicStreamState {
    fn apply_line<F: FnMut(&str)>(&mut self, line: &str, on_text: &mut F) {
        let Some(data) = line.trim_end().strip_prefix("data:") else {
            return;
        };
        let Ok(event) = serde_json::from_str::<Value>(data.trim()) else {
            return;
        };
        let index = event
            .get("index")
            .and_then(Value::as_u64)
            .unwrap_or_default() as usize;
        match event.get("type").and_then(Value::as_str) {
            Some("content_block_start") => {
                let block = event.get("content_block").cloned().unwrap_or_default();
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    self.tools.push((
                        index,
                        PendingToolUse {
                            id: string_field(&block, "id"),
                            name: string_field(&block, "name"),
                            input_json: String::new(),
                        },
                    ));
                }
            }
            Some("content_block_delta") => {
                let delta = event.get("delta").cloned().unwrap_or_default();
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        let text = string_field(&delta, "text");
                        if !text.is_empty() {
                            on_text(&text);
                            self.content.push_str(&text);
                        }
                    }
                    Some("input_json_delta") => {
                        if let Some((_, tool)) = self
                            .tools
                            .iter_mut()
                            .find(|(tool_index, _)| *tool_index == index)
                        {
                            tool.input_json
                                .push_str(&string_field(&delta, "partial_json"));
                        }
                    }
                    _ => {}
                }
            }
            Some("error") => {
                self.error = Some(
                    event
                        .get("error")
                        .map(|error| string_field(error, "message"))
                        .filter(|message| !message.is_empty())
                        .unwrap_or_else(|| event.to_string()),
                );
            }
            _ => {}
        }
    }

    fn finish(self) -> AssistantTurn {
        let tool_calls = self
            .tools
            .into_iter()
            .enumerate()
            .filter(|(_, (_, tool))| !tool.name.is_empty())
            .map(|(position, (_, tool))| ToolCall {
                id: if tool.id.is_empty() {
                    format!("call_{position}")
                } else {
                    tool.id
                },
                kind: "function".into(),
                function: FunctionCall {
                    name: tool.name,
                    arguments: if tool.input_json.trim().is_empty() {
                        "{}".into()
                    } else {
                        tool.input_json
                    },
                },
            })
            .collect();
        AssistantTurn {
            content: self.content,
            tool_calls,
            reasoning_details: Vec::new(),
        }
    }
}

fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_history_into_alternating_anthropic_turns() {
        let mut assistant = ChatMessage::assistant("Looking it up");
        assistant.tool_calls.push(ToolCall {
            id: "toolu_1".into(),
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
            ChatMessage::tool("toolu_1", "Ada is a friend"),
            ChatMessage::user("Thanks"),
        ];

        let body = anthropic_body("claude", &messages, &[], true);

        assert_eq!(body["system"], "Be brief");
        let turns = body["messages"].as_array().unwrap();
        assert_eq!(turns.len(), 3);
        assert_eq!(turns[1]["content"][1]["type"], "tool_use");
        assert_eq!(turns[1]["content"][1]["input"]["q"], "ada");
        assert_eq!(turns[2]["role"], "user");
        assert_eq!(turns[2]["content"][0]["type"], "tool_result");
        assert_eq!(turns[2]["content"][1]["text"], "Thanks");
    }

    #[test]
    fn assembles_streamed_text_and_tool_use() {
        let mut state = AnthropicStreamState::default();
        let mut streamed = String::new();
        for line in [
            r#"data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#,
            r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_9","name":"search"}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"q\":"}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"ada\"}"}}"#,
        ] {
            state.apply_line(line, &mut |text: &str| streamed.push_str(text));
        }

        let turn = state.finish();

        assert_eq!(streamed, "Hi");
        assert_eq!(turn.content, "Hi");
        assert_eq!(turn.tool_calls[0].id, "toolu_9");
        assert_eq!(turn.tool_calls[0].function.arguments, r#"{"q":"ada"}"#);
    }
}
