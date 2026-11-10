//! Access criteria for gated follow links and parties.
//!
//! Every fact comes from VRChat through the signed-in user's own session, and
//! the sender id comes from a VRChat-authenticated notification. Anything that
//! cannot be read is treated as a denial, never as a pass.

use std::collections::HashMap;

use serde_json::Value;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AgeRequirement {
    #[default]
    None,
    /// `ageVerificationStatus` is `verified` or `18+`.
    Verified,
    /// `ageVerificationStatus` is `18+`.
    Adult,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AccessCriteria {
    pub require_friend: bool,
    pub age: AgeRequirement,
    /// The sender must be a member of at least one of these groups. Empty
    /// means no group requirement.
    pub groups_any: Vec<String>,
    pub exclude_safety_listed: bool,
}

impl AccessCriteria {
    /// A rule with no requirement would invite anyone who can send a request,
    /// so it is rejected rather than treated as "allow all".
    pub fn has_requirement(&self) -> bool {
        self.require_friend || self.age != AgeRequirement::None || !self.groups().is_empty()
    }

    pub fn groups(&self) -> Vec<&str> {
        let mut groups: Vec<&str> = self
            .groups_any
            .iter()
            .map(|group| group.trim())
            .filter(|group| group.starts_with("grp_"))
            .collect();
        groups.sort_unstable();
        groups.dedup();
        groups
    }

    pub fn needs(&self) -> FactNeeds {
        FactNeeds {
            friend_status: self.require_friend,
            user_profile: self.age != AgeRequirement::None,
            group_ids: self.groups().into_iter().map(str::to_string).collect(),
        }
    }
}

/// What has to be fetched before a sender can be evaluated, so a rule only
/// costs the requests it actually needs.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FactNeeds {
    pub friend_status: bool,
    pub user_profile: bool,
    pub group_ids: Vec<String>,
}

impl FactNeeds {
    pub fn merge(&mut self, other: FactNeeds) {
        self.friend_status |= other.friend_status;
        self.user_profile |= other.user_profile;
        for group_id in other.group_ids {
            if !self.group_ids.contains(&group_id) {
                self.group_ids.push(group_id);
            }
        }
    }
}

/// `None` everywhere means "could not be read".
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SenderFacts {
    pub is_friend: Option<bool>,
    pub age_verification_status: Option<String>,
    pub group_memberships: HashMap<String, Option<bool>>,
    pub on_safety_list: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CriterionDenied {
    NoRequirement,
    NotFriend,
    FriendStatusUnknown,
    AgeNotVerified,
    AgeStatusUnknown,
    NotInGroup,
    GroupMembershipUnknown,
    SafetyListed,
    SafetyListUnknown,
}

impl CriterionDenied {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::NoRequirement => "no-requirement",
            Self::NotFriend => "not-friend",
            Self::FriendStatusUnknown => "friend-status-unknown",
            Self::AgeNotVerified => "age-not-verified",
            Self::AgeStatusUnknown => "age-status-unknown",
            Self::NotInGroup => "not-in-group",
            Self::GroupMembershipUnknown => "group-membership-unknown",
            Self::SafetyListed => "safety-listed",
            Self::SafetyListUnknown => "safety-list-unknown",
        }
    }
}

pub fn evaluate_access_criteria(
    criteria: &AccessCriteria,
    facts: &SenderFacts,
) -> Result<(), CriterionDenied> {
    if !criteria.has_requirement() {
        return Err(CriterionDenied::NoRequirement);
    }
    if criteria.exclude_safety_listed {
        match facts.on_safety_list {
            Some(false) => {}
            Some(true) => return Err(CriterionDenied::SafetyListed),
            None => return Err(CriterionDenied::SafetyListUnknown),
        }
    }
    if criteria.require_friend {
        match facts.is_friend {
            Some(true) => {}
            Some(false) => return Err(CriterionDenied::NotFriend),
            None => return Err(CriterionDenied::FriendStatusUnknown),
        }
    }
    if criteria.age != AgeRequirement::None {
        let status = facts
            .age_verification_status
            .as_deref()
            .map(str::trim)
            .filter(|status| !status.is_empty())
            .ok_or(CriterionDenied::AgeStatusUnknown)?;
        let accepted = match criteria.age {
            AgeRequirement::None => true,
            AgeRequirement::Verified => status == "verified" || status == "18+",
            AgeRequirement::Adult => status == "18+",
        };
        if !accepted {
            return Err(CriterionDenied::AgeNotVerified);
        }
    }
    let groups = criteria.groups();
    if !groups.is_empty() {
        let mut any_unknown = false;
        for group in groups {
            match facts.group_memberships.get(group).copied().flatten() {
                Some(true) => return Ok(()),
                Some(false) => {}
                None => any_unknown = true,
            }
        }
        return Err(if any_unknown {
            CriterionDenied::GroupMembershipUnknown
        } else {
            CriterionDenied::NotInGroup
        });
    }
    Ok(())
}

