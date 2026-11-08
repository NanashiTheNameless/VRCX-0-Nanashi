# Using VRCX-0-Nanashi

VRCX-0-Nanashi is a desktop companion for VRChat. It shows where your friends are, keeps a
history of the people you meet and the worlds you visit, manages your favorites, and sends
notifications on the desktop and in VR. It is a fork of VRCX-0, which is itself a rewrite
of VRCX in Rust. Everything VRCX-0 does, this fork does too; [FEATURES.md](FEATURES.md)
lists what the fork changes or adds.

For more detail, see [PAGES.md](PAGES.md), [DIALOGS.md](DIALOGS.md),
[LAYOUT_AND_APPEARANCE.md](LAYOUT_AND_APPEARANCE.md),
[NOTIFICATIONS_AND_VR.md](NOTIFICATIONS_AND_VR.md), [TOOLS.md](TOOLS.md),
[AI_ASSISTANT.md](AI_ASSISTANT.md), [INTEGRATIONS.md](INTEGRATIONS.md),
[BADGES.md](BADGES.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Getting started

- **Install** the build for your system from this fork's releases; see [INSTALL.md](INSTALL.md).
- **Sign in** with your VRChat account. The app talks to VRChat directly, and your login stays on
  your PC unless you set up the Self-hosted Recorder, which needs it to record for you.
- **Coming from VRCX or VRCX-0?** When this app has no profile yet, its first launch imports
  upstream VRCX-0's data, or original VRCX's if there is no VRCX-0. The other app's files are
  only read, never changed, so both apps can stay installed. A later import from VRCX or
  VRCX-0 merges that app's database and adds settings you have not set here yet; see
  [INSTALL.md](INSTALL.md).
- **Game history only builds up while the app runs.** To fill in times it was closed, import
  VRChat's own logs under Settings > Advanced > Import & recovery.

## Finding your way around

The left navigation holds every page. Its default order is shown below. You can reorder
items, put them in folders, rename folders, change icons and hide items you do not use.

- **Feed** - a live and recorded stream of what your friends do: coming online, going
  offline, moving between worlds, status and profile changes.
- **Friend Locations** - where your online friends are right now, grouped by instance, with a
  worlds view.
- **Game Log** - what happened in the instances you were in: who joined and left, videos,
  and other events VRChat logs.
- **Instance History** - the instances you have been in, with when and how long.
- **Current Players** - everyone in your current instance.
- **Search** - find users, worlds, avatars and groups.
- **View history** - the users, worlds, avatars and groups you opened recently.
- **Favorites** folder - **Favorite Friends**, **Saved Groups**, **Favorite Worlds** and
  **Favorite Avatars**, including VRChat favorites and local favorite groups.
- **Social** folder - **Friend History** (friends added, removed and renamed), **Friends**
  (your full friends list), **Moderation** (your history of blocks, mutes and interaction changes) and **Reminders**.
- **AI Assistant** - chat with an AI about your social history and get help with the app.
  It is off until you turn it on under Settings > AI.
- **Notifications** - VRChat invites, requests and other notifications.
- **My Avatars** - your own uploaded avatars.
- **Activity** - look back on each visit on a timeline, with the world, who was there and
  your screenshots, and see the non-friends you keep running into.
- **Mutual Friend Graph** - how your friends know each other.
- **Tools** - the tools listed below.
- **Docs** - this documentation and the rest of the project's docs, built into the app, with
  search and a contents list. Reading them makes no requests; links to other docs open here.

The **app menu** has **Sidebar Mode**, which shrinks the window into a narrow friends sidebar,
and **Keyboard Shortcuts**, which lists every shortcut. Holding the shortcut-hint key shows
hints on screen, and the first nine navigation items can be opened from the keyboard.

The **side panel** on the right holds your friends and groups lists, favorite collections and
world rooms you pinned. Pin a world from its world dialog to see its public instances and
which friends are there, and join from the panel.

Clicking a user, world, avatar or group anywhere opens its dialog, with details, history,
actions and links you can share.

Small labels next to user names are badges; [BADGES.md](BADGES.md) describes every one of
them and how to make your own.

## Tools

The Tools page groups helpers by kind:

- **Images**: Screenshot (browse your VRChat photos and their details), Gallery (photos,
  profile icons and prints), Inventory (emojis, stickers, items and cosmetics).
- **VRChat**: VRChat Config, Launch Options, Chatbox (show the time, what you are playing or
  your own text in the in-game chatbox, or type and translate messages).
- **Automation**: App Launcher (start apps when VRChat starts) and Calendar (upcoming events
  from your groups).
- **Groups**: My Groups (reorder, hide and leave groups) and Group Moderation (members, bans,
  invites and join requests).
- **Data**: Backup & restore, VRChat Registry Backup, Discord Names, Export Local Notes to
  VRChat, Export Friends List, Export My Avatars.
- **Folders**: open the VRChat photos, VRChat data, VRCX-0-Nanashi data and crash dumps folders.
- **Debug**: VRChat Log Viewer.
- **Other**: AI Connections, AI Assistant, Message Templates, My Reports, Purchase History.

## Settings

Settings has these tabs. Each holds cards of related settings, and the search box at the top
finds any setting by name.

- **System** - Startup; Window & Tray (minimize to tray, a global show and hide shortcut,
  Privacy Lock, hardware acceleration on Linux, Background Mode); VRChat behavior (relaunch
  after a crash, close lingering processes); Updates; Login & Network (auto sign-in delay,
  proxy).
- **Interface** - Appearance (language, font, zoom, table density, reduce effects); Profile
  Appearance; Display; Navigation; Lists & Tables; Time/Date (time and date format, week
  start, Feed time format, timezone); User Colors; User Dialog.
- **Social** - Interaction (recent action icon, auto-decline requests from people you never
  met); Friend History; Friend bios; Friends hidden from the feed; Favorites; User Badges
  (your own badges next to user names).
- **Notifications** - In-App Indicators; Do Not Disturb; Desktop Notifications; Desktop
  Overlay (a small window of recent notifications for desktop players, Windows only);
  Text-to-Speech; Webhook Notifications; Test Notification.
- **VR** - VR Overlay Notifications (including XSOverlay and OVR Toolkit); HMD Notifications;
  Wrist Overlay; Overlay Test.
- **Media** - Screenshot Helper (metadata in your screenshots); saving instance prints,
  stickers and emoji to files.
- **AI** - AI Assistant; LLM Endpoints (the AI services you connect); MCP Server (lets
  external AI tools use your local data).
- **Integrations** - Discord Presence; Content Translation; YouTube API; Remote Avatar
  Database; Integration API (real-time game data for other apps).
- **Sync Options** - History Sync with RemoteSync, or the Self-hosted Recorder.
- **Advanced** - Storage & cleanup; Troubleshooting (error log, link handling, database usage);
  Import & recovery; Safety watchlists and warnings; Export & import data; Anonymous adoption
  count; Danger zone.

## Notifications

Every notification channel (desktop, desktop overlay, text-to-speech, webhooks, VR overlays,
HMD and wrist) has its own filters, so you choose per channel which events reach it. Do Not
Disturb can switch on with your VRChat status. Notification sounds are off until you pick
one.

## VR

VR notifications can go to XSOverlay, OVR Toolkit, the app's own HMD notifications, and the
wrist overlay. The overlays render natively and work with SteamVR and OpenXR. Overlay Test
under Settings > VR shows them without starting VRChat, as long as SteamVR is running.

## Privacy and your data

- Your history is stored locally in the app's data folder, which Tools > Folders opens.
- Privacy Lock (Settings > System > Window & Tray) locks the interface with a code.
- The fork sends no usage telemetry. The only report is an anonymous adoption count you can
  turn off; see [TELEMETRY.md](TELEMETRY.md).
- Backups: Tools > Backup & restore, and Settings > Advanced > Export & import data.

## For advanced users

- **MCP server** (Settings > AI) lets external AI tools read your local social data.
- **Integration API** (Settings > Integrations) shares real-time in-game data with other apps.
- **Self-hosted Recorder** (Settings > Sync Options) keeps your Feed recording on your own
  server while the app is closed; see the [recorder guide](RECORDER.md).
- **Headless mode** runs the app without a window; it is for running on servers.

## Getting help

For bugs in this fork, open an issue on this fork's GitHub repository, in English. Problems
in this fork do not belong in upstream VRCX-0's tracker. Security problems are reported
privately; see [SECURITY.md](../SECURITY.md).
