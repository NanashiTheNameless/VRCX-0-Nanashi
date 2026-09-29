use serde_json::Value;

use crate::{
    GroupAccessType, GroupJoinState, GroupMemberStatus, GroupPrivacy, GroupUserVisibility,
    InstanceRegion, InstanceType, PerformanceRating, ReleaseStatus,
};

#[derive(Clone, Copy, Debug)]
pub struct AvatarJson<'a> {
    value: &'a Value,
}

impl<'a> AvatarJson<'a> {
    pub fn new(value: &'a Value) -> Self {
        Self { value }
    }

    pub fn release_status(self) -> Option<ReleaseStatus> {
        enum_field(self.value, "releaseStatus")
    }

    pub fn performance_rating(self, platform: &str) -> Option<PerformanceRating> {
        enum_field(self.value.get("performance")?, platform)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct UnityPackageJson<'a> {
    value: &'a Value,
}

impl<'a> UnityPackageJson<'a> {
    pub fn new(value: &'a Value) -> Self {
        Self { value }
    }

    pub fn performance_rating(self) -> Option<PerformanceRating> {
        enum_field(self.value, "performanceRating")
    }
}

#[derive(Clone, Copy, Debug)]
pub struct GroupJson<'a> {
    value: &'a Value,
}

impl<'a> GroupJson<'a> {
    pub fn new(value: &'a Value) -> Self {
        Self { value }
    }

    pub fn id(self) -> Option<&'a str> {
        text_field(self.value, "id")
    }

    pub fn name(self) -> Option<&'a str> {
        text_field(self.value, "name")
    }

    pub fn join_state(self) -> Option<GroupJoinState> {
        enum_field(self.value, "joinState")
    }

    pub fn privacy(self) -> Option<GroupPrivacy> {
        enum_field(self.value, "privacy")
    }

    pub fn membership_status(self) -> Option<GroupMemberStatus> {
        enum_field(self.value, "membershipStatus")
    }

    pub fn my_member(self) -> Option<GroupMemberJson<'a>> {
        self.value.get("myMember").map(GroupMemberJson::new)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct GroupMemberJson<'a> {
    value: &'a Value,
}

impl<'a> GroupMemberJson<'a> {
    pub fn new(value: &'a Value) -> Self {
        Self { value }
    }

    pub fn membership_status(self) -> Option<GroupMemberStatus> {
        enum_field(self.value, "membershipStatus")
    }

    pub fn visibility(self) -> Option<GroupUserVisibility> {
        enum_field(self.value, "visibility")
    }
}

#[derive(Clone, Copy, Debug)]
pub struct GroupInstanceJson<'a> {
    value: &'a Value,
}

impl<'a> GroupInstanceJson<'a> {
    pub fn new(value: &'a Value) -> Self {
        Self { value }
    }

    pub fn location(self) -> Option<&'a str> {
        self.text_field("location")
    }

    pub fn instance_type(self) -> Option<InstanceType> {
        self.enum_field("type")
    }

    pub fn group_access_type(self) -> Option<GroupAccessType> {
        self.enum_field("groupAccessType")
    }

    pub fn region(self) -> Option<InstanceRegion> {
        self.enum_field("region")
    }

    pub fn photon_region(self) -> Option<InstanceRegion> {
        self.enum_field("photonRegion")
    }

    pub fn minimum_avatar_performance(self) -> Option<PerformanceRating> {
        self.enum_field("minimumAvatarPerformance")
    }

    fn text_field(self, key: &str) -> Option<&'a str> {
        text_field(self.value, key).or_else(|| text_field(self.value.get("instance")?, key))
    }

    fn enum_field<T>(self, key: &str) -> Option<T>
    where
        for<'value> T: From<&'value str>,
    {
        self.text_field(key).map(T::from)
    }
}

fn text_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn enum_field<T>(value: &Value, key: &str) -> Option<T>
where
    for<'value> T: From<&'value str>,
{
    text_field(value, key).map(T::from)
}

