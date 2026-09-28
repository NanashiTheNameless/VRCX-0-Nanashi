use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::*;

async fn serve_socks5_models() -> (String, tokio::task::JoinHandle<String>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let proxy_url = format!("socks5://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut greeting = [0_u8; 3];
        stream.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 1, 0]);
        stream.write_all(&[5, 0]).await.unwrap();

        let mut request = [0_u8; 4];
        stream.read_exact(&mut request).await.unwrap();
        assert_eq!(request, [5, 1, 0, 3]);
        let domain_length = stream.read_u8().await.unwrap() as usize;
        let mut domain = vec![0_u8; domain_length];
        stream.read_exact(&mut domain).await.unwrap();
        let mut port = [0_u8; 2];
        stream.read_exact(&mut port).await.unwrap();
        assert_eq!(u16::from_be_bytes(port), 80);
        stream
            .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0])
            .await
            .unwrap();

        let mut request = Vec::new();
        let mut chunk = [0_u8; 1024];
        loop {
            let read = stream.read(&mut chunk).await.unwrap();
            request.extend_from_slice(&chunk[..read]);
            if read == 0 || request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        let body = r#"{"data":[{"id":"remote-dns-model"}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(domain).unwrap()
    });
    (proxy_url, server)
}

#[tokio::test]
async fn list_models_uses_explicit_http_proxy() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let proxy_address = listener.local_addr().unwrap();
    let proxy_task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let read = stream.read(&mut chunk).await.unwrap();
            if read == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..read]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        let body = r#"{"data":[{"id":"proxy-model"}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(request).unwrap()
    });

    let proxy_url = format!("http://{proxy_address}");
    let client = LlmClient::new("http://127.0.0.1:9/v1", "", "", Some(&proxy_url)).unwrap();

    let result = client.list_models().await.unwrap();
    assert_eq!(result.models, vec!["proxy-model"]);
    assert!(result.model_reasoning.is_empty());
    let request = proxy_task.await.unwrap();
    assert!(request.starts_with("GET http://127.0.0.1:9/v1/models HTTP/1.1\r\n"));
}

#[test]
fn list_models_parses_supported_efforts_preserving_order_and_unknown_values() {
    let body = r#"{
            "data": [
                {
                    "id": "openai/gpt-4o",
                    "reasoning": {
                        "supported_efforts": ["xhigh", "high", "medium"],
                        "mandatory": false
                    }
                },
                {
                    "id": "anthropic/claude",
                    "reasoning": {
                        "supported_efforts": ["low", "none"]
                    }
                },
                {
                    "id": "no-reasoning-model"
                },
                {
                    "id": "empty-efforts-model",
                    "reasoning": {
                        "supported_efforts": []
                    }
                },
                {
                    "id": "mandatory-model",
                    "reasoning": {
                        "supported_efforts": ["high"],
                        "mandatory": true
                    }
                }
            ]
        }"#;
    let result = parse_models_response(body, 200).unwrap();
    assert_eq!(
        result.models,
        vec![
            "anthropic/claude",
            "empty-efforts-model",
            "mandatory-model",
            "no-reasoning-model",
            "openai/gpt-4o"
        ]
    );
    assert_eq!(result.model_reasoning.len(), 3);
    assert_eq!(
        result.model_reasoning[0],
        LlmModelReasoning {
            model_id: "openai/gpt-4o".into(),
            supported_efforts: vec!["xhigh".into(), "high".into(), "medium".into()],
            mandatory: false,
        }
    );
    assert_eq!(
        result.model_reasoning[1],
        LlmModelReasoning {
            model_id: "anthropic/claude".into(),
            supported_efforts: vec!["low".into(), "none".into()],
            mandatory: false,
        }
    );
    assert_eq!(
        result.model_reasoning[2],
        LlmModelReasoning {
            model_id: "mandatory-model".into(),
            supported_efforts: vec!["high".into()],
            mandatory: true,
        }
    );
}

