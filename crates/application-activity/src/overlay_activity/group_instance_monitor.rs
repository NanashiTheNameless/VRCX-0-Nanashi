use serde_json::{json, Value};
use vrcx_0_core::json::{JsonExt, RawJson};

use super::{
    OverlayActivityCandidate, OverlayActivityEntry, OverlayActivityFavoriteSubject,
    OverlayActivityRuntime,
};

impl OverlayActivityRuntime {
    pub fn ingest_group_instance_scan(
        &self,
        scope_key: &str,
        group_id: &str,
        fetched_at: &str,
        instances: &[RawJson],
    ) -> Vec<OverlayActivityEntry> {
        let mut current_locations = instances
            .iter()
            .map(|instance| instance_location(instance.as_value()))
            .filter(|location| !location.is_empty())
            .collect::<Vec<_>>();
        current_locations.sort();
        current_locations.dedup();
        let new_locations = {
            let Ok(mut state) = self.inner.state.lock() else {
                return Vec::new();
            };
            let scope_changed = state.group_instance_scope_key != scope_key;
            if scope_changed {
                state.group_instance_scope_key = scope_key.to_string();
                state.group_instance_baseline.clear();
            }
            let Some(previous_locations) = state.group_instance_baseline.get(group_id) else {
                state
                    .group_instance_baseline
                    .insert(group_id.to_string(), current_locations);
                return Vec::new();
            };
            let new_locations = current_locations
                .iter()
                .filter(|location| !previous_locations.contains(location))
                .cloned()
                .collect::<Vec<_>>();
            state
                .group_instance_baseline
                .insert(group_id.to_string(), current_locations);
            new_locations
        };
        if new_locations.is_empty() {
            return Vec::new();
        }

        let first_location = &new_locations[0];
        let first = instances
            .iter()
            .find(|instance| instance_location(instance.as_value()) == *first_location)
            .map(RawJson::as_value)
            .unwrap_or(&Value::Null);
        let candidate = OverlayActivityCandidate {
            source_id: format!("group-instance-opened:{scope_key}:{group_id}:{first_location}"),
            activity_type: "group.instanceOpened".to_string(),
            created_at: fetched_at.to_string(),
            actor_user_id: String::new(),
            actor_display_name: String::new(),
            current_instance: false,
            favorite_subject: OverlayActivityFavoriteSubject::GroupId(group_id.to_string()),
            payload: json!({
                "groupId": group_id,
                "groupName": first_non_empty([
                    nested_str(first, &["group", "name"]),
                    nested_str(first, &["instance", "group", "name"]),
                    Some(group_id),
                ]),
                "count": new_locations.len(),
                "location": first_location,
                "worldName": first_non_empty([
                    first.trimmed_field("worldName"),
                    nested_str(first, &["world", "name"]),
                    nested_str(first, &["instance", "world", "name"]),
                ]),
                "imageUrl": first_non_empty([
                    nested_str(first, &["group", "iconUrl"]),
                    nested_str(first, &["group", "icon"]),
                    nested_str(first, &["group", "thumbnailUrl"]),
                ]),
            })
            .into(),
        };
        self.ingest_candidate(candidate).into_iter().collect()
    }
}

fn instance_location(value: &Value) -> String {
    first_non_empty([
        value.trimmed_field("location"),
        nested_str(value, &["instance", "location"]),
    ])
}