pub fn response_error_message(payload: &Value, status: i32, action: &str) -> String {
    payload
        .get("error")
        .and_then(Value::as_object)
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| payload.get("message").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| format!("VRChat {action} failed with HTTP {status}."))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn avatar_views_read_known_and_unknown_values() {
        let value = json!({
            "releaseStatus": "public",
            "performance": {
                "standalonewindows": "Medium",
                "android": "future-rating"
            },
            "unityPackages": [{
                "performanceRating": "VeryPoor",
                "platform": "standalonewindows"
            }]
        });
        let avatar = AvatarJson::new(&value);
        let unity_package = UnityPackageJson::new(&value["unityPackages"][0]);

        assert_eq!(avatar.release_status(), Some(ReleaseStatus::Public));
        assert_eq!(
            avatar.performance_rating("standalonewindows"),
            Some(PerformanceRating::Medium)
        );
        assert_eq!(
            avatar.performance_rating("android"),
            Some(PerformanceRating::Unknown("future-rating".into()))
        );
        assert_eq!(
            unity_package.performance_rating(),
            Some(PerformanceRating::VeryPoor)
        );
    }

    #[test]
    fn group_views_read_profile_and_member_states() {
        let value = json!({
            "id": "grp_test",
            "name": " Test Group ",
            "joinState": "open",
            "privacy": "default",
            "membershipStatus": "member",
            "myMember": {
                "membershipStatus": "future-member",
                "visibility": "visible"
            }
        });
        let group = GroupJson::new(&value);
        let member = group.my_member().unwrap();

        assert_eq!(group.id(), Some("grp_test"));
        assert_eq!(group.name(), Some("Test Group"));
        assert_eq!(group.join_state(), Some(GroupJoinState::Open));
        assert_eq!(group.privacy(), Some(GroupPrivacy::Default));
        assert_eq!(group.membership_status(), Some(GroupMemberStatus::Member));
        assert_eq!(
            member.membership_status(),
            Some(GroupMemberStatus::Unknown("future-member".into()))
        );
        assert_eq!(member.visibility(), Some(GroupUserVisibility::Visible));
    }

    #[test]
    fn group_instance_view_supports_direct_and_nested_shapes() {
        let direct = json!({
            "location": " wrld_test:1~group(grp_test) ",
            "type": "group",
            "groupAccessType": "plus",
            "region": "jp",
            "photonRegion": "unknown",
            "minimumAvatarPerformance": "None"
        });
        let nested = json!({
            "location": " ",
            "instance": {
                "location": "wrld_nested:2",
                "type": "future-type",
                "groupAccessType": "future-access",
                "region": "future-region",
                "minimumAvatarPerformance": "future-rating"
            }
        });
        let direct = GroupInstanceJson::new(&direct);
        let nested = GroupInstanceJson::new(&nested);

        assert_eq!(direct.location(), Some("wrld_test:1~group(grp_test)"));
        assert_eq!(direct.instance_type(), Some(InstanceType::Group));
        assert_eq!(direct.group_access_type(), Some(GroupAccessType::Plus));
        assert_eq!(direct.region(), Some(InstanceRegion::Jp));
        assert_eq!(direct.photon_region(), Some(InstanceRegion::ApiUnknown));
        assert_eq!(
            direct.minimum_avatar_performance(),
            Some(PerformanceRating::None)
        );
        assert_eq!(nested.location(), Some("wrld_nested:2"));
        assert_eq!(
            nested.instance_type(),
            Some(InstanceType::Unknown("future-type".into()))
        );
        assert_eq!(
            nested.group_access_type(),
            Some(GroupAccessType::Unknown("future-access".into()))
        );
        assert_eq!(
            nested.region(),
            Some(InstanceRegion::Unknown("future-region".into()))
        );
        assert_eq!(
            nested.minimum_avatar_performance(),
            Some(PerformanceRating::Unknown("future-rating".into()))
        );
    }

    #[test]
    fn views_ignore_missing_null_and_wrong_typed_fields() {
        let avatar_value = json!({"releaseStatus": null, "performance": []});
        let group_value = json!({"joinState": 1, "myMember": null});
        let instance_value = json!({"type": false, "region": {}});
        let avatar = AvatarJson::new(&avatar_value);
        let group = GroupJson::new(&group_value);
        let instance = GroupInstanceJson::new(&instance_value);

        assert_eq!(avatar.release_status(), None);
        assert_eq!(avatar.performance_rating("standalonewindows"), None);
        assert_eq!(group.join_state(), None);
        assert_eq!(
            group.my_member().and_then(|member| member.visibility()),
            None
        );
        assert_eq!(instance.instance_type(), None);
        assert_eq!(instance.region(), None);
    }
}
