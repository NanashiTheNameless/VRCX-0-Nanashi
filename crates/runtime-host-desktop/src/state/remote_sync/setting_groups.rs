use super::OTHER_SETTING_GROUP;

pub(super) const SETTING_GROUPS: &[(&str, &[&str], &[&str])] = &[
    (
        "general",
        &[
            "autoupdate",
            "autoinstallupdates",
            "autologindelay",
            "backgroundmode",
            "closetotray",
            "relaunchvrchat",
            "focusvrchat",
            "vrcquitfix",
            "autosweep",
            "avatarautocleanup",
            "deeplink",
            "applauncher",
            "vrcregistry",
        ],
        &[
            "logresourceload",
            "udonexceptionlogging",
            "keepsystemawake",
            "systemwindowframe",
            "onboarding_welcome_seen",
            "laststartedversion",
            "0_windowalwaysontop",
            "0_windowdisplaymode",
            "databaselocation",
            "gameisolationenabled",
        ],
    ),
    (
        "appearance",
        &[
            "theme",
            "lastdarktheme",
            "font",
            "customfont",
            "cjkfont",
            "backgroundimage",
            "officialbackground",
            "communitytheme",
            "randomusercolour",
            "showuserdialog",
            "showhovercard",
            "showsidebaravatarframe",
            "showsidebarnameplate",
            "showfriendslocations",
            "showactivityjourney",
            "tablepagesize",
        ],
        &[
            "accessiblestatusindicators",
            "applanguage",
            "biolanguage",
            "zoomlevel",
            "dthour12",
            "dtdateformat",
            "dtisoformat",
            "weekstartson",
            "trustcolor",
            "reducedmotionandblur",
            "compacttablemode",
            "datatablestriped",
            "tabledensity",
            "hidenicknames",
            "hideusermemos",
            "hideusernotes",
            "showinstanceidinlocation",
            "isagegatedinstancesvisible",
        ],
    ),
    (
        "layout",
        &[
            "sidebar",
            "nav",
            "isfriendsgroup",
            "friendlocation",
            "myavatars",
            "mutualgraph",
            "activity",
            "overlapexclude",
            "statusbar",
            "customnavmenu",
            "dashboard",
            "instanceactivity",
            "mygroups",
        ],
        &[
            "rightsidebaropen",
            "ishidefriendsinsameinstance",
            "issameinstanceabovefavorites",
            "issidebardividebyfriendgroup",
            "instanceactivitybarwidth",
            "userdialogavatarsort",
            "shownewdashboardbutton",
            "toolsrecentlist",
            "toolsquickaccesslist",
            "0_gallerygriddensity",
            "0_inventorygriddensity",
            "0_rightsidebarrouteopenstate",
            "0_rightsidebarwidth",
            "0_sidebarwindowwidth",
            "0_userdialogmutualview",
        ],
    ),
    (
        "feed",
        &["feed", "gamelog", "friendlog", "recentactioncooldown"],
        &[
            "hidedevicesfromfeed",
            "hideprivatefromfeed",
            "hideuptimefromfeed",
            "hideunfriends",
            "pcuptimeonfeed",
            "minimalfeed",
            "browsehistoryretentiondays",
            "maxtablesize_v2",
            "searchlimit",
            "playermoderationtablefilters",
            "recentactions",
        ],
    ),
    (
        "favorites",
        &["favorites", "localfavorite", "maxfavorite"],
        &[],
    ),
    (
        "instances",
        &["instancedialog", "instanceregion", "groupcalendar"],
        &[],
    ),
    (
        "avatars",
        &["avatarremotedatabase"],
        &["0_nanashi_avatarsearchdisabledproviders"],
    ),
    (
        "media",
        &[
            "screenshot",
            "0_screenshot",
            "saveinstance",
            "cropinstance",
            "autodeleteprints",
            "autodeleteoldprints",
        ],
        &[],
    ),
    (
        "notifications",
        &["notification", "desktopnotification", "ttsnotification"],
        &[
            "desktoptoast",
            "afkdesktoptoast",
            "imagenotifications",
            "busystatusdonotdisturb",
            "hidevideoerrornotifications",
            "taskbaricondot",
            "showpostupdatechangelogtoast",
            "seenpostupdatechangelogversion",
        ],
    ),
    (
        "overlay",
        &["wristoverlay", "hmdnotification", "desktopwidget", "ovrt"],
        &[
            "overlaytoast",
            "overlayactivityfilters",
            "vrnotificationactivityfilters",
            "xsnotifications",
            "vroverlaypanelenabled",
            "vroverlaypanelallfriendsincludesfavorites",
            "vrcx-0_notificationopacity",
            "vrcx-0_notificationtimeout",
            "vrcx-0_xsnotifications",
        ],
    ),
    ("safety", &["safety", "watchlist"], &[]),
    (
        "automation",
        &["autoaccept", "autodecline", "presenceautomation"],
        &[],
    ),
    (
        "social",
        &["discord"],
        &["booprecentemojis", "statuspresets"],
    ),
    ("assistant", &["socialai", "assistant", "reminder"], &[]),
];