pub const FOLLOW_LINK_RULES_CONFIG_KEY: &str = "followLinkRules";
const MAX_FOLLOW_RULES: usize = 16;
const MAX_RULE_GROUPS: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FollowRule {
    pub id: String,
    pub criteria: AccessCriteria,
}

/// Enabled rules from the `followLinkRules` config value. Malformed entries
/// and rules without any requirement are dropped, so a broken config can
/// only ever invite fewer people.
pub fn parse_follow_rules(value: &Value) -> Vec<FollowRule> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter(|rule| rule.get("enabled").and_then(Value::as_bool) == Some(true))
        .filter_map(|rule| {
            let id = rule.get("id").and_then(Value::as_str)?.trim();
            if id.is_empty() {
                return None;
            }
            let age = match rule.get("age").and_then(Value::as_str).map(str::trim) {
                None | Some("") | Some("none") => AgeRequirement::None,
                Some("verified") => AgeRequirement::Verified,
                Some("adult") => AgeRequirement::Adult,
                Some(_) => return None,
            };
            let groups_any = rule
                .get("groups")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|group| group.trim().to_string())
                .take(MAX_RULE_GROUPS)
                .collect();
            let criteria = AccessCriteria {
                require_friend: rule.get("requireFriend").and_then(Value::as_bool) == Some(true),
                age,
                groups_any,
                exclude_safety_listed: false,
            };
            criteria.has_requirement().then(|| FollowRule {
                id: id.to_string(),
                criteria,
            })
        })
        .take(MAX_FOLLOW_RULES)
        .collect()
}

/// Reads `isFriend` from a `GET user/{id}/friendStatus` response.
pub fn friend_status_from_response(status: i32, body: &Value) -> Option<bool> {
    if !(200..=299).contains(&status) {
        return None;
    }
    body.get("isFriend").and_then(Value::as_bool)
}

/// Reads `ageVerificationStatus` from a `GET users/{id}` response, only when
/// the response is for the expected user.
pub fn age_status_from_user_response(
    status: i32,
    body: &Value,
    expected_user_id: &str,
) -> Option<String> {
    if !(200..=299).contains(&status) || !response_user_matches(body, "id", expected_user_id) {
        return None;
    }
    body.get("ageVerificationStatus")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|status| !status.is_empty())
        .map(str::to_string)
}

/// Reads membership from a `GET groups/{groupId}/members/{userId}` response.
/// A 404 is a definite "not a member"; anything else that is not a readable
/// active membership for the expected user and group is unknown.
pub fn group_membership_from_response(
    status: i32,
    body: &Value,
    expected_group_id: &str,
    expected_user_id: &str,
) -> Option<bool> {
    if status == 404 {
        return Some(false);
    }
    if !(200..=299).contains(&status)
        || !response_user_matches(body, "userId", expected_user_id)
        || !response_user_matches(body, "groupId", expected_group_id)
    {
        return None;
    }
    match body.get("membershipStatus").and_then(Value::as_str)?.trim() {
        "member" => Some(true),
        _ => Some(false),
    }
}

