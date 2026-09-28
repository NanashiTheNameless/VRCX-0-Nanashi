use super::*;

#[tokio::test]
async fn tool_wait_stops_when_the_turn_is_cancelled() {
    let cancel = CancellationToken::new();
    cancel.cancel();

    let result = await_tool_call(
        std::future::pending::<()>(),
        &cancel,
        Duration::from_secs(1),
    )
    .await;

    assert!(matches!(result, AwaitToolCall::Cancelled));
}

#[tokio::test]
async fn tool_wait_returns_when_the_budget_expires() {
    let result = await_tool_call(
        std::future::pending::<()>(),
        &CancellationToken::new(),
        Duration::from_millis(1),
    )
    .await;

    assert!(matches!(result, AwaitToolCall::TimedOut));
}

#[test]
fn hidden_tools_are_not_dispatchable() {
    let tool_defs = vec![crate::test_support::tool_def(
        "get_online_friends",
        serde_json::json!({"type": "object"}),
    )];

    assert!(tool_is_available(&tool_defs, "get_online_friends"));
    assert!(!tool_is_available(&tool_defs, "favorite_vrchat"));
}

#[test]
fn system_prompt_keeps_core_boundaries_and_schema_field_names() {
    for phrase in [
        "not observed",
        "private instances",
        "not my own friend",
        "caveats",
        "needsDisambiguation",
        "`timeWindow`",
        "calendar year",
    ] {
        assert!(SYSTEM_PROMPT.contains(phrase), "missing phrase: {phrase}");
    }
    assert!(!SYSTEM_PROMPT.contains("time_window"));
    // Fork: fork name and no emoji.
    assert!(SYSTEM_PROMPT.contains("VRCX-0-Nanashi"));
    assert!(SYSTEM_PROMPT.contains("Never use emoji"));
    assert!(!SYSTEM_PROMPT.contains("tasteful emoji"));
}

#[test]
fn utc_offset_acceptance_is_read_from_the_tool_schema() {
    let tool_defs = vec![
        crate::test_support::tool_def(
            "get_best_time_to_play",
            serde_json::json!({
                "type": "object",
                "properties": { "utcOffsetMinutes": { "type": "integer" } }
            }),
        ),
        crate::test_support::tool_def(
            "get_copresence_summary",
            serde_json::json!({
                "type": "object",
                "properties": { "limit": { "type": "integer" } }
            }),
        ),
    ];

    assert!(tool_accepts_utc_offset(&tool_defs, "get_best_time_to_play"));
    assert!(!tool_accepts_utc_offset(
        &tool_defs,
        "get_copresence_summary"
    ));
    assert!(!tool_accepts_utc_offset(&tool_defs, "unknown_tool"));
}

#[test]
fn empty_final_answer_falls_back_to_last_tool_summary() {
    let resolved = resolve_tool_outcome(Ok(ToolCallOutcome {
        is_error: false,
        text: String::new(),
        structured: Some(serde_json::json!({
            "summary": "Alice is your top companion.",
            "rows": []
        })),
    }));
    let mut final_answer = String::new();

    assert!(apply_tool_summary_fallback(
        &mut final_answer,
        resolved.fallback_summary
    ));
    assert_eq!(final_answer, "Alice is your top companion.");
}

#[test]
fn duplicate_tool_call_summary_does_not_replace_real_fallback_summary() {
    let resolved = resolve_tool_outcome(Ok(ToolCallOutcome {
        is_error: false,
        text: String::new(),
        structured: Some(serde_json::json!({
            "summary": "Alice is your top companion.",
            "rows": []
        })),
    }));
    let duplicate = duplicate_tool_call_result("get_copresence_summary");
    let mut last_success_tool_summary = None;
    let mut last_error_tool_summary = None;
    let mut final_answer = String::new();

    remember_resolved_tool_summary(
        &resolved,
        &mut last_success_tool_summary,
        &mut last_error_tool_summary,
    );
    remember_resolved_tool_summary(
        &duplicate,
        &mut last_success_tool_summary,
        &mut last_error_tool_summary,
    );

    assert!(apply_tool_summary_fallback(
        &mut final_answer,
        last_success_tool_summary.or(last_error_tool_summary)
    ));
    assert_eq!(final_answer, "Alice is your top companion.");
}

