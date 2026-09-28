use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelReasoning {
    pub model_id: String,
    pub supported_efforts: Vec<String>,
    pub mandatory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmEndpointDetectModelsResult {
    pub models: Vec<String>,
    pub model_reasoning: Vec<LlmModelReasoning>,
}

/// Wire protocol spoken by an LLM endpoint. Providers are grouped by API
/// family rather than vendor; `OpenaiCompatible` covers OpenAI, OpenRouter,
/// Groq, Together, vLLM, LM Studio, llama.cpp, Ollama's `/v1`, and similar.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LlmApiKind {
    #[default]
    OpenaiCompatible,
    Anthropic,
    Gemini,
    Ollama,
    /// Azure OpenAI: OpenAI format, `api-key` header, `api-version` query.
    AzureOpenai,
    /// Cohere v2 chat (`POST /v2/chat`).
    Cohere,
    /// Amazon Bedrock Converse API with a Bedrock API key (bearer token).
    Bedrock,
    /// Google Vertex AI (Gemini request format, project/location URLs).
    VertexAi,
    /// OpenAI Responses API (`POST /responses`): function tools with a
    /// reasoning effort, which `/chat/completions` rejects on newer models.
    OpenaiResponses,
}

/// Extra HTTP header sent with every request to an endpoint (custom gateways).
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Default)]
pub struct LlmRequestOptions {
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub reasoning_details: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self::text("system", content)
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::text("user", content)
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self::text("assistant", content)
    }

    pub fn tool(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: "tool".into(),
            content: Some(content.into()),
            tool_calls: Vec::new(),
            reasoning_details: Vec::new(),
            tool_call_id: Some(tool_call_id.into()),
        }
    }

    fn text(role: &str, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: Some(content.into()),
            tool_calls: Vec::new(),
            reasoning_details: Vec::new(),
            tool_call_id: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone)]
pub struct AssistantTurn {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub reasoning_details: Vec<Value>,
}

impl AssistantTurn {
    pub fn into_message(self) -> ChatMessage {
        ChatMessage {
            role: "assistant".into(),
            content: (!self.content.is_empty()).then_some(self.content),
            tool_calls: self.tool_calls,
            reasoning_details: self.reasoning_details,
            tool_call_id: None,
        }
    }
}
