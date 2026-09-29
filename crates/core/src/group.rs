use serde::{Deserialize, Serialize};

use crate::open_string_enum::open_string_enum;

open_string_enum! {
    pub enum GroupJoinState {
        Closed => "closed",
        Invite => "invite",
        Open => "open",
        Request => "request",
    }
}

open_string_enum! {
    pub enum GroupPrivacy {
        Default => "default",
        Private => "private",
    }
}

open_string_enum! {
    pub enum GroupMemberStatus {
        Banned => "banned",
        Inactive => "inactive",
        Invited => "invited",
        Member => "member",
        Requested => "requested",
        UserBlocked => "userblocked",
    }
}

open_string_enum! {
    pub enum GroupUserVisibility {
        Friends => "friends",
        Hidden => "hidden",
        Visible => "visible",
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum GroupJoinRequestAction {
    Accept,
    Reject,
}

#[cfg(test)]
mod tests {
    use std::fmt::Debug;

    use serde::{de::DeserializeOwned, Serialize};
    use serde_json::json;

    use super::{GroupJoinState, GroupMemberStatus, GroupPrivacy, GroupUserVisibility};

    fn assert_known_values<T>(values: impl IntoIterator<Item = (&'static str, T)>)
    where
        T: Debug + DeserializeOwned + PartialEq + Serialize,
    {
        for (value, expected) in values {
            let parsed: T = serde_json::from_value(json!(value)).unwrap();

            assert_eq!(parsed, expected, "{value}");
            assert_eq!(serde_json::to_value(parsed).unwrap(), json!(value));
        }
    }

    #[test]
    fn group_response_states_map_all_known_wire_values() {
        assert_known_values([
            ("closed", GroupJoinState::Closed),
            ("invite", GroupJoinState::Invite),
            ("open", GroupJoinState::Open),
            ("request", GroupJoinState::Request),
        ]);
        assert_known_values([
            ("default", GroupPrivacy::Default),
            ("private", GroupPrivacy::Private),
        ]);
        assert_known_values([
            ("banned", GroupMemberStatus::Banned),
            ("inactive", GroupMemberStatus::Inactive),
            ("invited", GroupMemberStatus::Invited),
            ("member", GroupMemberStatus::Member),
            ("requested", GroupMemberStatus::Requested),
            ("userblocked", GroupMemberStatus::UserBlocked),
        ]);
        assert_known_values([
            ("friends", GroupUserVisibility::Friends),
            ("hidden", GroupUserVisibility::Hidden),
            ("visible", GroupUserVisibility::Visible),
        ]);
    }
}