#[test]
fn tool_without_top_level_summary_builds_readable_fallback_summary() {
    let resolved = resolve_tool_outcome(Ok(ToolCallOutcome {
        is_error: false,
        text: String::new(),
        structured: Some(serde_json::json!({
            "rows": [{
                "label": "21:00",
                "distinctFriends": 3,
                "onlineEvents": 9,
                "topFriends": []
            }],
            "caveats": []
        })),
    }));
    let mut final_answer = String::new();

    assert!(apply_tool_summary_fallback(
        &mut final_answer,
        resolved.fallback_summary
    ));
    assert_eq!(
        final_answer,
        "The tool returned 1 row. Top result: 21:00 (3 friends, 9 online events)."
    );
}

#[test]
fn raw_tool_fallback_is_not_accepted_as_supported_facts() {
    let resolved = resolve_tool_outcome(Ok(ToolCallOutcome {
        is_error: false,
        text: String::new(),
        structured: Some(serde_json::json!({
            "nodes": [{ "displayName": "Alice", "connectionDegree": 37 }],
            "edges": []
        })),
    }));

    assert!(resolved.fallback_summary.is_some());
    assert!(resolved.supported_summary.is_none());
}

#[test]
fn empty_final_answer_can_fall_back_to_tool_error_summary() {
    let resolved = resolve_tool_outcome(Err(vrcx_0_mcp::McpError::Custom("db unavailable".into())));
    let mut final_answer = String::new();

    assert!(apply_tool_summary_fallback(
        &mut final_answer,
        resolved.fallback_summary
    ));
    assert_eq!(final_answer, "tool error: db unavailable");
}

#[test]
fn llm_api_error_summary_omits_provider_response_body() {
    let error = AssistantLlmError::Api {
        status: 429,
        message: "rate limited for org_TESTPROVIDER123456789 req_TESTREQUEST123 model qwen".into(),
    };

    assert_eq!(llm_error_summary(&error), "LLM API error (429)");
}

#[test]
fn empty_final_answer_after_tools_uses_generic_fallback_when_summary_is_missing() {
    let mut final_answer = String::new();

    assert!(apply_empty_tool_answer_fallback(&mut final_answer, true));
    assert_eq!(final_answer, EMPTY_TOOL_FALLBACK_ANSWER);
}

#[test]
fn empty_final_answer_without_tools_still_allows_no_answer_error() {
    let mut final_answer = String::new();

    assert!(!apply_empty_tool_answer_fallback(&mut final_answer, false));
    assert!(final_answer.is_empty());
}

#[test]
fn empty_answer_retry_prompt_matches_available_context() {
    assert_eq!(final_answer_retry_prompt(true), FINAL_ANSWER_PROMPT);
    assert_eq!(final_answer_retry_prompt(false), DIRECT_ANSWER_RETRY_PROMPT);
    assert!(!DIRECT_ANSWER_RETRY_PROMPT.contains("tool results"));
}

#[test]
fn unfinished_placeholders_are_rejected_without_supported_tool_facts() {
    let mut answer = "| 1 | [Friend Name 1] | [Time Minutes] |".to_string();

    assert_eq!(
        guard_final_answer(&mut answer, None),
        FinalAnswerGuard::Rejected("placeholder")
    );
    assert!(answer.is_empty());
}

#[test]
fn unfinished_answer_is_replaced_by_supported_tool_summary() {
    let mut answer = "请稍等，我正在为您查询。".to_string();

    assert_eq!(
        guard_final_answer(&mut answer, Some("Alice has the most mutual connections.")),
        FinalAnswerGuard::Corrected("deferred")
    );
    assert_eq!(answer, "Alice has the most mutual connections.");
}

#[test]
fn completed_ranked_answer_passes_the_guard() {
    let mut answer = "| Rank | Friend | Connections |\n| 1 | Alice | 37 |".to_string();

    assert_eq!(
        guard_final_answer(&mut answer, None),
        FinalAnswerGuard::Valid
    );
    assert_eq!(
        answer,
        "| Rank | Friend | Connections |\n| 1 | Alice | 37 |"
    );
}
