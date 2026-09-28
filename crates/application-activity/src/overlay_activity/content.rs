use serde_json::Value;
use vrcx_0_core::friends::{normalize_user_status, UserStatus};
use vrcx_0_core::json::JsonExt;
use vrcx_0_core::location::{format_display_location, parse_location};
use vrcx_0_core::text::{first_non_empty, first_non_empty_owned};
use vrcx_0_i18n::OverlayMessage;

use super::types::{
    OverlayActivityCandidate, OverlayActivityCategory, OverlayActivityContent, OverlayActivityText,
};

pub(super) fn build_activity_content(
    activity_type: &str,
    category: OverlayActivityCategory,
    candidate: &OverlayActivityCandidate,
    actor_display_name: &str,
) -> OverlayActivityContent {
    let payload = &candidate.payload;
    let title_name = first_non_empty_owned([
        actor_display_name,
        payload.trimmed_field("displayName").unwrap_or_default(),
        payload.trimmed_field("senderUsername").unwrap_or_default(),
        payload
            .trimmed_field("senderDisplayName")
            .unwrap_or_default(),
        payload.trimmed_field("userId").unwrap_or_default(),
        payload.trimmed_field("senderUserId").unwrap_or_default(),
    ]);
    let location = first_non_empty_owned([
        payload.trimmed_field("location").unwrap_or_default(),
        nested_str(payload, &["details", "location"]),
        nested_str(payload, &["details", "worldId"]),
        nested_str(payload, &["instanceLocation"]),
    ]);
    let world_name = first_non_empty_owned([
        payload.trimmed_field("worldName").unwrap_or_default(),
        nested_str(payload, &["details", "worldName"]),
    ]);
    let group_name = first_non_empty_owned([
        payload.trimmed_field("groupName").unwrap_or_default(),
        nested_str(payload, &["details", "groupName"]),
        nested_str(payload, &["data", "groupName"]),
    ]);
    let parsed_location = parse_location(&location);
    let display_location = first_non_empty([
        payload.trimmed_field("displayLocation").unwrap_or_default(),
        nested_str(payload, &["details", "displayLocation"]),
    ]);
    let display_location = if display_location.is_empty() {
        format_display_location(&parsed_location, &world_name, &group_name)
    } else {
        display_location.to_string()
    };

    let mut content = match activity_type {
        "SafetyGroup" | "SafetyAvatar" | "SafetyCommunity" | "SafetyUrl" => titled_body(
            "shield",
            &payload.trimmed_text("title"),
            literal_body(payload.trimmed_text("message")),
        ),
        "Reminder" => titled_body(
            "bell",
            &payload.trimmed_text("title"),
            literal_body(payload.trimmed_text("message")),
        ),
        "OnPlayerJoining" => titled_body(
            "instance",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_is_joining()),
        ),
        "OnPlayerJoined" => titled_body(
            "instance",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_has_joined()),
        ),
        "OnPlayerLeft" => titled_body(
            "instance",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_has_left()),
        ),
        "GPS" => titled_body(
            "location",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_gps(&display_location)),
        ),
        "Online" => {
            let body = if readable_name(&world_name).is_empty() {
                OverlayActivityText::message(OverlayMessage::notifications_online())
            } else {
                OverlayActivityText::message(OverlayMessage::notifications_online_location(
                    &display_location,
                ))
            };
            titled_body("status-online", &title_name, body)
        }
        "Offline" => titled_body(
            "status-offline",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_offline()),
        ),
        "Status" => {
            let status = payload.trimmed_text("status");
            let description = payload.trimmed_text("statusDescription");
            titled_body(
                status_icon(&status),
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_status_update(
                    &status,
                    &description,
                )),
            )
        }
        "AvatarChange" => {
            let avatar = first_non_empty_owned([
                payload.trimmed_field("avatarName").unwrap_or_default(),
                payload.trimmed_field("name").unwrap_or_default(),
            ]);
            titled_body(
                "avatar",
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_avatar_change(&avatar)),
            )
        }
        "Bio" => titled_body(
            "bio",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_bio()),
        ),
        "Friend" => titled_body(
            "friend",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_friend()),
        ),
        "Unfriend" => titled_body(
            "friend",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_unfriend()),
        ),
        "DisplayName" => {
            let display_name = payload.trimmed_text("displayName");
            let title = match payload.trimmed_field("previousDisplayName") {
                Some(previous_display_name) => previous_display_name.to_string(),
                None => title_name,
            };
            titled_body(
                "profile",
                &title,
                OverlayActivityText::message(OverlayMessage::notifications_display_name(
                    &display_name,
                )),
            )
        }
        "TrustLevel" => {
            let trust_level = payload.trimmed_text("trustLevel");
            titled_body(
                "profile",
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_trust_level(
                    &trust_level,
                )),
            )
        }
        "invite" => {
            let message = detail_message(payload);
            titled_body(
                "invite",
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_invite(
                    &display_location,
                    message,
                )),
            )
        }
        "requestInvite" => {
            let message = detail_message(payload);
            titled_body(
                "request",
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_request_invite(message)),
            )
        }
        "inviteResponse" => {
            let message = detail_message(payload);
            titled_body(
                "invite",
                &title_name,
                OverlayActivityText::message(OverlayMessage::notifications_invite_response(
                    message,
                )),
            )
        }
        "requestInviteResponse" => {
            let message = detail_message(payload);
            titled_body(
                "request",
                &title_name,
                OverlayActivityText::message(
                    OverlayMessage::notifications_request_invite_response(message),
                ),
            )
        }
        "friendRequest" => titled_body(
            "friend",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_friend_request()),
        ),
        "boop" | "groupChange" => titled_body(
            group_or_direct_icon(activity_type),
            &title_name,
            literal_body(payload.trimmed_text("message")),
        ),
        "group.announcement" => group_message(
            OverlayMessage::notifications_group_announcement_title(),
            payload,
        ),
        "group.informative" => group_message(
            OverlayMessage::notifications_group_informative_title(),
            payload,
        ),
        "group.invite" => {
            group_message(OverlayMessage::notifications_group_invite_title(), payload)
        }
        "group.joinRequest" => group_message(
            OverlayMessage::notifications_group_join_request_title(),
            payload,
        ),
        "group.transfer" => group_message(
            OverlayMessage::notifications_group_transfer_request_title(),
            payload,
        ),
        "group.queueReady" => activity_content(
            "group",
            OverlayActivityText::message(OverlayMessage::notifications_group_queue_ready_title()),
            literal_body(payload.trimmed_text("message")),
        ),
        "group.instanceOpened" => {
            let body = match payload.get("count").and_then(Value::as_u64).unwrap_or(1) {
                count if count > 1 => OverlayActivityText::message(
                    OverlayMessage::notifications_group_instances_opened(count),
                ),
                _ if !display_location.is_empty() => OverlayActivityText::message(
                    OverlayMessage::notifications_group_instance_opened_location(&display_location),
                ),
                _ => OverlayActivityText::message(
                    OverlayMessage::notifications_group_instance_opened(),
                ),
            };
            activity_content(
                "group",
                OverlayActivityText::literal(first_non_empty_owned([
                    group_name.as_str(),
                    payload.trimmed_field("groupId").unwrap_or_default(),
                ])),
                body,
            )
        }
        "instance.closed" => activity_content(
            "instance",
            OverlayActivityText::message(OverlayMessage::notifications_instance_closed_title()),
            literal_body(payload.trimmed_text("message")),
        ),
        "Event" => keyed_title_body(
            "system",
            OverlayMessage::notifications_event_title(),
            literal_body(first_non_empty_owned([
                payload.trimmed_field("data").unwrap_or_default(),
                payload.trimmed_field("message").unwrap_or_default(),
            ])),
        ),
        "External" => keyed_title_body(
            "system",
            OverlayMessage::notifications_external_title(),
            literal_body(payload.trimmed_text("message")),
        ),
        "Blocked" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_blocked()),
        ),
        "Unblocked" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_unblocked()),
        ),
        "Muted" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_muted()),
        ),
        "Unmuted" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_unmuted()),
        ),
        "BlockedOnPlayerJoined" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_blocked_player_joined()),
        ),
        "BlockedOnPlayerLeft" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_blocked_player_left()),
        ),
        "MutedOnPlayerJoined" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_muted_player_joined()),
        ),
        "MutedOnPlayerLeft" => titled_body(
            "shield",
            &title_name,
            OverlayActivityText::message(OverlayMessage::notifications_muted_player_left()),
        ),
        "VideoPlay" => keyed_title_body(
            "media",
            OverlayMessage::notifications_video_play_title(),
            literal_body(first_non_empty_owned([
                payload.trimmed_field("videoName").unwrap_or_default(),
                payload.trimmed_field("notyName").unwrap_or_default(),
                payload.trimmed_field("message").unwrap_or_default(),
                payload.trimmed_field("videoUrl").unwrap_or_default(),
            ])),
        ),
        _ => category_content(category, &title_name, activity_type, payload),
    };

    content.location = location;
    content.world_id = match payload.trimmed_field("worldId") {
        Some(world_id) => world_id.to_string(),
        None => parsed_location.world_id,
    };
    content.display_location = display_location.clone();
    content.world_name = world_name;
    content.group_name = group_name;
    content.status = payload.trimmed_text("status");
    content.status_description = payload.trimmed_text("statusDescription");
    content.avatar_name = first_non_empty_owned([
        payload.trimmed_field("avatarName").unwrap_or_default(),
        payload.trimmed_field("name").unwrap_or_default(),
    ]);
    content.image_url = first_non_empty_owned([
        payload
            .trimmed_field("thumbnailImageUrl")
            .unwrap_or_default(),
        nested_str(payload, &["details", "imageUrl"]),
        payload.trimmed_field("imageUrl").unwrap_or_default(),
        payload
            .trimmed_field("currentAvatarThumbnailImageUrl")
            .unwrap_or_default(),
        payload
            .trimmed_field("currentAvatarImageUrl")
            .unwrap_or_default(),
        payload.trimmed_field("thumbnailUrl").unwrap_or_default(),
    ]);
    content.detail = first_non_empty_owned([
        detail_message(payload),
        content.status_description.as_str(),
        content.avatar_name.as_str(),
        display_location.as_str(),
    ]);
    content.summary = summary(&content.title.source_text(), &content.body.source_text());
    content
}

