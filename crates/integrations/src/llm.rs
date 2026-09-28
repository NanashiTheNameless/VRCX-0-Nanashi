use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{Client, Proxy};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub use vrcx_0_contracts::llm::{
    AssistantTurn, ChatMessage, FunctionCall, LlmApiKind, LlmEndpointDetectModelsResult, LlmHeader,
    LlmModelReasoning, LlmRequestOptions, ToolCall, ToolDefinition,
};

mod anthropic;
mod bedrock;
mod cohere;
mod gemini;
mod ollama;
use vrcx_0_core::proxy::with_remote_dns;

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("LLM transport error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("LLM API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("LLM not configured")]
    NotConfigured,
}

const AZURE_DEFAULT_API_VERSION: &str = "2024-10-21";

const OPENROUTER_REASONING_EFFORTS: &[&str] =
    &["max", "xhigh", "high", "medium", "low", "minimal", "none"];

#[derive(Clone)]
pub struct LlmClient {
    http: Client,
    base_url: String,
    api_key: String,
    model: String,
    api_kind: LlmApiKind,
    headers: Vec<LlmHeader>,
}

#[derive(Serialize)]
struct RequestFunction<'a> {
    name: &'a str,
    description: &'a str,
    parameters: &'a Value,
}

#[derive(Serialize)]
struct RequestTool<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    function: RequestFunction<'a>,
}

#[derive(Serialize)]
struct ReasoningRequest {
    effort: String,
}

#[derive(Serialize)]
struct ChatRequestBody<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<RequestTool<'a>>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<ReasoningRequest>,
    /// OpenAI's top-level form; only sent to turn reasoning off after a rejection.
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning_effort: Option<&'static str>,
}

#[derive(Deserialize)]
struct ChatChunk {
    #[serde(default)]
    choices: Vec<ChunkChoice>,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Deserialize, Default)]
struct ChatCompletionChoice {
    #[serde(default)]
    message: ChatCompletionMessage,
}

#[derive(Deserialize, Default)]
struct ChatCompletionMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize)]
struct ChunkChoice {
    #[serde(default)]
    delta: ChunkDelta,
}

#[derive(Deserialize, Default)]
struct ChunkDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<ChunkToolCall>>,
    #[serde(default)]
    reasoning_details: Option<Vec<Value>>,
}

#[derive(Deserialize)]
struct ChunkToolCall {
    index: usize,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<ChunkFunction>,
}

#[derive(Deserialize)]
struct ChunkFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[derive(Default)]
struct ToolCallAcc {
    id: String,
    name_fragments: Vec<String>,
    argument_fragments: Vec<String>,
}

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    reasoning: Option<Value>,
}

impl LlmClient {
    pub fn new(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
        proxy_url: Option<&str>,
    ) -> Result<Self, LlmError> {
        let mut builder = Client::builder().timeout(Duration::from_secs(180));
        if let Some(proxy_url) = proxy_url {
            builder = builder.proxy(Proxy::all(with_remote_dns(proxy_url).as_ref())?);
        }
        let http = builder.build()?;
        let base_url = base_url.into();
        Ok(Self {
            http,
            base_url: normalize_base_url(&base_url),
            api_key: api_key.into(),
            model: model.into(),
            api_kind: LlmApiKind::OpenaiCompatible,
            headers: Vec::new(),
        })
    }

    /// Select the wire protocol and extra headers for this endpoint.
    pub fn with_api(mut self, api_kind: LlmApiKind, headers: Vec<LlmHeader>) -> Self {
        self.api_kind = api_kind;
        self.headers = headers
            .into_iter()
            .filter(|header| !header.name.trim().is_empty())
            .collect();
        self
    }

    fn with_extra_headers(&self, mut request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        for header in &self.headers {
            request = request.header(header.name.trim(), header.value.as_str());
        }
        request
    }