#[test]
fn list_models_expands_null_supported_efforts_but_not_an_omitted_field() {
    let body = r#"{
            "data": [
                {
                    "id": "unrestricted-model",
                    "reasoning": {
                        "supported_efforts": null,
                        "mandatory": true
                    }
                },
                {
                    "id": "no-effort-selector",
                    "reasoning": {
                        "mandatory": false,
                        "default_enabled": true
                    }
                }
            ]
        }"#;

    let result = parse_models_response(body, 200).unwrap();

    assert_eq!(
        result.models,
        vec!["no-effort-selector", "unrestricted-model"]
    );
    assert_eq!(
        result.model_reasoning,
        vec![LlmModelReasoning {
            model_id: "unrestricted-model".into(),
            supported_efforts: OPENROUTER_REASONING_EFFORTS
                .iter()
                .map(|effort| (*effort).to_string())
                .collect(),
            mandatory: true,
        }]
    );
}

#[test]
fn list_models_ignores_malformed_reasoning_metadata_per_model() {
    let body = r#"{
            "data": [
                {"id": "wrong-object", "reasoning": "unsupported"},
                {
                    "id": "wrong-efforts",
                    "reasoning": {"supported_efforts": "high", "mandatory": true}
                },
                {
                    "id": "mixed-efforts",
                    "reasoning": {
                        "supported_efforts": ["minimal", 42, null, "xhigh"],
                        "mandatory": "yes"
                    }
                }
            ]
        }"#;

    let result = parse_models_response(body, 200).unwrap();

    assert_eq!(
        result.models,
        vec!["mixed-efforts", "wrong-efforts", "wrong-object"]
    );
    assert_eq!(
        result.model_reasoning,
        vec![LlmModelReasoning {
            model_id: "mixed-efforts".into(),
            supported_efforts: vec!["minimal".into(), "xhigh".into()],
            mandatory: false,
        }]
    );
}

#[test]
fn chat_request_body_omits_reasoning_when_effort_is_none() {
    let messages: Vec<ChatMessage> = vec![ChatMessage::user("hi")];
    let body = ChatRequestBody {
        model: "m",
        messages: &messages,
        tools: Vec::new(),
        stream: false,
        reasoning: None,
    };
    let json = serde_json::to_string(&body).unwrap();
    assert!(!json.contains("reasoning"));
}

