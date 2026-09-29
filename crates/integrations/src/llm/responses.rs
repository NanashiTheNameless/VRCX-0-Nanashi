//! OpenAI Responses API (`POST /v1/responses`).
//!
//! Unlike `/chat/completions`, this API accepts function tools together with a
//! reasoning effort on reasoning models. The assistant keeps its history in the
//! Chat Completions shape, so it is converted here: system prompts become
//! `instructions`, assistant tool calls become `function_call` items and tool
//! results become `function_call_output` items. Requests are stateless
//! (`store: false`), so reasoning items are requested with encrypted content,
//! kept in [`AssistantTurn::reasoning_details`] and sent back before the tool
//! calls they led to, as the API requires.

use futures_util::StreamExt;
use serde_json::{json, Map, Value};

use super::{
    drain_complete_lines, take_remaining_line, AssistantTurn, ChatMessage, FunctionCall, LlmClient,
    LlmError, LlmRequestOptions, ToolCall, ToolDefinition,
};

impl LlmClient {
    pub(super) async fn responses_complete_chat(
        &self,
        messages: &[ChatMessage],
        options: &LlmRequestOptions,
    ) -> Result<String, LlmError> {
        let body = responses_body(&self.model, messages, &[], options, false);
        let response = self
            .responses_request(&body)
            .timeout(self.request_timeout)
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
            status: status.as_u16(),
            message: format!("unexpected /responses reply: {error}"),
        })?;
        let content = output_text(payload.get("output"));
        if content.is_empty() {
            return Err(LlmError::Api {
                status: status.as_u16(),
                message: "response contained no text output".into(),
            });
        }
        Ok(content)
    }

    pub(super) async fn responses_stream_chat<F>(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        options: &LlmRequestOptions,
        mut on_text: F,
    ) -> Result<AssistantTurn, LlmError>
    where
        F: FnMut(&str),
    {
        let body = responses_body(&self.model, messages, tools, options, true);
        let response = self.responses_request(&body).send().await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(LlmError::Api { status, message });
        }

        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut state = ResponsesStreamState::default();
        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk?);
            drain_complete_lines(&mut buffer, |line| state.apply_line(line, &mut on_text));
            if let Some(error) = state.error.take() {
                return Err(error);
            }
        }
        if let Some(line) = take_remaining_line(&mut buffer) {
            state.apply_line(&line, &mut on_text);
        }
        if let Some(error) = state.error.take() {
            return Err(error);
        }
        Ok(state.finish())
    }

    fn responses_request(&self, body: &Value) -> reqwest::RequestBuilder {
        self.with_extra_headers(self.authorized(self.http.post(self.openai_url("/responses"))))
            .json(body)
    }
}

pub(super) fn responses_body(
    model: &str,
    messages: &[ChatMessage],
    tools: &[ToolDefinition],
    options: &LlmRequestOptions,
    stream: bool,
) -> Value {
    let mut instructions = Vec::new();
    let mut input = Vec::new();
    for message in messages {
        match message.role.as_str() {
            "system" | "developer" => {
                if let Some(content) = message.content.as_deref().filter(|text| !text.is_empty()) {
                    instructions.push(content.to_string());
                }
            }
            "tool" => input.push(json!({
                "type": "function_call_output",
                "call_id": message.tool_call_id.clone().unwrap_or_default(),
                "output": message.content.clone().unwrap_or_default(),
            })),
            "assistant" => {
                // Reasoning items must precede the calls they produced.
                input.extend(
                    message
                        .reasoning_details
                        .iter()
                        .filter(|item| {
                            item.get("type").and_then(Value::as_str) == Some("reasoning")
                        })
                        .cloned(),
                );
                if let Some(content) = message.content.as_deref().filter(|text| !text.is_empty()) {
                    input.push(json!({ "role": "assistant", "content": content }));
                }
                for call in &message.tool_calls {
                    input.push(json!({
                        "type": "function_call",
                        "call_id": call.id,
                        "name": call.function.name,
                        "arguments": call.function.arguments,
                    }));
                }
            }
            role => input.push(json!({
                "role": role,
                "content": message.content.clone().unwrap_or_default(),
            })),
        }
    }

    let mut body = Map::new();
    body.insert("model".into(), json!(model));
    body.insert("input".into(), Value::Array(input));
    body.insert("stream".into(), json!(stream));
    body.insert("store".into(), json!(false));
    body.insert("include".into(), json!(["reasoning.encrypted_content"]));
    if !instructions.is_empty() {
        body.insert("instructions".into(), json!(instructions.join("\n\n")));
    }
    if !tools.is_empty() {
        let tools = tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                })
            })
            .collect::<Vec<_>>();
        body.insert("tools".into(), Value::Array(tools));
    }
    if let Some(effort) = options
        .reasoning_effort
        .as_deref()
        .filter(|effort| !effort.is_empty())
    {
        body.insert("reasoning".into(), json!({ "effort": effort }));
    }
    Value::Object(body)
}

