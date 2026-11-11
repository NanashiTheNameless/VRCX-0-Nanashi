use super::evaluation::{condition_matches, PresenceRuleEvaluation};
use super::*;
use serde_json::json;
use vrcx_0_application_core::{FavoriteEntityKind, MemoryConfigStore};

#[test]
fn presence_rule_storage_preserves_open_json_fields() {
    let config = MemoryConfigStore::default();
    let rule = json!({
        "id": "future-rule",
        "conditions": [{"type": "futureCondition", "extra": 42}],
        "actions": {"futureAction": {"enabled": true}}
    });

    presence_automation_rules_set(
        &config,
        PresenceAutomationRuleKind::Context,
        vec![RawJson::from(rule.clone())],
    )
    .unwrap();
    let loaded =
        presence_automation_rules_get(&config, PresenceAutomationRuleKind::Context).unwrap();

    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].as_value(), &rule);
}

#[test]
fn toggling_one_presence_rule_keeps_the_other_rules_and_fields() {
    let config = MemoryConfigStore::default();
    presence_automation_rules_set(
        &config,
        PresenceAutomationRuleKind::Time,
        vec![
            RawJson::from(json!({"id": "morning", "enabled": false, "label": "Wake"})),
            RawJson::from(json!({"id": "evening", "enabled": false})),
        ],
    )
    .unwrap();

    let saved = presence_automation_rule_enabled_set(
        &config,
        PresenceAutomationRuleKind::Time,
        "morning",
        true,
    )
    .unwrap();
    let loaded = presence_automation_rules_get(&config, PresenceAutomationRuleKind::Time).unwrap();

    let expected = vec![
        json!({"id": "morning", "enabled": true, "label": "Wake"}),
        json!({"id": "evening", "enabled": false}),
    ];
    let values = |rules: &[RawJson]| {
        rules
            .iter()
            .map(|rule| rule.as_value().clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(values(&saved), expected);
    assert_eq!(values(&loaded), expected);
}

#[test]
fn renaming_a_local_favorite_group_rewrites_only_rules_of_that_kind() {
    let config = MemoryConfigStore::default();
    let rule = |groups: &[&str]| {
        json!({
            "id": "rule",
            "selectedGroups": groups,
            "selectedWorldGroups": groups,
            "conditions": [
                {"type": "hasFriendInGroups", "values": groups},
                {"type": "worldInFavoriteGroups", "values": groups},
                {"type": "futureCondition", "values": groups}
            ]
        })
    };
    for kind in [
        PresenceAutomationRuleKind::Time,
        PresenceAutomationRuleKind::Context,
    ] {
        presence_automation_rules_set(
            &config,
            kind,
            vec![RawJson::from(rule(&["group_0", "local:Close"]))],
        )
        .unwrap();
    }

    presence_automation_local_group_renamed(&config, FavoriteEntityKind::Friend, "Close", "Inner")
        .unwrap();

    for kind in [
        PresenceAutomationRuleKind::Time,
        PresenceAutomationRuleKind::Context,
    ] {
        let loaded = presence_automation_rules_get(&config, kind).unwrap();
        let rule = loaded[0].as_value();
        assert_eq!(rule["selectedGroups"], json!(["group_0", "local:Inner"]));
        assert_eq!(
            rule["conditions"][0]["values"],
            json!(["group_0", "local:Inner"])
        );
        assert_eq!(
            rule["selectedWorldGroups"],
            json!(["group_0", "local:Close"])
        );
        assert_eq!(
            rule["conditions"][1]["values"],
            json!(["group_0", "local:Close"])
        );
        assert_eq!(
            rule["conditions"][2]["values"],
            json!(["group_0", "local:Close"])
        );
    }

    presence_automation_local_group_renamed(&config, FavoriteEntityKind::World, "Close", "Visited")
        .unwrap();
    let loaded =
        presence_automation_rules_get(&config, PresenceAutomationRuleKind::Context).unwrap();
    let rule = loaded[0].as_value();
    assert_eq!(
        rule["selectedWorldGroups"],
        json!(["group_0", "local:Visited"])
    );
    assert_eq!(
        rule["conditions"][1]["values"],
        json!(["group_0", "local:Visited"])
    );
    assert_eq!(rule["selectedGroups"], json!(["group_0", "local:Inner"]));
}

#[test]
fn forcing_game_running_prepends_a_single_game_running_condition() {
    let rule = json!({
        "conditions": [
            {"type": "futureCondition", "value": "future-value"},
            {"type": "isGameRunning", "value": false},
            {"type": "isGameRunning"},
        ],
        "actions": {"status": "join me"},
    });
    let action_value = rule["actions"]["status"].as_str().unwrap().as_ptr();
    let condition_value = rule["conditions"][0]["value"].as_str().unwrap().as_ptr();

    let forced = force_game_running_condition(rule);

    assert_eq!(
        forced["conditions"],
        json!([
            {"type": "isGameRunning"},
            {"type": "futureCondition", "value": "future-value"},
        ])
    );
    assert_eq!(forced["actions"], json!({"status": "join me"}));
    assert_eq!(
        forced["actions"]["status"].as_str().unwrap().as_ptr(),
        action_value
    );
    assert_eq!(
        forced["conditions"][1]["value"].as_str().unwrap().as_ptr(),
        condition_value
    );
}

#[test]
fn legacy_company_rule_beats_alone_rule_by_priority() {
    let facts = BackgroundPresenceFacts {
        is_game_running: true,
        player_facts_known: true,
        player_count: 1,
        instance_type: "public".into(),
        ..Default::default()
    };
    let rules = vec![
        json!({
            "id": "legacy-alone",
            "enabled": true,
            "priority": 100,
            "conditions": [{"type": "playerFactsKnown"}],
            "actions": {"status": "join me"},
        }),
        json!({
            "id": "legacy-company",
            "enabled": true,
            "priority": 200,
            "conditions": [{"type": "withCompany"}],
            "actions": {"status": "busy"},
            "stopProcessing": true,
        }),
    ];

    let result = evaluate_presence_rules(&facts, &rules);

    assert_eq!(
        result.patch.get("status"),
        Some(&Value::String("busy".into()))
    );
}

#[test]
fn cached_automation_state_restores_previous_status_after_restart() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "vrcx-0-presence-state-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("presenceAutomationState.json");

    let mut state = BackgroundPresenceAutomationState {
        scope_key: "https://api.example:usr_1".into(),
        ..Default::default()
    };
    state.time_restore_snapshots.insert(
        "status".into(),
        TimeRestoreSnapshot {
            previous_value: "active".into(),
            automated_value: "busy".into(),
        },
    );
    let mut last_serialized = String::new();
    state.persist_cached(&path, &mut last_serialized);
    assert!(!last_serialized.is_empty());
    let before_rewrite = std::fs::metadata(&path).unwrap().modified().unwrap();
    state.persist_cached(&path, &mut last_serialized);
    assert_eq!(
        std::fs::metadata(&path).unwrap().modified().unwrap(),
        before_rewrite
    );

    let mut loaded = BackgroundPresenceAutomationState::load_cached(&path);
    assert_eq!(loaded.scope_key, "https://api.example:usr_1");

    let facts = BackgroundPresenceFacts {
        current_user: json!({ "status": "busy" }).into(),
        ..Default::default()
    };
    let effective =
        build_patch_with_time_restore(&facts, &PresenceRuleEvaluation::default(), &mut loaded);
    assert_eq!(
        effective.patch.get("status"),
        Some(&Value::String("active".into()))
    );

    let missing = BackgroundPresenceAutomationState::load_cached(&dir.join("missing.json"));
    assert!(missing.scope_key.is_empty());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn world_in_favorite_groups_matches_selected_or_any_group() {
    let facts = BackgroundPresenceFacts {
        current_world_favorite_group_keys: vec!["world:worlds1".into()],
        ..Default::default()
    };

    let any_group = json!({ "type": "worldInFavoriteGroups", "values": [] });
    let selected = json!({ "type": "worldInFavoriteGroups", "values": ["world:worlds1"] });
    let other = json!({ "type": "worldInFavoriteGroups", "values": ["local:Favorites"] });

    assert!(condition_matches(&any_group, &facts));
    assert!(condition_matches(&selected, &facts));
    assert!(!condition_matches(&other, &facts));
    assert!(!condition_matches(
        &any_group,
        &BackgroundPresenceFacts::default()
    ));
}

#[test]
fn instance_group_in_matches_only_selected_group_instances() {
    let facts = BackgroundPresenceFacts {
        parsed_location: vrcx_0_core::location::parse_location(
            "wrld_1:12345~group(grp_selected)~groupAccessType(members)~region(jp)",
        ),
        ..Default::default()
    };

    let selected = json!({ "type": "instanceGroupIn", "values": ["grp_selected"] });
    let other = json!({ "type": "instanceGroupIn", "values": ["grp_other"] });
    let none = json!({ "type": "instanceGroupIn", "values": [] });

    assert!(condition_matches(&selected, &facts));
    assert!(!condition_matches(&other, &facts));
    assert!(!condition_matches(&none, &facts));
    assert!(!condition_matches(
        &selected,
        &BackgroundPresenceFacts {
            parsed_location: vrcx_0_core::location::parse_location("wrld_1:12345~region(jp)"),
            ..Default::default()
        }
    ));
}

fn vr_facts_in(world_id: &str) -> BackgroundPresenceFacts {
    BackgroundPresenceFacts {
        is_game_running: true,
        is_game_no_vr: false,
        instance_type: "public".into(),
        parsed_location: vrcx_0_core::location::ParsedLocation {
            world_id: world_id.into(),
            ..Default::default()
        },
        ..Default::default()
    }
}

fn status_of(facts: &BackgroundPresenceFacts, rule: Value) -> Option<Value> {
    evaluate_presence_rules(facts, &[rule])
        .patch
        .get("status")
        .cloned()
}

#[test]
fn game_mode_and_world_conditions_match_the_current_session() {
    let vr = vr_facts_in("wrld_a");
    let desktop = BackgroundPresenceFacts {
        is_game_no_vr: true,
        ..vr_facts_in("wrld_a")
    };
    let not_running = BackgroundPresenceFacts {
        is_game_running: false,
        ..vr_facts_in("wrld_a")
    };
    let vr_mode = json!({"type": "gameMode", "value": "vr"});
    let desktop_mode = json!({"type": "gameMode", "value": "desktop"});
    let in_a = json!({"type": "worldIn", "values": ["wrld_a"]});
    let in_b = json!({"type": "worldIn", "values": ["wrld_b"]});

    assert!(condition_matches(&vr_mode, &vr));
    assert!(!condition_matches(&vr_mode, &desktop));
    assert!(condition_matches(&desktop_mode, &desktop));
    assert!(!condition_matches(&desktop_mode, &not_running));
    assert!(condition_matches(&in_a, &vr));
    assert!(!condition_matches(&in_b, &vr));
    assert!(!condition_matches(&in_a, &vr_facts_in("")));
}

#[test]
fn any_match_mode_needs_one_condition_but_keeps_scope_conditions_required() {
    let rule = |conditions: Value, mode: &str| {
        json!({
            "id": "rule",
            "conditionMatch": mode,
            "conditions": conditions,
            "actions": {"status": "busy"},
        })
    };
    let busy = Some(Value::String("busy".into()));
    let vr_in_b = json!([
        {"type": "isGameRunning"},
        {"type": "gameMode", "value": "vr"},
        {"type": "worldIn", "values": ["wrld_b"]},
    ]);
    let facts = vr_facts_in("wrld_a");

    assert_eq!(status_of(&facts, rule(vr_in_b.clone(), "all")), None);
    assert_eq!(status_of(&facts, rule(vr_in_b.clone(), "any")), busy);

    let private_only = json!([
        {"type": "instanceTypeIn", "values": ["private"]},
        {"type": "gameMode", "value": "vr"},
    ]);
    assert_eq!(
        status_of(&facts, rule(private_only, "any")),
        None,
        "instance types stay required in any mode"
    );
    assert_eq!(
        status_of(
            &facts,
            rule(json!([{"type": "isGameRunning", "value": false}]), "any")
        ),
        None,
        "game running stays required in any mode"
    );
}

#[test]
fn pronouns_action_is_truncated_and_written_only_when_changed() {
    let facts = vr_facts_in("wrld_a");
    let long = "x".repeat(40);
    let rule = json!({
        "id": "rule",
        "conditions": [{"type": "isGameRunning"}],
        "actions": {"pronouns": long},
    });
    assert!(has_presence_action(&rule));

    let evaluation = evaluate_presence_rules(&facts, &[rule]);
    let pronouns = evaluation.patch.get("pronouns").unwrap().as_str().unwrap();
    assert_eq!(pronouns.chars().count(), 32);

    let same = json!({"pronouns": pronouns});
    assert!(changed_patch(&same, &evaluation.patch).is_empty());
    let other = json!({"pronouns": "they/them"});
    assert_eq!(
        changed_patch(&other, &evaluation.patch).get("pronouns"),
        evaluation.patch.get("pronouns")
    );
}
