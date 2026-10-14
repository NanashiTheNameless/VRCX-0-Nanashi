// Config key name (lower case, without the VRCX_ prefix) to the label the
// setting has in the app, and the card or dialog it sits in.
type SyncSettingLabel = readonly [label: string, section?: string];

const GENERAL = 'view.settings.general';
const APPEARANCE = 'view.settings.appearance';
const ADVANCED = 'view.settings.advanced';
const NOTIFICATIONS = 'view.settings.notifications.notifications';
const VR = 'view.settings.vr';
const TABLE_LIMITS = 'prompt.table_entries_settings';

const DESKTOP = `${NOTIFICATIONS}.desktop_notifications`;
const VR_NOTIFICATIONS = `${NOTIFICATIONS}.vr_notifications`;
const DO_NOT_DISTURB = `${NOTIFICATIONS}.do_not_disturb`;
const TTS = `${NOTIFICATIONS}.text_to_speech`;
const HMD = `${VR}.hmd_notifications`;
const WRIST = `${VR}.wrist_overlay`;
const SCREENSHOT = `${ADVANCED}.advanced.screenshot_helper`;
const PRINTS = `${ADVANCED}.advanced.save_instance_prints_to_file`;
const AUTO_DELETE_PRINTS = `${ADVANCED}.advanced.auto_delete_prints`;
const BEHAVIOR = `${ADVANCED}.advanced_ui.behavior`;
const STORAGE = `${ADVANCED}.advanced_ui.storage`;
const TROUBLESHOOTING = `${ADVANCED}.advanced_ui.troubleshooting`;

