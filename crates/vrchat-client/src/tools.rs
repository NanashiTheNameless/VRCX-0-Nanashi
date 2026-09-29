use std::collections::HashMap;

use serde_json::json;
#[cfg(test)]
use serde_json::Value;

use crate::http_api::{
    api_input, encode_path_segment, get_input, require_text, HttpApiError, HttpApiRequestInput,
};
use crate::query::serialize_query;

pub use vrcx_0_contracts::vrchat_requests::{CalendarListParams, InviteMessageType};

pub fn calendars_get_input(endpoint: String, params: CalendarListParams) -> HttpApiRequestInput {
    get_input(endpoint, "calendar", serialize_query(&params))
}

pub fn group_calendar_get_input(
    endpoint: String,
    group_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatToolsGroupCalendarGet requires groupId.")?;
    Ok((
        group_id.clone(),
        get_input(
            endpoint,
            format!("calendar/{}", encode_path_segment(&group_id)),
            HashMap::new(),
        ),
    ))
}

pub fn following_calendars_get_input(
    endpoint: String,
    params: CalendarListParams,
) -> HttpApiRequestInput {
    get_input(endpoint, "calendar/following", serialize_query(&params))
}

pub fn featured_calendars_get_input(
    endpoint: String,
    params: CalendarListParams,
) -> HttpApiRequestInput {
    get_input(endpoint, "calendar/featured", serialize_query(&params))
}

pub fn group_event_follow_input(
    endpoint: String,
    group_id: String,
    event_id: String,
    is_following: bool,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatToolsGroupEventFollow requires groupId.")?;
    let event_id = require_text(event_id, "VrchatToolsGroupEventFollow requires eventId.")?;
    Ok((
        event_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!(
                "calendar/{}/{}/follow",
                encode_path_segment(&group_id),
                encode_path_segment(&event_id)
            ),
            Some(json!({ "isFollowing": is_following })),
        ),
    ))
}

pub fn group_calendar_ics_get_input(
    endpoint: String,
    group_id: String,
    event_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatToolsGroupCalendarIcsGet requires groupId.")?;
    let event_id = require_text(event_id, "VrchatToolsGroupCalendarIcsGet requires eventId.")?;
    Ok((
        event_id.clone(),
        get_input(
            endpoint,
            format!(
                "calendar/{}/{}.ics",
                encode_path_segment(&group_id),
                encode_path_segment(&event_id)
            ),
            HashMap::new(),
        ),
    ))
}

pub fn user_note_save_input(
    endpoint: String,
    target_user_id: String,
    note: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let target_user_id = require_text(
        target_user_id,
        "VrchatToolsUserNoteSave requires targetUserId.",
    )?;
    Ok((
        target_user_id.clone(),
        api_input(
            endpoint,
            "POST",
            "userNotes",
            Some(json!({ "targetUserId": target_user_id, "note": note })),
        ),
    ))
}

pub fn user_report_input(
    endpoint: String,
    user_id: String,
    reason: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatToolsUserReport requires userId.")?;
    Ok((
        user_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!("feedback/{}/user", encode_path_segment(&user_id)),
            Some(json!({
                "contentType": "user",
                "reason": reason,
                "type": "report",
            })),
        ),
    ))
}

pub fn invite_messages_get_input(
    endpoint: String,
    current_user_id: String,
    message_type: InviteMessageType,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let current_user_id = require_text(
        current_user_id,
        "VrchatToolsInviteMessagesGet requires currentUserId.",
    )?;
    let message_type = message_type.as_str();
    Ok((
        current_user_id.clone(),
        get_input(
            endpoint,
            format!(
                "message/{}/{}",
                encode_path_segment(&current_user_id),
                encode_path_segment(message_type)
            ),
            HashMap::new(),
        ),
    ))
}