    /// List the models the configured endpoint advertises (`GET /models`).
    pub async fn list_models(&self) -> Result<LlmEndpointDetectModelsResult, LlmError> {
        match self.api_kind {
            LlmApiKind::OpenaiCompatible => {}
            LlmApiKind::Anthropic => return self.anthropic_list_models().await,
            LlmApiKind::Gemini => return self.gemini_list_models().await,
            LlmApiKind::Ollama => return self.ollama_list_models().await,
            LlmApiKind::Cohere => return self.cohere_list_models().await,
            LlmApiKind::Bedrock => return self.bedrock_list_models().await,
            LlmApiKind::VertexAi => return self.vertex_list_models().await,
            LlmApiKind::AzureOpenai => {
                if let Some(deployment) = self.azure_deployment_name() {
                    return Ok(LlmEndpointDetectModelsResult {
                        models: vec![deployment],
                        model_reasoning: Vec::new(),
                    });
                }
            }
        }
        let url = self.openai_url("/models");
        let response = self
            .with_extra_headers(self.authorized(self.http.get(&url)))
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            tracing::warn!(url = %url, status = %status, body = %message, "assistant: model fetch failed");
            return Err(LlmError::Api {
                status: status.as_u16(),
                message,
            });
        }
        let body = response.text().await?;
        parse_models_response(&body, status.as_u16()).map_err(|error| {
            tracing::warn!(url = %url, error = %error, body = %body, "assistant: model list parse failed");
            error
        })
    }

    /// Apply bearer auth only when a key is configured; local endpoints
    /// (Ollama, LM Studio) accept anonymous requests and reject an empty bearer.
    fn authorized(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.api_key.is_empty() {
            request
        } else if self.api_kind == LlmApiKind::AzureOpenai {
            request.header("api-key", &self.api_key)
        } else {
            request.bearer_auth(&self.api_key)
        }
    }

    /// Build `{base}{path}` for OpenAI-format endpoints. Azure keeps any query
    /// string from the base URL (e.g. `?api-version=...`) after the path and
    /// defaults `api-version` when it is missing.
    fn openai_url(&self, path: &str) -> String {
        let (base, query) = match self.base_url.split_once('?') {
            Some((base, query)) => (base.trim_end_matches('/'), Some(query)),
            None => (self.base_url.as_str(), None),
        };
        let mut url = format!("{base}{path}");
        let mut query = query.unwrap_or_default().to_string();
        if self.api_kind == LlmApiKind::AzureOpenai
            && !base.ends_with("/openai/v1")
            && !query
                .split('&')
                .any(|pair| pair.starts_with("api-version="))
        {
            if !query.is_empty() {
                query.push('&');
            }
            query.push_str("api-version=");
            query.push_str(AZURE_DEFAULT_API_VERSION);
        }
        if !query.is_empty() {
            url.push('?');
            url.push_str(&query);
        }
        url
    }

    /// Azure deployment URLs (`.../openai/deployments/<name>`) name the model.
    fn azure_deployment_name(&self) -> Option<String> {
        let base = self.base_url.split('?').next().unwrap_or_default();
        let (_, rest) = base.split_once("/deployments/")?;
        let name = rest.split('/').next().unwrap_or_default();
        (!name.is_empty()).then(|| name.to_string())
    }

    async fn send_chat_request(
        &self,
        body: &ChatRequestBody<'_>,
    ) -> Result<reqwest::Response, LlmError> {
        Ok(self
            .with_extra_headers(
                self.authorized(self.http.post(self.openai_url("/chat/completions"))),
            )
            .json(body)
            .send()
            .await?)
    }

    /// Request one non-streaming chat completion.
    pub async fn complete_chat(
        &self,
        messages: &[ChatMessage],
        options: &LlmRequestOptions,
    ) -> Result<String, LlmError> {
        match self.api_kind {
            LlmApiKind::OpenaiCompatible => {}
            LlmApiKind::Anthropic => return self.anthropic_complete_chat(messages, options).await,
            LlmApiKind::Gemini => return self.gemini_complete_chat(messages, options).await,
            LlmApiKind::Ollama => return self.ollama_complete_chat(messages, options).await,
            LlmApiKind::Cohere => return self.cohere_complete_chat(messages, options).await,
            LlmApiKind::Bedrock => return self.bedrock_complete_chat(messages, options).await,
            LlmApiKind::VertexAi => return self.gemini_complete_chat(messages, options).await,
            LlmApiKind::AzureOpenai => {}
        }
        let body = ChatRequestBody {
            model: &self.model,
            messages,
            tools: Vec::new(),
            stream: false,
            reasoning: reasoning_request(options),
            reasoning_effort: None,
        };

        let response = self
            .with_extra_headers(
                self.authorized(self.http.post(self.openai_url("/chat/completions"))),
            )
            .json(&body)
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
        parse_chat_completion_content(&body)
    }

    /// Stream one chat completion. `on_text` is called with each content delta
    /// for live UI rendering; the assembled turn (text + tool calls) is returned.
    pub async fn stream_chat<F>(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        options: &LlmRequestOptions,
        mut on_text: F,
    ) -> Result<AssistantTurn, LlmError>
    where
        F: FnMut(&str),
    {
        match self.api_kind {
            LlmApiKind::OpenaiCompatible => {}
            LlmApiKind::Anthropic => {
                return self
                    .anthropic_stream_chat(messages, tools, options, on_text)
                    .await
            }
            LlmApiKind::Gemini => {
                return self
                    .gemini_stream_chat(messages, tools, options, on_text)
                    .await
            }
            LlmApiKind::Ollama => {
                return self
                    .ollama_stream_chat(messages, tools, options, on_text)
                    .await
            }
            LlmApiKind::Cohere => {
                return self
                    .cohere_stream_chat(messages, tools, options, on_text)
                    .await
            }
            LlmApiKind::Bedrock => {
                return self
                    .bedrock_stream_chat(messages, tools, options, on_text)
                    .await
            }
            LlmApiKind::VertexAi => {
                return self
                    .gemini_stream_chat(messages, tools, options, on_text)
                    .await
            }
            LlmApiKind::AzureOpenai => {}
        }
        let request_tools = tools
            .iter()
            .map(|tool| RequestTool {
                kind: "function",
                function: RequestFunction {
                    name: &tool.name,
                    description: &tool.description,
                    parameters: &tool.parameters,
                },
            })
            .collect();
        let mut body = ChatRequestBody {
            model: &self.model,
            messages,
            tools: request_tools,
            stream: true,
            reasoning: reasoning_request(options),
            reasoning_effort: None,
        };

        let mut response = self.send_chat_request(&body).await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            // Some models (e.g. OpenAI reasoning models on /chat/completions)
            // reject a reasoning effort alongside function tools; retry once
            // with reasoning off. Omitting the effort is not enough, since the
            // provider then applies the model's default effort.
            if body.reasoning.is_none() || !is_reasoning_param_rejection(status, &message) {
                return Err(LlmError::Api { status, message });
            }
            tracing::warn!(
                model = %self.model,
                response = %message,
                "assistant: provider rejected reasoning effort; retrying with it off"
            );
            body.reasoning = None;
            body.reasoning_effort = Some("none");
            response = self.send_chat_request(&body).await?;
            if !response.status().is_success() {
                let status = response.status().as_u16();
                let message = response.text().await.unwrap_or_default();
                return Err(LlmError::Api { status, message });
            }
        }

        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut content = String::new();
        let mut tool_acc: Vec<ToolCallAcc> = Vec::new();
        let mut reasoning_details = Vec::new();

        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk?);
            drain_complete_lines(&mut buffer, |line| {
                apply_chat_stream_line(
                    line,
                    &mut on_text,
                    &mut content,
                    &mut tool_acc,
                    &mut reasoning_details,
                );
            });
        }
        if let Some(line) = take_remaining_line(&mut buffer) {
            apply_chat_stream_line(
                &line,
                &mut on_text,
                &mut content,
                &mut tool_acc,
                &mut reasoning_details,
            );
        }

        let tool_names = tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();
        let tool_calls = tool_acc
            .into_iter()
            .enumerate()
            .filter_map(|(index, acc)| {
                let name = assemble_tool_name(&acc.name_fragments, &tool_names);
                if name.is_empty() {
                    return None;
                }
                Some(ToolCall {
                    // Some local models omit the id; fall back to the index (not the
                    // name) so two calls to the same tool keep distinct ids.
                    id: if acc.id.is_empty() {
                        format!("call_{index}")
                    } else {
                        acc.id
                    },
                    kind: "function".into(),
                    function: FunctionCall {
                        name,
                        arguments: assemble_tool_arguments(&acc.argument_fragments),
                    },
                })
            })
            .collect();

        Ok(AssistantTurn {
            content,
            tool_calls,
            reasoning_details,
        })
    }
}