pub(super) fn setting_group(key: &str) -> &'static str {
    let key = key.trim().to_ascii_lowercase();
    let name = key.strip_prefix("config:vrcx_").unwrap_or(&key);
    SETTING_GROUPS
        .iter()
        .find(|(_, prefixes, names)| {
            names.contains(&name) || prefixes.iter().any(|prefix| name.starts_with(prefix))
        })
        .map_or(OTHER_SETTING_GROUP, |(group, ..)| group)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::remote_sync::syncable_app_setting;
    use std::collections::BTreeSet;

    #[test]
    fn related_preferences_stay_together_despite_words_in_their_names() {
        for (name, expected) in [
            ("autoUpdateVRCX", "general"),
            ("backgroundModeDelayMinutes", "general"),
            ("focusVrchatOnJoin", "general"),
            ("accessibleStatusIndicators", "appearance"),
            ("showSidebarAvatarFrame", "appearance"),
            ("showHoverCardNameplate", "appearance"),
            ("showActivityJourneyAvatarFrame", "appearance"),
            ("friendLocationDensity", "layout"),
            ("customNavMenuLayoutList", "layout"),
            ("dashboardConfigs", "layout"),
            ("instanceActivitySoloInstanceVisible", "layout"),
            ("myGroupsJoinedSectionOpen", "layout"),
            ("toolsQuickAccessList", "layout"),
            ("overlapExcludeStart", "layout"),
            ("groupCalendarShowFeaturedEvents", "instances"),
            ("instanceDialogQueueEnabled", "instances"),
            ("localFavoriteWorldGroups", "favorites"),
            ("maxFavoritesPerGroup", "favorites"),
            ("favoritesAvatarDensity", "favorites"),
            ("avatarRemoteDatabaseProviderList", "avatars"),
            ("0_Nanashi_avatarSearchDisabledProviders", "avatars"),
            ("cropInstancePrints", "media"),
            ("autoDeletePrintsLimit", "media"),
            ("screenshotHelperCopyToClipboard", "media"),
            ("notificationTableFilters", "notifications"),
            ("busyStatusDoNotDisturb", "notifications"),
            ("desktopNotificationActivityFilters", "notifications"),
            ("ttsNotificationActivityFilters", "notifications"),
            ("showPostUpdateChangelogToast", "notifications"),
            ("overlayActivityFilters", "overlay"),
            ("vrNotificationActivityFilters", "overlay"),
            ("desktopWidgetActivityFilters", "overlay"),
            ("hmdNotificationActivityFilters", "overlay"),
            ("feedHiddenUsersHideNotifications", "feed"),
            ("friendLogNotificationDot", "feed"),
            ("safetyGlobalHide", "safety"),
            ("autoAcceptInviteRequests", "automation"),
            ("presenceAutomationTimeRules", "automation"),
            ("discordHideImage", "social"),
            ("discordHideInvite", "social"),
            ("discordShowPlatform", "social"),
            ("discordJoinButton", "social"),
            ("statusPresets", "social"),
            ("assistantReasoningEffort", "assistant"),
        ] {
            assert_eq!(
                setting_group(&format!("config:vrcx_{name}")),
                expected,
                "{name}"
            );
        }
        assert_eq!(setting_group(" config:VRCX_DiscordHideImage "), "social");
        assert_eq!(setting_group("config:vrcx_unknownshowsetting"), "other");
        assert_eq!(setting_group("config:vrcx_unknownactivitysetting"), "other");
    }

    #[test]
    fn every_known_syncable_setting_has_a_category_with_a_label() {
        let locale: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src/localization/en.json"
        )))
        .unwrap();
        let sync = &locale["view"]["settings"]["history_sync"];
        let mut names = sync["setting_names"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<BTreeSet<_>>();
        for source in [
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../src/repositories/configKeys.ts"
            )),
            include_str!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../../src/features/settings/components/settings-tabs/syncSettingLabels.ts"
            )),
        ] {
            names.extend(source.lines().filter_map(|line| {
                let line = line.strip_prefix("    ")?;
                if line.starts_with(' ') {
                    return None;
                }
                let (name, value) = line.split_once(':')?;
                (value.starts_with(" {") || value.starts_with(" ["))
                    .then(|| name.to_ascii_lowercase())
            }));
        }
        let mut used = BTreeSet::new();
        for name in names {
            let key = format!("config:vrcx_{name}");
            if !syncable_app_setting(&key) {
                continue;
            }
            let group = setting_group(&key);
            assert_ne!(group, OTHER_SETTING_GROUP, "{name} has no category");
            used.insert(group);
        }
        let mut unique = BTreeSet::new();
        for (group, ..) in SETTING_GROUPS {
            assert!(unique.insert(group), "duplicate category: {group}");
            assert!(used.contains(group), "empty category: {group}");
            assert!(
                sync["setting_groups"][group].is_string(),
                "{group} has no label"
            );
        }
    }
}