export const syncSettingLabels: Record<string, SyncSettingLabel> = {
    applanguage: [`${APPEARANCE}.appearance.language`],
    autoupdatevrcx: [
        `${GENERAL}.application.update_mode`,
        `${GENERAL}.application.updates_header`
    ],
    autoinstallupdatesonstartup: [
        `${GENERAL}.application.auto_install_updates_on_startup`,
        `${GENERAL}.application.updates_header`
    ],
    closetotray: [
        `${GENERAL}.application.tray`,
        `${GENERAL}.application.window_header`
    ],
    backgroundmodeenabled: [
        `${GENERAL}.application.background_mode`,
        `${GENERAL}.application.window_header`
    ],
    backgroundmodedelayenabled: [
        `${GENERAL}.application.background_mode_delay`,
        `${GENERAL}.application.window_header`
    ],
    backgroundmodedelayminutes: [
        `${GENERAL}.application.background_mode_delay_button`,
        `${GENERAL}.application.background_mode_delay`
    ],
    autologindelayenabled: [
        `${GENERAL}.logging.auto_login_delay`,
        `${GENERAL}.application.network_header`
    ],
    autologindelayseconds: [
        `${GENERAL}.logging.auto_login_delay_button`,
        `${GENERAL}.logging.auto_login_delay`
    ],
    logresourceload: [
        `${GENERAL}.logging.resource_load`,
        `${GENERAL}.logging.header`
    ],
    maxtablesize_v2: [
        `${TABLE_LIMITS}.table_max_entries`,
        `${TABLE_LIMITS}.header`
    ],
    searchlimit: [
        `${TABLE_LIMITS}.search_limit_returns`,
        `${TABLE_LIMITS}.header`
    ],
    issameinstanceabovefavorites: [
        'side_panel.settings.same_instance_above_favorites'
    ],

    thememode: [`${APPEARANCE}.appearance.theme_mode`],
    themecolor: [`${APPEARANCE}.theme_color.header`],
    zoomlevel: [`${APPEARANCE}.appearance.zoom`],
    fontfamily: [`${APPEARANCE}.appearance.font_family`],
    customfontfamily: [
        `${APPEARANCE}.appearance.font_family_custom`,
        `${APPEARANCE}.appearance.font_family`
    ],
    customfontprimary: [
        `${APPEARANCE}.appearance.font_family_custom_primary`,
        `${APPEARANCE}.appearance.font_family_custom`
    ],
    customfontsecondary: [
        `${APPEARANCE}.appearance.font_family_custom_secondary`,
        `${APPEARANCE}.appearance.font_family_custom`
    ],
    cjkfontpack: [`${APPEARANCE}.appearance.cjk_font_pack`],
    biolanguage: [`${APPEARANCE}.appearance.bio_language`],
    isagegatedinstancesvisible: [
        `${APPEARANCE}.appearance.age_gated_instances`
    ],
    datatablestriped: [`${APPEARANCE}.appearance.striped_data_table_mode`],
    tabledensity: [`${APPEARANCE}.appearance.table_density`],
    tablepagesize: [`${APPEARANCE}.appearance.table_page_sizes`],
    reducedmotionandblur: [`${APPEARANCE}.appearance.reduced_motion_and_blur`],
    notificationicondot: [
        `${APPEARANCE}.appearance.show_notification_icon_dot`
    ],
    taskbaricondot: [`${APPEARANCE}.appearance.show_taskbar_icon_dot`],
    weekstartson: [
        `${APPEARANCE}.timedate.week_starts_on`,
        `${APPEARANCE}.timedate.header`
    ],
    dthour12: [
        `${APPEARANCE}.timedate.time_format`,
        `${APPEARANCE}.timedate.header`
    ],
    dtdateformat: [
        `${APPEARANCE}.timedate.date_format`,
        `${APPEARANCE}.timedate.header`
    ],
    dtisoformat: [
        `${APPEARANCE}.timedate.force_iso_date_format`,
        `${APPEARANCE}.timedate.header`
    ],
    feedtimedisplaymode: [
        `${APPEARANCE}.timedate.feed_time_display`,
        `${APPEARANCE}.timedate.header`
    ],
    randomusercolours: [
        `${APPEARANCE}.user_colors.random_colors_from_user_id`,
        `${APPEARANCE}.user_colors.header`
    ],
    randomusercolourstyle: [
        `${APPEARANCE}.user_colors.random_color_style`,
        `${APPEARANCE}.user_colors.header`
    ],
    friendlognotificationdot: [
        `${APPEARANCE}.friend_log.show_notification_dot`,
        `${APPEARANCE}.friend_log.header`
    ],
    recentactioncooldownenabled: [
        `${APPEARANCE}.user_dialog.recent_action_cooldown`,
        `${APPEARANCE}.user_dialog.header`
    ],
    shownewdashboardbutton: [
        'view.settings.interface.navigation.show_new_dashboard_button',
        'view.settings.interface.navigation.header'
    ],

    relaunchvrchataftercrash: [
        `${ADVANCED}.advanced.relaunch_vrchat.header`,
        `${BEHAVIOR}.header`
    ],
    vrcquitfix: [`${BEHAVIOR}.quit_header`, `${BEHAVIOR}.header`],
    focusvrchatonjoin: [
        `${BEHAVIOR}.focus_on_join_header`,
        `${BEHAVIOR}.header`
    ],
    autosweepvrchatcache: [`${STORAGE}.cache_header`, `${STORAGE}.header`],
    avatarautocleanup: [`${STORAGE}.keep_avatar_data`, `${STORAGE}.header`],
    gamelogdisabled: [
        `${TROUBLESHOOTING}.gamelog`,
        `${TROUBLESHOOTING}.header`
    ],
    feedpersistencedisabled: [
        `${TROUBLESHOOTING}.feed_history`,
        `${TROUBLESHOOTING}.header`
    ],
    saveinstanceprints: [`${PRINTS}.header`],
    cropinstanceprints: [`${PRINTS}.crop`, `${PRINTS}.header`],
    saveinstancestickers: [
        `${ADVANCED}.advanced.save_instance_stickers_to_file.header`
    ],
    saveinstanceemoji: [
        `${ADVANCED}.advanced.save_instance_emoji_to_file.header`
    ],
    autodeleteoldprints: [`${AUTO_DELETE_PRINTS}.enable`],
    autodeleteprintslimit: [
        `${AUTO_DELETE_PRINTS}.limit`,
        `${AUTO_DELETE_PRINTS}.enable`
    ],
    avatarremotedatabase: [`${ADVANCED}.advanced.remote_database.header`],
    screenshothelper: [`${SCREENSHOT}.enable`, `${SCREENSHOT}.header`],
    screenshothelpercopytoclipboard: [
        `${SCREENSHOT}.copy_to_clipboard`,
        `${SCREENSHOT}.header`
    ],
    udonexceptionlogging: [
        `${ADVANCED}.advanced.cache_debug.udon_exception_logging`
    ],
    vrcregistryautobackup: [`${ADVANCED}.advanced.vrc_registry_backup`],
    adoptioncensusenabled: [
        `${ADVANCED}.adoption_census.label`,
        `${ADVANCED}.adoption_census.header`
    ],
    socialaienabled: ['view.settings.ai.enable', 'view.settings.ai.header'],
    autodeclinefriendrequests: [
        'view.settings.social.interaction.auto_decline_friend_requests',
        'view.settings.social.interaction.header'
    ],

    notificationlayout: [`${NOTIFICATIONS}.layout`],
    showpostupdatechangelogtoast: [
        `${NOTIFICATIONS}.post_update_changelog_prompt`
    ],
    notificationsounds: ['view.settings.notifications.custom_sounds.header'],
    desktoptoast: [`${DESKTOP}.when_to_display`, `${DESKTOP}.header`],
    afkdesktoptoast: [
        `${DESKTOP}.desktop_notification_while_afk`,
        `${DESKTOP}.header`
    ],
    desktopnotificationsound: [
        `${DESKTOP}.notification_sound`,
        `${DESKTOP}.header`
    ],
    desktopnotificationavatars: [
        `${DESKTOP}.friend_icons`,
        `${DESKTOP}.header`
    ],
    notificationdonotdisturbendongamestart: [
        `${DO_NOT_DISTURB}.end_on_game_start`,
        `${DO_NOT_DISTURB}.header`
    ],
    busystatusdonotdisturb: [
        `${DO_NOT_DISTURB}.busy_status`,
        `${DO_NOT_DISTURB}.header`
    ],
    notificationtts: [`${TTS}.when_to_play`, `${TTS}.header`],
    notificationttsvoicenative: [`${TTS}.tts_voice`, `${TTS}.header`],
    notificationttsvolume: [`${TTS}.tts_volume`, `${TTS}.header`],
    notificationttsnamemode: [`${TTS}.name_mode`, `${TTS}.header`],
    notificationttsnickname: [`${TTS}.use_memo_nicknames`, `${TTS}.header`],

    overlaytoast: [
        `${VR_NOTIFICATIONS}.when_to_display`,
        `${VR_NOTIFICATIONS}.header`
    ],
    xsnotifications: [
        `${VR_NOTIFICATIONS}.xsoverlay_notifications`,
        `${VR_NOTIFICATIONS}.header`
    ],
    ovrthudnotifications: [
        `${VR_NOTIFICATIONS}.ovrtoolkit_hud_notifications`,
        `${VR_NOTIFICATIONS}.header`
    ],
    ovrtwristnotifications: [
        `${VR_NOTIFICATIONS}.ovrtoolkit_wrist_notifications`,
        `${VR_NOTIFICATIONS}.header`
    ],
    imagenotifications: [
        `${VR_NOTIFICATIONS}.user_images`,
        `${VR_NOTIFICATIONS}.header`
    ],
    notificationtimeout: [
        `${VR_NOTIFICATIONS}.notification_timeout`,
        `${VR_NOTIFICATIONS}.header`
    ],
    notificationopacity: [
        `${VR_NOTIFICATIONS}.notification_opacity`,
        `${VR_NOTIFICATIONS}.header`
    ],
    hmdnotificationsenabled: [`${HMD}.hmd_notifications`],
    hmdnotificationstartmode: [`${HMD}.start_when`, `${HMD}.header`],
    hmdnotificationtimeout: [`${HMD}.timeout`, `${HMD}.header`],
    hmdnotificationopacity: [`${HMD}.opacity`, `${HMD}.header`],
    hmdnotificationposition: [`${HMD}.position`, `${HMD}.header`],
    hmdnotificationstyle: [`${HMD}.style`, `${HMD}.header`],
    hmdnotificationavatars: [`${HMD}.friend_icons`, `${HMD}.header`],
    wristoverlayenabled: [`${WRIST}.wrist_feed_overlay`],
    wristoverlaystartmode: [`${WRIST}.start_when`, `${WRIST}.header`],
    wristoverlaybutton: [`${WRIST}.overlay_button`, `${WRIST}.header`],
    wristoverlayhand: [`${WRIST}.display_on`, `${WRIST}.header`],
    wristoverlaydarkbackground: [`${WRIST}.dark_background`, `${WRIST}.header`],
    wristoverlayshowdevices: [`${WRIST}.vr_device_status`, `${WRIST}.header`],
    wristoverlayshowbatterypercent: [
        `${WRIST}.battery_percentage`,
        `${WRIST}.header`
    ],
    wristoverlaypages: [`${WRIST}.pages.label`, `${WRIST}.header`],
    wristoverlayplayerssort: [`${WRIST}.pages.players_sort`, `${WRIST}.header`],
    wristoverlaytimeoutseconds: [`${WRIST}.pages.timeout`, `${WRIST}.header`]
};