fn parse_models_response(
    body: &str,
    status: u16,
) -> Result<LlmEndpointDetectModelsResult, LlmError> {
    let payload: ModelsResponse = serde_json::from_str(body).map_err(|error| LlmError::Api {
        status,
        message: format!("unexpected /models response: {error}"),
    })?;
    let mut models = Vec::new();
    let mut model_reasoning = Vec::new();
    for entry in payload.data {
        let Some(id) = entry.id else {
            continue;
        };
        models.push(id.clone());
        let Some(reasoning) = entry.reasoning.as_ref().and_then(Value::as_object) else {
            continue;
        };
        let supported_efforts = match reasoning.get("supported_efforts") {
            Some(Value::Array(efforts)) => efforts
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>(),
            Some(Value::Null) => OPENROUTER_REASONING_EFFORTS
                .iter()
                .map(|effort| (*effort).to_string())
                .collect(),
            _ => continue,
        };
        if supported_efforts.is_empty() {
            continue;
        }
        model_reasoning.push(LlmModelReasoning {
            model_id: id,
            supported_efforts,
            mandatory: reasoning
                .get("mandatory")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
    }
    models.sort();
    Ok(LlmEndpointDetectModelsResult {
        models,
        model_reasoning,
    })
}

/// A 400 whose error names the reasoning parameter, e.g. OpenAI's
/// `"param": "reasoning_effort"` for models that disallow it with tools.
fn is_reasoning_param_rejection(status: u16, body: &str) -> bool {
    if status != 400 {
        return false;
    }
    let param = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|payload| payload.pointer("/error/param")?.as_str().map(str::to_owned));
    match param {
        Some(param) => param.starts_with("reasoning"),
        None => body.to_ascii_lowercase().contains("reasoning_effort"),
    }
}

fn reasoning_request(options: &LlmRequestOptions) -> Option<ReasoningRequest> {
    options
        .reasoning_effort
        .as_ref()
        .filter(|value| !value.is_empty())
        .map(|effort| ReasoningRequest {
            effort: effort.clone(),
        })
}

fn apply_chat_stream_line<F>(
    line: &str,
    on_text: &mut F,
    content: &mut String,
    tool_acc: &mut Vec<ToolCallAcc>,
    reasoning_details: &mut Vec<Value>,
) where
    F: FnMut(&str),
{
    let Some(data) = line.trim_end().strip_prefix("data:") else {
        return;
    };
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return;
    }
    let Ok(parsed) = serde_json::from_str::<ChatChunk>(data) else {
        return;
    };
    for choice in parsed.choices {
        if let Some(text) = choice.delta.content {
            if !text.is_empty() {
                on_text(&text);
                content.push_str(&text);
            }
        }
        if let Some(details) = choice.delta.reasoning_details {
            reasoning_details.extend(details);
        }
        if let Some(calls) = choice.delta.tool_calls {
            for call in calls {
                if tool_acc.len() <= call.index {
                    tool_acc.resize_with(call.index + 1, ToolCallAcc::default);
                }
                let acc = &mut tool_acc[call.index];
                if let Some(id) = call.id {
                    acc.id = id;
                }
                if let Some(function) = call.function {
                    if let Some(name) = function.name {
                        acc.name_fragments.push(name);
                    }
                    if let Some(arguments) = function.arguments {
                        acc.argument_fragments.push(arguments);
                    }
                }
            }
        }
    }
}

