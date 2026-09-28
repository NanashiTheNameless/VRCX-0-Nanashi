//! Ollama native API (`GET /api/tags`, `POST /api/chat` with NDJSON streaming).
//!
//! The base URL is the server root, e.g. `http://localhost:11434` or a LAN
//! host such as `http://192.168.1.20:11434`. A trailing `/api` or `/v1` is
//! tolerated.

use futures_util::StreamExt;
use serde_json::{json, Value};

use super::{
    drain_complete_lines, take_remaining_line, AssistantTurn, ChatMessage, FunctionCall, LlmClient,
    LlmEndpointDetectModelsResult, LlmError, LlmRequestOptions, ToolCall, ToolDefinition,
};

impl LlmClient {
    fn ollama_root(&self) -> &str {
        self.base_url
            .strip_suffix("/api")
            .or_else(|| self.base_url.strip_suffix("/v1"))
            .unwrap_or(&self.base_url)
    }

    fn ollama_request(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        self.with_extra_headers(self.authorized(request))
    }

    pub(super) async fn ollama_list_models(
        &self,
    ) -> Result<LlmEndpointDetectModelsResult, LlmError> {
        let url = format!("{}/api/tags", self.ollama_root());
        let response = self.ollama_request(self.http.get(&url)).send().await?;
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
            message: format!("unexpected /api/tags response: {error}"),
        })?;
        let mut models = payload
            .get("models")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                entry
                    .get("name")
                    .or_else(|| entry.get("model"))
                    .and_then(Value::as_str)
            })
            .map(str::to_string)
            .collect::<Vec<_>>();
        models.sort();
        Ok(LlmEndpointDetectModelsResult {
            models,
            model_reasoning: Vec::new(),
        })
    }

    pub(super) async fn ollama_complete_chat(
        &self,
        messages: &[ChatMessage],
        _options: &LlmRequestOptions,
    ) -> Result<String, LlmError> {
        let body = ollama_body(&self.model, messages, &[], false);
        let response = self
            .ollama_request(self.http.post(format!("{}/api/chat", self.ollama_root())))
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
            message: format!("unexpected /api/chat response: {error}"),
        })?;
        let content = payload
            .pointer("/message/content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if content.is_empty() {
            return Err(LlmError::Api {
                status: 200,
                message: "unexpected /api/chat response: missing message content".into(),
            });
        }
        Ok(content)
    }

    pub(super) async fn ollama_stream_chat<F>(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        _options: &LlmRequestOptions,
        mut on_text: F,
    ) -> Result<AssistantTurn, LlmError>
    where
        F: FnMut(&str),
    {
        let body = ollama_body(&self.model, messages, tools, true);
        let response = self
            .ollama_request(self.http.post(format!("{}/api/chat", self.ollama_root())))
            .json(&body)
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(LlmError::Api { status, message });
        }
        let mut state = OllamaStreamState::default();
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
        Ok(AssistantTurn {
            content: state.content,
            tool_calls: state.tool_calls,
            reasoning_details: Vec::new(),
        })
    }
}

pub(super) fn ollama_body(
    model: &str,
    messages: &[ChatMessage],
    tools: &[ToolDefinition],
    stream: bool,
) -> Value {
    let mut tool_names_by_id = std::collections::HashMap::new();
    let messages = messages
        .iter()
        .map(|message| {
            let mut entry = json!({
                "role": message.role,
                "content": message.content.clone().unwrap_or_default(),
            });
            if !message.tool_calls.is_empty() {
                entry["tool_calls"] = Value::Array(
                    message
                        .tool_calls
                        .iter()
                        .map(|call| {
                            tool_names_by_id.insert(call.id.clone(), call.function.name.clone());
                            let arguments = serde_json::from_str::<Value>(&call.function.arguments)
                                .ok()
                                .filter(Value::is_object)
                                .unwrap_or_else(|| json!({}));
                            json!({
                                "function": { "name": call.function.name, "arguments": arguments }
                            })
                        })
                        .collect(),
                );
            }
            if message.role == "tool" {
                if let Some(name) = message
                    .tool_call_id
                    .as_ref()
                    .and_then(|id| tool_names_by_id.get(id))
                {
                    entry["tool_name"] = json!(name);
                }
            }
            entry
        })
        .collect::<Vec<_>>();
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": stream,
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(
            tools
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.parameters,
                        }
                    })
                })
                .collect(),
        );
    }
    body
}

#[derive(Default)]
struct OllamaStreamState {
    content: String,
    tool_calls: Vec<ToolCall>,
    error: Option<String>,
}

impl OllamaStreamState {
    fn apply_line<F: FnMut(&str)>(&mut self, line: &str, on_text: &mut F) {
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(line) else {
            return;
        };
        if let Some(error) = chunk.get("error").and_then(Value::as_str) {
            self.error = Some(error.to_string());
            return;
        }
        let Some(message) = chunk.get("message") else {
            return;
        };
        if let Some(text) = message.get("content").and_then(Value::as_str) {
            if !text.is_empty() {
                on_text(text);
                self.content.push_str(text);
            }
        }
        for call in message
            .get("tool_calls")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(function) = call.get("function") else {
                continue;
            };
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if name.is_empty() {
                continue;
            }
            let arguments = match function.get("arguments") {
                Some(Value::String(raw)) => raw.clone(),
                Some(value) => value.to_string(),
                None => "{}".into(),
            };
            self.tool_calls.push(ToolCall {
                id: format!("call_{}", self.tool_calls.len()),
                kind: "function".into(),
                function: FunctionCall { name, arguments },
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ndjson_stream_with_tool_calls() {
        let mut state = OllamaStreamState::default();
        let mut streamed = String::new();
        for line in [
            r#"{"message":{"role":"assistant","content":"Hi"},"done":false}"#,
            r#"{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"search","arguments":{"q":"ada"}}}]},"done":false}"#,
            r#"{"message":{"role":"assistant","content":""},"done":true}"#,
        ] {
            state.apply_line(line, &mut |text: &str| streamed.push_str(text));
        }
        assert_eq!(streamed, "Hi");
        assert_eq!(state.tool_calls[0].function.name, "search");
        assert_eq!(state.tool_calls[0].function.arguments, r#"{"q":"ada"}"#);
    }

    #[test]
    fn tool_results_carry_the_tool_name() {
        let mut assistant = ChatMessage::assistant("");
        assistant.tool_calls.push(ToolCall {
            id: "call_0".into(),
            kind: "function".into(),
            function: FunctionCall {
                name: "search".into(),
                arguments: "{}".into(),
            },
        });
        let body = ollama_body(
            "llama3",
            &[assistant, ChatMessage::tool("call_0", "ok")],
            &[],
            true,
        );
        assert_eq!(body["messages"][1]["tool_name"], "search");
        assert_eq!(
            body["messages"][0]["tool_calls"][0]["function"]["arguments"],
            json!({})
        );
    }
}