fn response_user_matches(body: &Value, field: &str, expected: &str) -> bool {
    let expected = expected.trim();
    !expected.is_empty()
        && body
            .get(field)
            .and_then(Value::as_str)
            .is_some_and(|value| value.trim() == expected)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn friend_rule() -> AccessCriteria {
        AccessCriteria {
            require_friend: true,
            ..AccessCriteria::default()
        }
    }

    fn facts_friend() -> SenderFacts {
        SenderFacts {
            is_friend: Some(true),
            ..SenderFacts::default()
        }
    }

    #[test]
    fn rule_without_any_requirement_is_denied() {
        let criteria = AccessCriteria {
            exclude_safety_listed: true,
            groups_any: vec!["not-a-group".into(), "  ".into()],
            ..AccessCriteria::default()
        };
        let facts = SenderFacts {
            on_safety_list: Some(false),
            ..facts_friend()
        };
        assert_eq!(
            evaluate_access_criteria(&criteria, &facts),
            Err(CriterionDenied::NoRequirement)
        );
    }

    #[test]
    fn friend_requirement_fails_closed() {
        let criteria = friend_rule();
        assert_eq!(evaluate_access_criteria(&criteria, &facts_friend()), Ok(()));
        assert_eq!(
            evaluate_access_criteria(
                &criteria,
                &SenderFacts {
                    is_friend: Some(false),
                    ..SenderFacts::default()
                }
            ),
            Err(CriterionDenied::NotFriend)
        );
        assert_eq!(
            evaluate_access_criteria(&criteria, &SenderFacts::default()),
            Err(CriterionDenied::FriendStatusUnknown)
        );
    }

    #[test]
    fn age_levels_accept_only_matching_status() {
        let verified = AccessCriteria {
            age: AgeRequirement::Verified,
            ..AccessCriteria::default()
        };
        let adult = AccessCriteria {
            age: AgeRequirement::Adult,
            ..AccessCriteria::default()
        };
        let with_status = |status: Option<&str>| SenderFacts {
            age_verification_status: status.map(str::to_string),
            ..SenderFacts::default()
        };

        assert_eq!(
            evaluate_access_criteria(&verified, &with_status(Some("verified"))),
            Ok(())
        );
        assert_eq!(
            evaluate_access_criteria(&verified, &with_status(Some("18+"))),
            Ok(())
        );
        assert_eq!(
            evaluate_access_criteria(&adult, &with_status(Some("18+"))),
            Ok(())
        );
        assert_eq!(
            evaluate_access_criteria(&adult, &with_status(Some("verified"))),
            Err(CriterionDenied::AgeNotVerified)
        );
        assert_eq!(
            evaluate_access_criteria(&verified, &with_status(Some("hidden"))),
            Err(CriterionDenied::AgeNotVerified)
        );
        assert_eq!(
            evaluate_access_criteria(&verified, &with_status(Some(" "))),
            Err(CriterionDenied::AgeStatusUnknown)
        );
        assert_eq!(
            evaluate_access_criteria(&verified, &with_status(None)),
            Err(CriterionDenied::AgeStatusUnknown)
        );
    }

    #[test]
    fn any_listed_group_is_enough_and_unknown_never_passes() {
        let criteria = AccessCriteria {
            groups_any: vec!["grp_a".into(), "grp_b".into()],
            ..AccessCriteria::default()
        };
        let with = |a: Option<bool>, b: Option<bool>| SenderFacts {
            group_memberships: HashMap::from([("grp_a".into(), a), ("grp_b".into(), b)]),
            ..SenderFacts::default()
        };

        assert_eq!(
            evaluate_access_criteria(&criteria, &with(None, Some(true))),
            Ok(())
        );
        assert_eq!(
            evaluate_access_criteria(&criteria, &with(Some(false), Some(false))),
            Err(CriterionDenied::NotInGroup)
        );
        assert_eq!(
            evaluate_access_criteria(&criteria, &with(Some(false), None)),
            Err(CriterionDenied::GroupMembershipUnknown)
        );
        assert_eq!(
            evaluate_access_criteria(&criteria, &SenderFacts::default()),
            Err(CriterionDenied::GroupMembershipUnknown)
        );
    }

    #[test]
    fn combined_requirements_all_have_to_pass() {
        let criteria = AccessCriteria {
            require_friend: true,
            age: AgeRequirement::Adult,
            groups_any: vec!["grp_a".into()],
            exclude_safety_listed: true,
        };
        let passing = SenderFacts {
            is_friend: Some(true),
            age_verification_status: Some("18+".into()),
            group_memberships: HashMap::from([("grp_a".into(), Some(true))]),
            on_safety_list: Some(false),
        };
        assert_eq!(evaluate_access_criteria(&criteria, &passing), Ok(()));

        let mut not_adult = passing.clone();
        not_adult.age_verification_status = Some("hidden".into());
        assert_eq!(
            evaluate_access_criteria(&criteria, &not_adult),
            Err(CriterionDenied::AgeNotVerified)
        );

        let mut listed = passing.clone();
        listed.on_safety_list = Some(true);
        assert_eq!(
            evaluate_access_criteria(&criteria, &listed),
            Err(CriterionDenied::SafetyListed)
        );

        let mut safety_unknown = passing;
        safety_unknown.on_safety_list = None;
        assert_eq!(
            evaluate_access_criteria(&criteria, &safety_unknown),
            Err(CriterionDenied::SafetyListUnknown)
        );
    }

    #[test]
    fn needs_only_cover_enabled_requirements() {
        assert_eq!(
            friend_rule().needs(),
            FactNeeds {
                friend_status: true,
                ..FactNeeds::default()
            }
        );
        let criteria = AccessCriteria {
            age: AgeRequirement::Verified,
            groups_any: vec![" grp_b ".into(), "grp_a".into(), "grp_b".into(), "x".into()],
            exclude_safety_listed: true,
            ..AccessCriteria::default()
        };
        assert_eq!(
            criteria.needs(),
            FactNeeds {
                friend_status: false,
                user_profile: true,
                group_ids: vec!["grp_a".into(), "grp_b".into()],
            }
        );
    }

    #[test]
    fn parses_only_enabled_well_formed_rules_with_a_requirement() {
        let rules = parse_follow_rules(&json!([
            {"id": "a", "enabled": true, "requireFriend": true, "age": "adult", "groups": ["grp_x"]},
            {"id": "off", "enabled": false, "requireFriend": true},
            {"id": "empty", "enabled": true},
            {"id": "bad-age", "enabled": true, "requireFriend": true, "age": "teen"},
            {"id": " ", "enabled": true, "requireFriend": true},
            {"enabled": true, "requireFriend": true},
            {"id": "truthy", "enabled": "true", "requireFriend": true},
            {"id": "groups", "enabled": true, "groups": ["grp_y", "nope"]},
        ]));
        assert_eq!(
            rules,
            vec![
                FollowRule {
                    id: "a".into(),
                    criteria: AccessCriteria {
                        require_friend: true,
                        age: AgeRequirement::Adult,
                        groups_any: vec!["grp_x".into()],
                        exclude_safety_listed: false,
                    },
                },
                FollowRule {
                    id: "groups".into(),
                    criteria: AccessCriteria {
                        groups_any: vec!["grp_y".into(), "nope".into()],
                        ..AccessCriteria::default()
                    },
                },
            ]
        );
        assert!(parse_follow_rules(&json!({"id": "a"})).is_empty());
        assert!(parse_follow_rules(&Value::Null).is_empty());
    }

    #[test]
    fn merged_needs_cover_every_rule_once() {
        let mut needs = FactNeeds::default();
        needs.merge(FactNeeds {
            friend_status: true,
            user_profile: false,
            group_ids: vec!["grp_a".into()],
        });
        needs.merge(FactNeeds {
            friend_status: false,
            user_profile: true,
            group_ids: vec!["grp_a".into(), "grp_b".into()],
        });
        assert_eq!(
            needs,
            FactNeeds {
                friend_status: true,
                user_profile: true,
                group_ids: vec!["grp_a".into(), "grp_b".into()],
            }
        );
    }

    #[test]
    fn friend_status_requires_success_and_boolean() {
        assert_eq!(
            friend_status_from_response(200, &json!({"isFriend": true})),
            Some(true)
        );
        assert_eq!(
            friend_status_from_response(200, &json!({"isFriend": false})),
            Some(false)
        );
        assert_eq!(
            friend_status_from_response(200, &json!({"isFriend": "true"})),
            None
        );
        assert_eq!(
            friend_status_from_response(500, &json!({"isFriend": true})),
            None
        );
    }

    #[test]
    fn age_status_only_from_the_expected_user() {
        let body = json!({"id": "usr_a", "ageVerificationStatus": "18+"});
        assert_eq!(
            age_status_from_user_response(200, &body, "usr_a"),
            Some("18+".into())
        );
        assert_eq!(age_status_from_user_response(200, &body, "usr_b"), None);
        assert_eq!(age_status_from_user_response(200, &body, ""), None);
        assert_eq!(age_status_from_user_response(401, &body, "usr_a"), None);
        assert_eq!(
            age_status_from_user_response(200, &json!({"id": "usr_a"}), "usr_a"),
            None
        );
    }

    #[test]
    fn group_membership_reads_definite_answers_only() {
        let member = json!({"groupId": "grp_a", "userId": "usr_a", "membershipStatus": "member"});
        assert_eq!(
            group_membership_from_response(200, &member, "grp_a", "usr_a"),
            Some(true)
        );
        let requested =
            json!({"groupId": "grp_a", "userId": "usr_a", "membershipStatus": "requested"});
        assert_eq!(
            group_membership_from_response(200, &requested, "grp_a", "usr_a"),
            Some(false)
        );
        assert_eq!(
            group_membership_from_response(404, &json!({}), "grp_a", "usr_a"),
            Some(false)
        );
        assert_eq!(
            group_membership_from_response(403, &member, "grp_a", "usr_a"),
            None
        );
        assert_eq!(
            group_membership_from_response(200, &member, "grp_b", "usr_a"),
            None
        );
        assert_eq!(
            group_membership_from_response(200, &member, "grp_a", "usr_b"),
            None
        );
        assert_eq!(
            group_membership_from_response(
                200,
                &json!({"groupId": "grp_a", "userId": "usr_a"}),
                "grp_a",
                "usr_a"
            ),
            None
        );
    }
}