#[test]
fn chat_request_body_includes_reasoning_effort_verbatim() {
    let messages: Vec<ChatMessage> = vec![ChatMessage::user("hi")];
    let body = ChatRequestBody {
        model: "m",
        messages: &messages,
        tools: Vec::new(),
        stream: false,
        reasoning: Some(ReasoningRequest {
            effort: "medium".into(),
        }),
    };
    let json = serde_json::to_string(&body).unwrap();
    assert!(json.contains(r#""reasoning":{"effort":"medium"}"#));
}

#[test]
fn chat_request_body_omits_reasoning_when_effort_is_empty() {
    let messages: Vec<ChatMessage> = vec![ChatMessage::user("hi")];
    let options = LlmRequestOptions {
        reasoning_effort: Some(String::new()),
    };
    let body = ChatRequestBody {
        model: "m",
        messages: &messages,
        tools: Vec::new(),
        stream: false,
        reasoning: reasoning_request(&options),
    };
    let json = serde_json::to_string(&body).unwrap();
    assert!(!json.contains("reasoning"));
}

#[test]
fn streaming_chat_request_body_includes_reasoning_effort_verbatim() {
    let messages = vec![ChatMessage::user("hi")];
    let options = LlmRequestOptions {
        reasoning_effort: Some("xhigh".into()),
    };
    let body = ChatRequestBody {
        model: "m",
        messages: &messages,
        tools: Vec::new(),
        stream: true,
        reasoning: reasoning_request(&options),
    };

    let json = serde_json::to_value(body).unwrap();
    assert_eq!(json["stream"], true);
    assert_eq!(json["reasoning"]["effort"], "xhigh");
}

#[test]
fn streaming_reasoning_details_are_accumulated_in_response_order() {
    let mut content = String::new();
    let mut tool_acc = Vec::new();
    let mut reasoning_details = Vec::new();
    let mut on_text = |_: &str| {};

    apply_chat_stream_line(
        r#"data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.summary","summary":"Checking context","id":"summary-1","format":"anthropic-claude-v1","index":0}]}}]}"#,
        &mut on_text,
        &mut content,
        &mut tool_acc,
        &mut reasoning_details,
    );
    apply_chat_stream_line(
        r#"data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.encrypted","data":"opaque-data","id":"encrypted-1","format":"anthropic-claude-v1","index":1}]}}]}"#,
        &mut on_text,
        &mut content,
        &mut tool_acc,
        &mut reasoning_details,
    );

    assert_eq!(
        reasoning_details,
        vec![
            serde_json::json!({
                "type": "reasoning.summary",
                "summary": "Checking context",
                "id": "summary-1",
                "format": "anthropic-claude-v1",
                "index": 0
            }),
            serde_json::json!({
                "type": "reasoning.encrypted",
                "data": "opaque-data",
                "id": "encrypted-1",
                "format": "anthropic-claude-v1",
                "index": 1
            }),
        ]
    );
}

#[test]
fn assistant_tool_call_message_resends_reasoning_details_unchanged() {
    let reasoning_details = vec![serde_json::json!({
        "type": "reasoning.text",
        "text": "Need current social data",
        "signature": "signed-value",
        "id": "reasoning-1",
        "format": "anthropic-claude-v1",
        "index": 0
    })];
    let message = AssistantTurn {
        content: String::new(),
        tool_calls: vec![ToolCall {
            id: "call-1".into(),
            kind: "function".into(),
            function: FunctionCall {
                name: "get_summary".into(),
                arguments: "{}".into(),
            },
        }],
        reasoning_details: reasoning_details.clone(),
    }
    .into_message();

    let json = serde_json::to_value(message).unwrap();
    assert_eq!(json["reasoning_details"], Value::Array(reasoning_details));
    assert_eq!(json["tool_calls"][0]["id"], "call-1");
    assert!(serde_json::to_value(ChatMessage::user("hi"))
        .unwrap()
        .get("reasoning_details")
        .is_none());
}

#[tokio::test]
async fn socks5_proxy_resolves_llm_destination_remotely() {
    let (proxy_url, server) = serve_socks5_models().await;
    let client = LlmClient::new("http://llm.test.invalid/v1", "", "", Some(&proxy_url)).unwrap();

    let result = client.list_models().await.unwrap();

    assert_eq!(result.models, vec!["remote-dns-model"]);
    assert_eq!(server.await.unwrap(), "llm.test.invalid");
}

#[test]
fn chat_completion_response_extracts_first_message_content() {
    let body = r#"{
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "  translated text  "
                    }
                }
            ]
        }"#;

    assert_eq!(
        parse_chat_completion_content(body).unwrap(),
        "translated text"
    );
}

#[test]
fn chat_completion_response_rejects_missing_content() {
    let body = r#"{"choices":[{"message":{"role":"assistant"}}]}"#;

    assert!(matches!(
        parse_chat_completion_content(body),
        Err(LlmError::Api { status: 200, .. })
    ));
}

#[test]
fn drain_complete_lines_reassembles_multibyte_split_across_chunks() {
    let full = "data: 你好👋\n".as_bytes().to_vec();
    let mut buffer = Vec::new();

    // First chunk ends partway through the first multibyte character.
    buffer.extend_from_slice(&full[..8]);
    let mut lines = Vec::new();
    drain_complete_lines(&mut buffer, |line| lines.push(line.to_string()));
    assert!(lines.is_empty());

    buffer.extend_from_slice(&full[8..]);
    drain_complete_lines(&mut buffer, |line| lines.push(line.to_string()));
    assert_eq!(lines, vec!["data: 你好👋\n".to_string()]);
    assert!(!lines[0].contains('\u{FFFD}'));
    assert!(buffer.is_empty());
}