pub fn invite_message_edit_input(
    endpoint: String,
    current_user_id: String,
    message_type: InviteMessageType,
    slot: i32,
    message: String,
) -> Result<(i32, HttpApiRequestInput), HttpApiError> {
    let current_user_id = require_text(
        current_user_id,
        "VrchatToolsInviteMessageEdit requires currentUserId.",
    )?;
    let message_type = message_type.as_str();
    Ok((
        slot,
        api_input(
            endpoint,
            "PUT",
            format!(
                "message/{}/{}/{}",
                encode_path_segment(&current_user_id),
                encode_path_segment(message_type),
                slot
            ),
            Some(json!({ "message": message })),
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json_body(request: &HttpApiRequestInput) -> &Value {
        request.body.as_json().expect("expected JSON request body")
    }

    #[test]
    fn calendar_reads_keep_query_params_and_encode_identity_segments() {
        let params = CalendarListParams {
            n: Some(100),
            offset: Some(200),
            date: None,
        };
        let expected_params =
            HashMap::from([("n".into(), json!(100)), ("offset".into(), json!(200))]);
        for (name, request, path) in [
            (
                "all",
                calendars_get_input("endpoint".into(), params.clone()),
                "calendar",
            ),
            (
                "following",
                following_calendars_get_input("endpoint".into(), params.clone()),
                "calendar/following",
            ),
            (
                "featured",
                featured_calendars_get_input("endpoint".into(), params.clone()),
                "calendar/featured",
            ),
        ] {
            assert_eq!(request.method.as_deref(), Some("GET"), "{name}");
            assert_eq!(request.path.as_deref(), Some(path), "{name}");
            assert_eq!(
                request.query_params,
                Some(expected_params.clone()),
                "{name}"
            );
        }

        let (group_id, group) =
            group_calendar_get_input("endpoint".into(), " grp/雪 ".into()).unwrap();
        assert_eq!(group_id, "grp/雪");
        assert_eq!(group.path.as_deref(), Some("calendar/grp%2F%E9%9B%AA"));

        let (event_id, ics) =
            group_calendar_ics_get_input("endpoint".into(), " grp/1 ".into(), " evt 雪 ".into())
                .unwrap();
        assert_eq!(event_id, "evt 雪");
        assert_eq!(
            ics.path.as_deref(),
            Some("calendar/grp%2F1/evt%20%E9%9B%AA.ics")
        );
    }

    #[test]
    fn tool_mutations_build_the_original_request_bodies() {
        let (event_id, follow) =
            group_event_follow_input("endpoint".into(), " grp/1 ".into(), " evt 雪 ".into(), true)
                .unwrap();
        assert_eq!(event_id, "evt 雪");
        assert_eq!(follow.method.as_deref(), Some("POST"));
        assert_eq!(
            follow.path.as_deref(),
            Some("calendar/grp%2F1/evt%20%E9%9B%AA/follow")
        );
        assert_eq!(json_body(&follow), &json!({ "isFollowing": true }));

        let (target_user_id, note) = user_note_save_input(
            "endpoint".into(),
            " usr/1 ".into(),
            "  keep note whitespace  ".into(),
        )
        .unwrap();
        assert_eq!(target_user_id, "usr/1");
        assert_eq!(note.method.as_deref(), Some("POST"));
        assert_eq!(note.path.as_deref(), Some("userNotes"));
        assert_eq!(
            json_body(&note),
            &json!({ "targetUserId": "usr/1", "note": "  keep note whitespace  " })
        );

        let (_, report) =
            user_report_input("endpoint".into(), " usr/1 ".into(), "reason".into()).unwrap();
        assert_eq!(report.method.as_deref(), Some("POST"));
        assert_eq!(report.path.as_deref(), Some("feedback/usr%2F1/user"));
        assert_eq!(
            json_body(&report),
            &json!({ "contentType": "user", "reason": "reason", "type": "report" })
        );

        let (slot, edit) = invite_message_edit_input(
            "endpoint".into(),
            " usr/1 ".into(),
            InviteMessageType::Request,
            2,
            "Message".into(),
        )
        .unwrap();
        assert_eq!(slot, 2);
        assert_eq!(edit.method.as_deref(), Some("PUT"));
        assert_eq!(edit.path.as_deref(), Some("message/usr%2F1/request/2"));
        assert_eq!(json_body(&edit), &json!({ "message": "Message" }));
    }

    #[test]
    fn invite_message_read_trims_and_encodes_both_segments() {
        let (user_id, request) = invite_messages_get_input(
            "endpoint".into(),
            " usr/1 ".into(),
            InviteMessageType::RequestResponse,
        )
        .unwrap();

        assert_eq!(user_id, "usr/1");
        assert_eq!(request.method.as_deref(), Some("GET"));
        assert_eq!(
            request.path.as_deref(),
            Some("message/usr%2F1/requestResponse")
        );
    }

    #[test]
    fn tool_requests_reject_blank_required_ids() {
        assert!(group_calendar_get_input("".into(), " ".into()).is_err());
        assert!(group_event_follow_input("".into(), "group".into(), " ".into(), false,).is_err());
        assert!(group_calendar_ics_get_input("".into(), " ".into(), "event".into()).is_err());
        assert!(user_note_save_input("".into(), " ".into(), "note".into()).is_err());
        assert!(user_report_input("".into(), " ".into(), "reason".into(),).is_err());
        assert!(serde_json::from_str::<InviteMessageType>(r#""invite""#).is_err());
    }
}