/// Concatenated `output_text` parts of every `message` item.
fn output_text(output: Option<&Value>) -> String {
    output
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
        .filter_map(|item| item.get("content").and_then(Value::as_array))
        .flatten()
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("output_text"))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect()
}

#[derive(Default)]
pub(super) struct ResponsesStreamState {
    content: String,
    /// Finished output items, from `response.output_item.done`.
    items: Vec<Value>,
    /// The final `response.output`, used when no item events were seen.
    completed_output: Option<Vec<Value>>,
    pub(super) error: Option<LlmError>,
}

impl ResponsesStreamState {
    pub(super) fn apply_line<F: FnMut(&str)>(&mut self, line: &str, on_text: &mut F) {
        let Some(data) = line.trim_end().strip_prefix("data:") else {
            return;
        };
        let Ok(event) = serde_json::from_str::<Value>(data.trim()) else {
            return;
        };
        match event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "response.output_text.delta" => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                    self.content.push_str(delta);
                    on_text(delta);
                }
            }
            "response.output_item.done" => {
                if let Some(item) = event.get("item") {
                    self.items.push(item.clone());
                }
            }
            "response.completed" => {
                self.completed_output = event
                    .pointer("/response/output")
                    .and_then(Value::as_array)
                    .cloned();
            }
            "response.failed" | "response.incomplete" | "error" => {
                let message = event
                    .pointer("/response/error/message")
                    .or_else(|| event.pointer("/error/message"))
                    .or_else(|| event.get("message"))
                    .or_else(|| event.pointer("/response/incomplete_details/reason"))
                    .and_then(Value::as_str)
                    .unwrap_or("response failed")
                    .to_string();
                self.error = Some(LlmError::Api {
                    status: 200,
                    message,
                });
            }
            _ => {}
        }
    }

    pub(super) fn finish(self) -> AssistantTurn {
        let items = if self.items.is_empty() {
            self.completed_output.unwrap_or_default()
        } else {
            self.items
        };
        let content = if self.content.is_empty() {
            output_text(Some(&Value::Array(items.clone())))
        } else {
            self.content
        };
        let mut tool_calls = Vec::new();
        let mut reasoning_details = Vec::new();
        for item in items {
            match item.get("type").and_then(Value::as_str) {
                Some("function_call") => {
                    let text = |key: &str| {
                        item.get(key)
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string()
                    };
                    let name = text("name");
                    if name.is_empty() {
                        continue;
                    }
                    let call_id = text("call_id");
                    tool_calls.push(ToolCall {
                        id: if call_id.is_empty() {
                            format!("call_{}", tool_calls.len())
                        } else {
                            call_id
                        },
                        kind: "function".into(),
                        function: FunctionCall {
                            name,
                            arguments: text("arguments"),
                        },
                    });
                }
                Some("reasoning") => reasoning_details.push(item),
                _ => {}
            }
        }
        AssistantTurn {
            content,
            tool_calls,
            reasoning_details,
        }
    }
}