#[test]
fn drain_complete_lines_keeps_trailing_partial_line_buffered() {
    let mut buffer = b"data: a\ndata: b".to_vec();
    let mut lines = Vec::new();
    drain_complete_lines(&mut buffer, |line| lines.push(line.to_string()));
    assert_eq!(lines, vec!["data: a\n"]);
    assert_eq!(buffer, b"data: b");
}

#[test]
fn takes_final_stream_line_without_a_trailing_newline() {
    let mut buffer = b"data: final".to_vec();

    assert_eq!(
        take_remaining_line(&mut buffer).as_deref(),
        Some("data: final")
    );
    assert!(buffer.is_empty());
}

#[test]
fn repeated_cumulative_tool_names_are_idempotent() {
    assert_eq!(
        assemble_tool_name(
            &[
                "get_best_time_to_play".into(),
                "get_best_time_to_play".into()
            ],
            &["get_best_time_to_play"]
        ),
        "get_best_time_to_play"
    );
}

#[test]
fn fragmented_tool_names_still_append_deltas() {
    assert_eq!(
        assemble_tool_name(
            &["get_best_".into(), "time_to_play".into()],
            &["get_best_time_to_play"]
        ),
        "get_best_time_to_play"
    );
}

#[test]
fn valid_repeated_name_fragments_are_not_deduplicated() {
    assert_eq!(
        assemble_tool_name(&["foo".into(), "foo".into()], &["foofoo"]),
        "foofoo"
    );
}

#[test]
fn tool_arguments_accept_delta_and_cumulative_streams() {
    assert_eq!(
        assemble_tool_arguments(&["{\"limit\":".into(), "10}".into()]),
        r#"{"limit":10}"#
    );
    assert_eq!(
        assemble_tool_arguments(&[r#"{"limit":10}"#.into(), r#"{"limit":10}"#.into()]),
        r#"{"limit":10}"#
    );
    assert_eq!(
        assemble_tool_arguments(&[r#"{"limit":"#.into(), r#"{"limit":10}"#.into()]),
        r#"{"limit":10}"#
    );
    assert_eq!(
        assemble_tool_arguments(&["{}".into(), r#"{"limit":"#.into(), "10}".into()]),
        r#"{}{"limit":10}"#
    );
}

#[test]
fn azure_urls_keep_query_and_default_api_version() {
    let client = LlmClient::new(
        "https://res.openai.azure.com/openai/deployments/gpt-4o",
        "key",
        "",
        None,
    )
    .unwrap()
    .with_api(LlmApiKind::AzureOpenai, Vec::new());
    assert_eq!(
        client.openai_url("/chat/completions"),
        format!(
            "https://res.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version={AZURE_DEFAULT_API_VERSION}"
        )
    );
    assert_eq!(client.azure_deployment_name().as_deref(), Some("gpt-4o"));

    let pinned = LlmClient::new(
        "https://res.openai.azure.com/openai/deployments/gpt-4o?api-version=2025-01-01-preview",
        "key",
        "",
        None,
    )
    .unwrap()
    .with_api(LlmApiKind::AzureOpenai, Vec::new());
    assert_eq!(
        pinned.openai_url("/chat/completions"),
        "https://res.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2025-01-01-preview"
    );

    let v1 = LlmClient::new("https://res.openai.azure.com/openai/v1", "key", "", None)
        .unwrap()
        .with_api(LlmApiKind::AzureOpenai, Vec::new());
    assert_eq!(
        v1.openai_url("/models"),
        "https://res.openai.azure.com/openai/v1/models"
    );
}
