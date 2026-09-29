pub(crate) fn copresence_caveats() -> Vec<String> {
    vec![
        "Co-presence total_minutes can be systemically low; use it for relative sorting, not exact duration.".into(),
        "minutes_by_access is based on parse_location and can miss transition or empty locations.".into(),
    ]
}

pub(crate) fn friend_activity_caveats() -> Vec<String> {
    vec![
        "Online events are reliable for observed friend availability but do not imply joinability."
            .into(),
    ]
}

pub(crate) fn worlds_visited_caveats() -> Vec<String> {
    vec![
        "World visit rows are based on this profile's local game log.".into(),
        "Several worlds may match a natural-language window; confirm the target before writing favorites.".into(),
    ]
}

pub(crate) fn visit_timeline_caveats() -> Vec<String> {
    vec![
        "Visit bounds and the roster come from this profile's local game log; only what VRCX-0-Nanashi observed while you were in the instance is included.".into(),
        "The visit you are still in has no leftAt (inProgress=true); an earlier visit without leftAt lost its leave record (crash or truncated log).".into(),
        "A person without leftAt is not known to have stayed: a crash or truncated log drops leave events.".into(),
        "A person without joinedAt was already inside before you arrived or before VRCX-0-Nanashi started watching.".into(),
        "Old rows may lack userId; those people are keyed by display name and cannot be marked isFriend.".into(),
        "sharedMinutes counts a stay with no leave event only up to your own leftAt; it is 0 while the visit is in progress.".into(),
    ]
}

pub(crate) fn favorite_local_caveats() -> Vec<String> {
    vec![
        "This writes only VRCX-0-Nanashi local favorites and does not change the VRChat account."
            .into(),
    ]
}

pub(crate) fn social_graph_caveats() -> Vec<String> {
    vec![
        "Social graph edges describe friend relationship data, not co-play or co-presence.".into(),
        "Nodes include friends-of-friends; isFriend marks which nodes are the signed-in user's own friends versus second-degree mutuals.".into(),
        "Only mutual graph snapshots that VRCX-0-Nanashi has fetched are represented.".into(),
        "Mutual data is fetched on demand and breaks when a friend opts out of Shared Connections; use refresh_mutual_graph to update.".into(),
    ]
}

pub(crate) fn friend_circles_caveats() -> Vec<String> {
    vec![
        "Friend circles use only mutual graph snapshots that VRCX-0-Nanashi has fetched.".into(),
        "Connected circles are graph components: members are connected through known friendship paths, not necessarily all pairwise friends.".into(),
        "Friends who opt out of Shared Connections or have not been fetched can make circles look smaller or isolated.".into(),
    ]
}

pub(crate) fn companions_caveats() -> Vec<String> {
    vec![
        "Companions are inferred from the local game log: players observed in the same instances the signed-in user attended.".into(),
        "Instances the signed-in user did not attend (including private rooms they were not in) are invisible, so a third party's full social circle is undercounted.".into(),
        "overlap_minutes counts time both players' observed stays overlapped; co-presence is undercounted when game-log stay durations are missing.".into(),
    ]
}

pub(crate) fn invite_history_caveats() -> Vec<String> {
    vec![
        "Invite history is based on notifications observed by this VRCX-0-Nanashi profile.".into(),
        "Sent invite coverage depends on whether the local notification row includes a receiver_user_id.".into(),
    ]
}

pub(crate) fn friend_log_caveats() -> Vec<String> {
    vec!["Friend log is observed relationship events for this profile.".into()]
}

pub(crate) fn friend_changes_caveats() -> Vec<String> {
    vec!["Friend changes are observed realtime feed events for this VRCX-0-Nanashi profile.".into()]
}

pub(crate) fn fading_friends_caveats() -> Vec<String> {
    vec![
        "Fading is a relative drop in observed co-presence between two equal-length windows, not proof a friend is avoiding you.".into(),
        "Co-presence undercounts private instances and unpaired join/leave rows, so use dropPercent for ranking, not as an exact figure.".into(),
        "Only users still present in the local friend roster are considered; removed friends are excluded.".into(),
    ]
}

pub(crate) fn best_time_caveats() -> Vec<String> {
    vec![
        "Buckets count observed friend online events; being online does not imply an instance you can join.".into(),
        "distinctFriends reflects only friends this profile observed coming online in the window.".into(),
    ]
}

pub(crate) fn recall_encounter_caveats() -> Vec<String> {
    vec![
        "Encounters come from the local game log and include non-friends who shared an instance with you.".into(),
        "coPresentWith matches shared instance ids within the window, not exact overlapping minutes.".into(),
        "isFriend reflects the current local friend roster, not the relationship at encounter time.".into(),
        "When many encounters match, only the most recent rows are scanned, so older encounters can be missed; narrow the window or name to widen coverage.".into(),
    ]
}