fn first_non_empty<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> String {
    values
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn nested_str<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overlay_activity::{
        OverlayActivityFavoriteGroupKeys, OverlayActivityFilters, OverlayActivityRule,
        OverlayActivityScope,
    };
    use chrono::Utc;
    use vrcx_0_core::json::RawJson;

    #[test]
    fn first_scan_seeds_and_later_new_locations_are_aggregated_per_group() {
        let mut filters = OverlayActivityFilters::default();
        filters.wrist.types.insert(
            "group.instanceOpened".into(),
            OverlayActivityRule {
                scope: OverlayActivityScope::AllFavorites,
                favorite_group_keys: OverlayActivityFavoriteGroupKeys::All,
            },
        );
        let runtime = OverlayActivityRuntime::with_filters(filters);
        runtime.set_group_favorite_groups(super::super::OverlayFavoriteGroups::from_map(
            [("group:collection".into(), vec!["grp_test".into()])].into(),
        ));
        let first = vec![instance("one")];
        assert!(runtime
            .ingest_group_instance_scan("scope", "grp_test", &Utc::now().to_rfc3339(), &first,)
            .is_empty());
        let second = vec![instance("one"), instance("two"), instance("three")];
        let entries = runtime.ingest_group_instance_scan(
            "scope",
            "grp_test",
            &Utc::now().to_rfc3339(),
            &second,
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].payload["count"], json!(2));
        let next = vec![
            instance("one"),
            instance("two"),
            instance("three"),
            instance("four"),
        ];
        let entries = runtime.ingest_group_instance_scan(
            "scope",
            "grp_test",
            &Utc::now().to_rfc3339(),
            &next,
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0]
                .content
                .body
                .as_message()
                .expect("group instance message")
                .params()["location"],
            "Test World groupPlus(Test Group)"
        );
    }

    #[test]
    fn membership_changes_seed_existing_instances_before_notifying() {
        let mut filters = OverlayActivityFilters::default();
        filters.wrist.types.insert(
            "group.instanceOpened".into(),
            OverlayActivityRule {
                scope: OverlayActivityScope::AllFavorites,
                favorite_group_keys: OverlayActivityFavoriteGroupKeys::All,
            },
        );
        let runtime = OverlayActivityRuntime::with_filters(filters);
        let first = vec![instance("one")];
        assert!(runtime
            .ingest_group_instance_scan("scope", "grp_test", &Utc::now().to_rfc3339(), &first,)
            .is_empty());

        runtime.set_group_favorite_groups(super::super::OverlayFavoriteGroups::from_map(
            [("group:collection".into(), vec!["grp_test".into()])].into(),
        ));
        let existing = vec![instance("one"), instance("two")];
        assert!(runtime
            .ingest_group_instance_scan("scope", "grp_test", &Utc::now().to_rfc3339(), &existing,)
            .is_empty());

        let next = vec![instance("one"), instance("two"), instance("three")];
        assert_eq!(
            runtime
                .ingest_group_instance_scan("scope", "grp_test", &Utc::now().to_rfc3339(), &next,)
                .len(),
            1
        );
    }

    #[test]
    fn adding_a_saved_group_keeps_existing_group_baselines() {
        let mut filters = OverlayActivityFilters::default();
        filters.wrist.types.insert(
            "group.instanceOpened".into(),
            OverlayActivityRule {
                scope: OverlayActivityScope::AllFavorites,
                favorite_group_keys: OverlayActivityFavoriteGroupKeys::All,
            },
        );
        let runtime = OverlayActivityRuntime::with_filters(filters);
        runtime.set_group_favorite_groups(super::super::OverlayFavoriteGroups::from_map(
            [("group:collection".into(), vec!["grp_test".into()])].into(),
        ));
        assert!(runtime
            .ingest_group_instance_scan(
                "scope",
                "grp_test",
                &Utc::now().to_rfc3339(),
                &[instance("one")],
            )
            .is_empty());

        runtime.set_group_favorite_groups(super::super::OverlayFavoriteGroups::from_map(
            [(
                "group:collection".into(),
                vec!["grp_test".into(), "grp_new".into()],
            )]
            .into(),
        ));

        assert_eq!(
            runtime
                .ingest_group_instance_scan(
                    "scope",
                    "grp_test",
                    &Utc::now().to_rfc3339(),
                    &[instance("one"), instance("two")],
                )
                .len(),
            1
        );
        assert!(runtime
            .ingest_group_instance_scan(
                "scope",
                "grp_new",
                &Utc::now().to_rfc3339(),
                &[instance_for_group("grp_new", "existing")],
            )
            .is_empty());
    }

    #[test]
    fn scope_changes_retain_only_groups_that_remain_watched() {
        let mut filters = OverlayActivityFilters::default();
        filters.wrist.types.insert(
            "group.instanceOpened".into(),
            OverlayActivityRule {
                scope: OverlayActivityScope::SelectedFavorites,
                favorite_group_keys: OverlayActivityFavoriteGroupKeys::Selected(vec![
                    "group:collection-a".into(),
                ]),
            },
        );
        let runtime = OverlayActivityRuntime::with_filters(filters.clone());
        runtime.set_group_favorite_groups(super::super::OverlayFavoriteGroups::from_map(
            [
                ("group:collection-a".into(), vec!["grp_one".into()]),
                ("group:collection-b".into(), vec!["grp_two".into()]),
            ]
            .into(),
        ));
        for group_id in ["grp_one", "grp_two"] {
            assert!(runtime
                .ingest_group_instance_scan(
                    "scope",
                    group_id,
                    &Utc::now().to_rfc3339(),
                    &[instance_for_group(group_id, "existing")],
                )
                .is_empty());
        }

        filters.wrist.types.insert(
            "group.instanceOpened".into(),
            OverlayActivityRule {
                scope: OverlayActivityScope::AllFavorites,
                favorite_group_keys: OverlayActivityFavoriteGroupKeys::All,
            },
        );
        runtime.set_filters(filters);

        assert_eq!(
            runtime
                .ingest_group_instance_scan(
                    "scope",
                    "grp_one",
                    &Utc::now().to_rfc3339(),
                    &[
                        instance_for_group("grp_one", "existing"),
                        instance_for_group("grp_one", "new"),
                    ],
                )
                .len(),
            1
        );
        assert!(runtime
            .ingest_group_instance_scan(
                "scope",
                "grp_two",
                &Utc::now().to_rfc3339(),
                &[
                    instance_for_group("grp_two", "existing"),
                    instance_for_group("grp_two", "new"),
                ],
            )
            .is_empty());
    }

    #[test]
    fn player_count_changes_do_not_create_new_instance_events() {
        let mut filters = OverlayActivityFilters::default();
        filters.wrist.types.insert(
            "group.instanceOpened".into(),
            OverlayActivityRule {
                scope: OverlayActivityScope::AllFavorites,
                favorite_group_keys: OverlayActivityFavoriteGroupKeys::All,
            },
        );
        let runtime = OverlayActivityRuntime::with_filters(filters);
        runtime.set_group_favorite_groups(super::super::OverlayFavoriteGroups::from_map(
            [("group:collection".into(), vec!["grp_test".into()])].into(),
        ));
        assert!(runtime
            .ingest_group_instance_scan(
                "scope",
                "grp_test",
                &Utc::now().to_rfc3339(),
                &[instance_with_count("one", 2)],
            )
            .is_empty());

        assert!(runtime
            .ingest_group_instance_scan(
                "scope",
                "grp_test",
                &Utc::now().to_rfc3339(),
                &[instance_with_count("one", 8)],
            )
            .is_empty());
    }

    #[test]
    fn each_group_compares_only_its_own_location_list() {
        let mut filters = OverlayActivityFilters::default();
        filters.wrist.types.insert(
            "group.instanceOpened".into(),
            OverlayActivityRule {
                scope: OverlayActivityScope::AllFavorites,
                favorite_group_keys: OverlayActivityFavoriteGroupKeys::All,
            },
        );
        let runtime = OverlayActivityRuntime::with_filters(filters);
        runtime.set_group_favorite_groups(super::super::OverlayFavoriteGroups::from_map(
            [(
                "group:collection".into(),
                vec!["grp_one".into(), "grp_two".into()],
            )]
            .into(),
        ));
        assert!(runtime
            .ingest_group_instance_scan(
                "scope",
                "grp_one",
                &Utc::now().to_rfc3339(),
                &[instance_for_group("grp_one", "one")],
            )
            .is_empty());
        assert!(runtime
            .ingest_group_instance_scan(
                "scope",
                "grp_two",
                &Utc::now().to_rfc3339(),
                &[instance_for_group("grp_two", "one")],
            )
            .is_empty());

        assert!(runtime
            .ingest_group_instance_scan(
                "scope",
                "grp_two",
                &Utc::now().to_rfc3339(),
                &[instance_for_group("grp_two", "one")],
            )
            .is_empty());
        assert_eq!(
            runtime
                .ingest_group_instance_scan(
                    "scope",
                    "grp_one",
                    &Utc::now().to_rfc3339(),
                    &[
                        instance_for_group("grp_one", "one"),
                        instance_for_group("grp_one", "two"),
                    ],
                )
                .len(),
            1
        );
    }

    fn instance(id: &str) -> RawJson {
        instance_with_count(id, 1)
    }

    fn instance_with_count(id: &str, user_count: u64) -> RawJson {
        json!({
            "location": format!(
                "wrld_test:{id}~group(grp_test)~groupAccessType(plus)"
            ),
            "group": { "id": "grp_test", "name": "Test Group" },
            "world": { "name": "Test World" },
            "createdAt": Utc::now().to_rfc3339(),
            "userCount": user_count,
        })
        .into()
    }

    fn instance_for_group(group_id: &str, id: &str) -> RawJson {
        json!({
            "location": format!("wrld_test:{id}~group({group_id})"),
            "group": { "id": group_id, "name": group_id },
        })
        .into()
    }
}
