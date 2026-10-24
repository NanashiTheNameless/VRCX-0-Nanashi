use super::*;

pub(crate) fn game_log_row_from_unified_row(row: &[Value]) -> Result<GameLogRowOutput, Error> {
    let event_type = strict_row_string(row, 2)?;
    let mut output = GameLogRowOutput {
        row_id: strict_row_i64(row, 0)?,
        created_at: strict_row_i64(row, 1)?,
        r#type: event_type.clone(),
        ..GameLogRowOutput::default()
    };
    match event_type.as_str() {
        "Location" => {
            output.location = strict_row_optional_string(row, 4)?;
            output.world_id = strict_row_optional_string(row, 7)?;
            output.world_name = strict_row_optional_string(row, 8)?;
            output.time = strict_row_optional_i64(row, 6)?;
            output.group_name = strict_row_optional_string(row, 9)?;
        }
        "OnPlayerJoined" | "OnPlayerLeft" => {
            output.display_name = strict_row_optional_string(row, 3)?;
            output.location = strict_row_optional_string(row, 4)?;
            output.user_id = strict_row_optional_string(row, 5)?;
            output.time = strict_row_optional_i64(row, 6)?;
        }
        "PortalSpawn" => {
            output.display_name = strict_row_optional_string(row, 3)?;
            output.location = strict_row_optional_string(row, 4)?;
            output.user_id = strict_row_optional_string(row, 5)?;
            output.instance_id = strict_row_optional_string(row, 10)?;
            output.world_name = strict_row_optional_string(row, 8)?;
        }
        "VideoPlay" => {
            output.video_url = strict_row_optional_string(row, 11)?;
            output.video_name = strict_row_optional_string(row, 12)?;
            output.video_id = strict_row_optional_string(row, 13)?;
            output.location = strict_row_optional_string(row, 4)?;
            output.display_name = strict_row_optional_string(row, 3)?;
            output.user_id = strict_row_optional_string(row, 5)?;
        }
        "Event" => {
            output.data = strict_row_optional_string(row, 16)?;
        }
        "External" => {
            output.message = strict_row_optional_string(row, 17)?;
            output.display_name = strict_row_optional_string(row, 3)?;
            output.user_id = strict_row_optional_string(row, 5)?;
            output.location = strict_row_optional_string(row, 4)?;
        }
        "StringLoad" | "ImageLoad" => {
            output.resource_url = strict_row_optional_string(row, 14)?;
            output.location = strict_row_optional_string(row, 4)?;
        }
        _ => {}
    }
    Ok(output)
}

pub(crate) fn game_log_base_columns(include_extra: bool) -> &'static str {
    if include_extra {
        "id, created_at, type, display_name, location, user_id, time, world_id, world_name, group_name, instance_id, video_url, video_name, video_id, resource_url, resource_type, data, message"
    } else {
        "id, created_at, type, display_name, location, user_id, time, world_id, world_name, group_name, instance_id, video_url, video_name, video_id, resource_url, resource_type"
    }
}

#[derive(Default)]
pub(crate) struct GameLogFilterFlags {
    pub(crate) location: bool,
    pub(crate) onplayerjoined: bool,
    pub(crate) onplayerleft: bool,
    pub(crate) portalspawn: bool,
    pub(crate) event: bool,
    pub(crate) external: bool,
    pub(crate) videoplay: bool,
    pub(crate) stringload: bool,
    pub(crate) imageload: bool,
}

pub(crate) fn game_log_filter_flags(filters: &[String], include_extra: bool) -> GameLogFilterFlags {
    let mut flags = GameLogFilterFlags {
        location: true,
        onplayerjoined: true,
        onplayerleft: true,
        portalspawn: true,
        event: include_extra,
        external: include_extra,
        videoplay: true,
        stringload: true,
        imageload: true,
    };
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if filters.is_empty() {
        return flags;
    }
    flags = GameLogFilterFlags::default();
    for filter in filters {
        match filter.as_str() {
            "Location" => flags.location = true,
            "OnPlayerJoined" => flags.onplayerjoined = true,
            "OnPlayerLeft" => flags.onplayerleft = true,
            "PortalSpawn" => flags.portalspawn = true,
            "Event" if include_extra => flags.event = true,
            "External" if include_extra => flags.external = true,
            "VideoPlay" => flags.videoplay = true,
            "StringLoad" => flags.stringload = true,
            "ImageLoad" => flags.imageload = true,
            _ => {}
        }
    }
    flags
}

