//! Cohere v2 chat API (`POST /v2/chat`, `GET /v1/models`).
//!
//! The v2 message format is close to OpenAI's (roles, `tool_calls`,
//! `tool_call_id`), so history is passed through mostly as-is. Streaming uses
//! typed SSE events (`content-delta`, `tool-call-start`, `tool-call-delta`).
//! The base URL is the API root, e.g. `https://api.cohere.com`.

use futures_util::StreamExt;
use serde_json::{json, Value};

use super::{
    drain_complete_lines, take_remaining_line, AssistantTurn, ChatMessage, FunctionCall, LlmClient,
    LlmEndpointDetectModelsResult, LlmError, LlmRequestOptions, ToolCall, ToolDefinition,
};

impl LlmClient {
    fn cohere_root(&self) -> &str {
        self.base_url
            .strip_suffix("/v2")
            .or_else(|| self.base_url.strip_suffix("/v1"))
            .unwrap_or(&self.base_url)
    }

    fn cohere_request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        self.with_extra_headers(self.authorized(request))
    }

    pub(super) async fn cohere_list_models(
        &self,
    ) -> Result<LlmEndpointDetectModelsResult, LlmError> {
        let url = format!(
            "{}/v1/models?endpoint=chat&page_size=1000",
            self.cohere_root()
        );
        let response = self
            .cohere_request(self.http.get(&url))
            .timeout(self.request_timeout)
            .send()
            .await?;
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
            message: format!("unexpected /v1/models response: {error}"),
        })?;
        let mut models = payload
            .get("models")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| entry.get("name").and_then(Value::as_str))
            .map(str::to_string)
            .collect::<Vec<_>>();
        models.sort();
        Ok(LlmEndpointDetectModelsResult {
            models,
            model_reasoning: Vec::new(),
        })
    }

    pub(super) async fn cohere_complete_chat(
        &self,
        messages: &[ChatMessage],
        _options: &LlmRequestOptions,
    ) -> Result<String, LlmError> {
        let body = cohere_body(&self.model, messages, &[], false);
        let response = self
            .cohere_request(self.http.post(format!("{}/v2/chat", self.cohere_root())))
            .json(&body)
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
            status: 200,
            message: format!("unexpected /v2/chat response: {error}"),
        })?;
        let content = payload
            .pointer("/message/content")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<String>();
        let content = content.trim().to_string();
        if content.is_empty() {
            return Err(LlmError::Api {
                status: 200,
                message: "unexpected /v2/chat response: missing text content".into(),
            });
        }
        Ok(content)
    }

    pub(super) async fn cohere_stream_chat<F>(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        _options: &LlmRequestOptions,
        mut on_text: F,
    ) -> Result<AssistantTurn, LlmError>
    where
        F: FnMut(&str),
    {
        let body = cohere_body(&self.model, messages, tools, true);
        let response = self
            .cohere_request(self.http.post(format!("{}/v2/chat", self.cohere_root())))
            .json(&body)
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(LlmError::Api { status, message });
        }
        let mut state = CohereStreamState::default();
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

pub(super) fn cohere_body(
    model: &str,
    messages: &[ChatMessage],
    tools: &[ToolDefinition],
    stream: bool,
) -> Value {
    let messages = messages
        .iter()
        .map(|message| {
            let mut entry = json!({ "role": message.role });
            if let Some(content) = &message.content {
                entry["content"] = json!(content);
            }
            if !message.tool_calls.is_empty() {
                entry["tool_calls"] = json!(message
                    .tool_calls
                    .iter()
                    .map(|call| json!({
                        "id": call.id,
                        "type": "function",
                        "function": {
                            "name": call.function.name,
                            "arguments": call.function.arguments,
                        }
                    }))
                    .collect::<Vec<_>>());
            }
            if let Some(tool_call_id) = &message.tool_call_id {
                entry["tool_call_id"] = json!(tool_call_id);
            }
            entry
        })
        .collect::<Vec<_>>();
    let mut body = json!({ "model": model, "messages": messages, "stream": stream });
    if !tools.is_empty() {
        body["tools"] = json!(tools
            .iter()
            .map(|tool| json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                }
            }))
            .collect::<Vec<_>>());
    }
    body
}

#[derive(Default)]
struct PendingCall {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Default)]
struct CohereStreamState {
    content: String,
    calls: Vec<PendingCall>,
}

impl CohereStreamState {
    fn apply_line<F: FnMut(&str)>(&mut self, line: &str, on_text: &mut F) {
        let Some(data) = line.trim_end().strip_prefix("data:") else {
            return;
        };
        let Ok(event) = serde_json::from_str::<Value>(data.trim()) else {
            return;
        };
        match event.get("type").and_then(Value::as_str) {
            Some("content-delta") => {
                if let Some(text) = event
                    .pointer("/delta/message/content/text")
                    .and_then(Value::as_str)
                {
                    if !text.is_empty() {
                        on_text(text);
                        self.content.push_str(text);
                    }
                }
            }
            Some("tool-call-start") => {
                let call = event
                    .pointer("/delta/message/tool_calls")
                    .cloned()
                    .unwrap_or_default();
                self.calls.push(PendingCall {
                    id: text_at(&call, "/id"),
                    name: text_at(&call, "/function/name"),
                    arguments: text_at(&call, "/function/arguments"),
                });
            }
            Some("tool-call-delta") => {
                if let Some(call) = self.calls.last_mut() {
                    call.arguments.push_str(&text_at(
                        &event,
                        "/delta/message/tool_calls/function/arguments",
                    ));
                }
            }
            _ => {}
        }
    }

    fn finish(self) -> AssistantTurn {
        let tool_calls = self
            .calls
            .into_iter()
            .enumerate()
            .filter(|(_, call)| !call.name.is_empty())
            .map(|(index, call)| ToolCall {
                id: if call.id.is_empty() {
                    format!("call_{index}")
                } else {
                    call.id
                },
                kind: "function".into(),
                function: FunctionCall {
                    name: call.name,
                    arguments: if call.arguments.trim().is_empty() {
                        "{}".into()
                    } else {
                        call.arguments
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

fn text_at(value: &Value, pointer: &str) -> String {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assembles_streamed_text_and_tool_calls() {
        let mut state = CohereStreamState::default();
        let mut streamed = String::new();
        for line in [
            r#"data: {"type":"content-delta","delta":{"message":{"content":{"text":"Hi"}}}}"#,
            r#"data: {"type":"tool-call-start","delta":{"message":{"tool_calls":{"id":"tc_1","type":"function","function":{"name":"search","arguments":""}}}}}"#,
            r#"data: {"type":"tool-call-delta","delta":{"message":{"tool_calls":{"function":{"arguments":"{\"q\":\"ada\"}"}}}}}"#,
        ] {
            state.apply_line(line, &mut |text: &str| streamed.push_str(text));
        }
        let turn = state.finish();
        assert_eq!(streamed, "Hi");
        assert_eq!(turn.tool_calls[0].id, "tc_1");
        assert_eq!(turn.tool_calls[0].function.arguments, r#"{"q":"ada"}"#);
    }

    #[test]
    fn passes_tool_history_through() {
        let body = cohere_body("command-a", &[ChatMessage::tool("tc_1", "ok")], &[], false);
        assert_eq!(body["messages"][0]["role"], "tool");
        assert_eq!(body["messages"][0]["tool_call_id"], "tc_1");
    }
}