fn category_content(
    category: OverlayActivityCategory,
    title: &str,
    activity_type: &str,
    payload: &Value,
) -> OverlayActivityContent {
    let icon = match category {
        OverlayActivityCategory::ActionRequired => "invite",
        OverlayActivityCategory::CurrentInstance => "instance",
        OverlayActivityCategory::FavoriteMovement => "status",
        OverlayActivityCategory::ProfileChange => "profile",
        OverlayActivityCategory::GroupSocial => "group",
        OverlayActivityCategory::SystemSafety => "system",
        OverlayActivityCategory::Media => "media",
    };
    titled_body(
        icon,
        title,
        literal_body(first_non_empty_owned([
            payload.trimmed_field("message").unwrap_or_default(),
            activity_type,
        ])),
    )
}

fn group_message(message: OverlayMessage, payload: &Value) -> OverlayActivityContent {
    activity_content(
        "group",
        OverlayActivityText::message(message),
        literal_body(payload.trimmed_text("message")),
    )
}

fn titled_body(icon: &str, title: &str, body: OverlayActivityText) -> OverlayActivityContent {
    activity_content(icon, literal_title(title), body)
}

fn keyed_title_body(
    icon: &str,
    title: OverlayMessage,
    body: OverlayActivityText,
) -> OverlayActivityContent {
    activity_content(icon, OverlayActivityText::message(title), body)
}