pub(crate) fn game_log_batch_for_kind(
    kind: GameLogWriteKind,
    entries: Vec<Value>,
) -> GameLogWriteBatch {
    let mut batch = GameLogWriteBatch::default();
    match kind {
        GameLogWriteKind::Location => {
            batch.locations = entries
                .into_iter()
                .map(|entry| GameLogLocationEntry {
                    created_at: object_field_epoch(&entry, &["created_at", "createdAt"]),
                    location: object_field_string(&entry, &["location"]),
                    world_id: object_field_string(&entry, &["worldId", "world_id"]),
                    world_name: object_field_string(&entry, &["worldName", "world_name"]),
                    time: value_as_i64(object_field(&entry, "time").unwrap_or(&Value::Null)),
                    group_name: object_field_string(&entry, &["groupName", "group_name"]),
                })
                .collect();
        }
        GameLogWriteKind::LocationTime => {
            batch.location_time_updates = entries
                .into_iter()
                .map(|entry| GameLogLocationTimeUpdate {
                    created_at: object_field_epoch(&entry, &["created_at", "createdAt"]),
                    time: value_as_i64(object_field(&entry, "time").unwrap_or(&Value::Null)),
                })
                .collect();
        }
        GameLogWriteKind::JoinLeave => {
            batch.join_leave = entries
                .into_iter()
                .map(|entry| GameLogJoinLeaveEntry {
                    created_at: object_field_epoch(&entry, &["created_at", "createdAt"]),
                    event_type: object_field_string(&entry, &["type", "eventType"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    location: object_field_string(&entry, &["location"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                    world_name: object_field_string(&entry, &["worldName", "world_name"]),
                    time: value_as_i64(object_field(&entry, "time").unwrap_or(&Value::Null)),
                })
                .collect();
        }
        GameLogWriteKind::PortalSpawn => {
            batch.portal_spawns = entries
                .into_iter()
                .map(|entry| GameLogPortalSpawnEntry {
                    created_at: object_field_epoch(&entry, &["created_at", "createdAt"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    location: object_field_string(&entry, &["location"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                    instance_id: object_field_string(&entry, &["instanceId", "instance_id"]),
                    world_name: object_field_string(&entry, &["worldName", "world_name"]),
                })
                .collect();
        }
        GameLogWriteKind::VideoPlay => {
            batch.video_plays = entries
                .into_iter()
                .map(|entry| GameLogVideoPlayEntry {
                    created_at: object_field_epoch(&entry, &["created_at", "createdAt"]),
                    video_url: object_field_string(&entry, &["videoUrl", "video_url"]),
                    video_name: object_field_string(&entry, &["videoName", "video_name"]),
                    video_id: object_field_string(&entry, &["videoId", "video_id"]),
                    location: object_field_string(&entry, &["location"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                })
                .collect();
        }
        GameLogWriteKind::ResourceLoad
        | GameLogWriteKind::StringLoad
        | GameLogWriteKind::ImageLoad => {
            batch.resource_loads = entries
                .into_iter()
                .map(|entry| GameLogResourceLoadEntry {
                    created_at: object_field_epoch(&entry, &["created_at", "createdAt"]),
                    resource_url: object_field_string(&entry, &["resourceUrl", "resource_url"]),
                    resource_type: object_field_string(
                        &entry,
                        &["type", "resourceType", "resource_type"],
                    ),
                    location: object_field_string(&entry, &["location"]),
                })
                .collect();
        }
        GameLogWriteKind::Event => {
            batch.events = entries
                .into_iter()
                .map(|entry| GameLogEventEntry {
                    created_at: object_field_epoch(&entry, &["created_at", "createdAt"]),
                    data: object_field_string(&entry, &["data"]),
                })
                .collect();
        }
        GameLogWriteKind::External => {
            batch.externals = entries
                .into_iter()
                .map(|entry| GameLogExternalEntry {
                    created_at: object_field_epoch(&entry, &["created_at", "createdAt"]),
                    message: object_field_string(&entry, &["message"]),
                    display_name: object_field_string(&entry, &["displayName", "display_name"]),
                    user_id: object_field_string(&entry, &["userId", "user_id"]),
                    location: object_field_string(&entry, &["location"]),
                })
                .collect();
        }
    }
    batch
}