fn assemble_tool_name(fragments: &[String], tool_names: &[&str]) -> String {
    let concatenated = fragments.concat();
    if tool_names.contains(&concatenated.as_str()) {
        return concatenated;
    }
    if let Some(name) = fragments
        .last()
        .filter(|name| tool_names.contains(&name.as_str()))
    {
        return name.clone();
    }
    let cumulative = merge_cumulative_fragments(fragments);
    if tool_names.contains(&cumulative.as_str()) {
        cumulative
    } else {
        concatenated
    }
}

fn assemble_tool_arguments(fragments: &[String]) -> String {
    let concatenated = fragments.concat();
    if is_json_object(&concatenated) {
        return concatenated;
    }
    if let Some(snapshot) = fragments.last().filter(|value| is_json_object(value)) {
        return snapshot.clone();
    }
    let cumulative = merge_cumulative_fragments(fragments);
    if is_json_object(&cumulative) {
        cumulative
    } else {
        concatenated
    }
}

fn merge_cumulative_fragments(fragments: &[String]) -> String {
    let mut cumulative = String::new();
    for fragment in fragments {
        if fragment == &cumulative || cumulative.ends_with(fragment) {
            continue;
        }
        if fragment.starts_with(&cumulative) {
            cumulative.clear();
        }
        cumulative.push_str(fragment);
    }
    cumulative
}

fn is_json_object(value: &str) -> bool {
    matches!(serde_json::from_str::<Value>(value), Ok(Value::Object(_)))
}

fn normalize_base_url(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

fn parse_chat_completion_content(body: &str) -> Result<String, LlmError> {
    let payload: ChatCompletionResponse =
        serde_json::from_str(body).map_err(|error| LlmError::Api {
            status: 200,
            message: format!("unexpected chat completion response: {error}"),
        })?;
    let Some(content) = payload
        .choices
        .into_iter()
        .find_map(|choice| choice.message.content)
    else {
        return Err(LlmError::Api {
            status: 200,
            message: "unexpected chat completion response: missing message content".into(),
        });
    };
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err(LlmError::Api {
            status: 200,
            message: "unexpected chat completion response: missing message content".into(),
        });
    }
    Ok(content)
}

fn drain_complete_lines(buffer: &mut Vec<u8>, mut handle_line: impl FnMut(&str)) {
    let Some(last_newline) = buffer.iter().rposition(|&byte| byte == b'\n') else {
        return;
    };
    let consumed = last_newline + 1;
    for line in buffer[..consumed].split_inclusive(|&byte| byte == b'\n') {
        let line = String::from_utf8_lossy(line);
        handle_line(line.as_ref());
    }
    buffer.drain(..consumed);
}

fn take_remaining_line(buffer: &mut Vec<u8>) -> Option<String> {
    if buffer.is_empty() {
        return None;
    }
    let remaining = std::mem::take(buffer);
    Some(
        String::from_utf8(remaining)
            .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned()),
    )
}

#[cfg(test)]
mod tests;