fn activity_content(
    icon: &str,
    title: OverlayActivityText,
    body: OverlayActivityText,
) -> OverlayActivityContent {
    OverlayActivityContent {
        icon: icon.to_string(),
        title,
        body,
        ..OverlayActivityContent::default()
    }
}

fn literal_title(value: &str) -> OverlayActivityText {
    OverlayActivityText::literal(value.trim())
}

fn literal_body(value: String) -> OverlayActivityText {
    OverlayActivityText::literal(value.trim())
}

fn summary(title: &str, body: &str) -> String {
    match (!title.trim().is_empty(), !body.trim().is_empty()) {
        (true, true) => format!("{} {}", title.trim(), body.trim()),
        (true, false) => title.trim().to_string(),
        (false, true) => body.trim().to_string(),
        (false, false) => String::new(),
    }
}

fn status_icon(status: &str) -> &'static str {
    if normalize_user_status(status) == "online" {
        return "status-online";
    }
    match UserStatus::normalize(status) {
        Some(UserStatus::Active) => "status-online",
        Some(UserStatus::JoinMe) => "status-joinme",
        Some(UserStatus::AskMe) => "status-askme",
        Some(UserStatus::Busy) => "status-busy",
        Some(UserStatus::Offline) | None => "status",
    }
}

fn group_or_direct_icon(activity_type: &str) -> &'static str {
    if activity_type == "groupChange" {
        "group"
    } else {
        "invite"
    }
}

fn detail_message(payload: &Value) -> &str {
    first_non_empty([
        nested_str(payload, &["details", "inviteMessage"]),
        nested_str(payload, &["details", "requestMessage"]),
        nested_str(payload, &["details", "responseMessage"]),
        payload.trimmed_field("message").unwrap_or_default(),
    ])
}

fn readable_name(value: &str) -> &str {
    let trimmed = value.trim();
    if is_location_id_like(trimmed) {
        ""
    } else {
        trimmed
    }
}

fn is_location_id_like(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed == "private"
        || trimmed == "private:private"
        || trimmed.starts_with("wrld_")
        || trimmed.starts_with("grp_")
}

pub(super) fn nested_str<'a>(value: &'a Value, path: &[&str]) -> &'a str {
    let mut current = value;
    for key in path {
        let Some(next) = current.get(key) else {
            return "";
        };
        current = next;
    }
    current.as_str().map(str::trim).unwrap_or_default()
}
