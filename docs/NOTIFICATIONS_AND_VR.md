# Notifications and VR

VRCX-0-Nanashi can tell you about friend activity, invites, things happening in your instance
and more, through several channels at once. Each channel has its own on/off switch, its own
**when to show** condition and its own **filters**, all under **Settings > Notifications** and
**Settings > VR**.

## Channels

| Channel               | Where it shows                                                                   | Settings                          |
| --------------------- | -------------------------------------------------------------------------------- | --------------------------------- |
| Desktop notifications | Your system's notifications                                                      | Notifications > Desktop           |
| Desktop Overlay       | A small window of recent activity on the desktop (Windows only)                  | Notifications > Desktop Overlay   |
| Text-to-Speech        | Read aloud                                                                       | Notifications > Text-to-Speech    |
| Webhooks              | Sent to a URL you choose, such as a Discord webhook                              | Notifications > Webhook           |
| VR overlay apps       | XSOverlay and OVR Toolkit (HUD and wrist), or WayVR on Linux                     | VR > VR Overlay Notifications     |
| HMD notifications     | The app's own cards floating in your headset view                                | VR > HMD Notifications            |
| Wrist overlay feed    | The app's own wrist menu in VR                                                   | VR > Wrist Overlay                |
| In-app                | The Notifications page, the sidebar's Notification Center, tray and taskbar dots | Notifications > In-App Indicators |

Where the user's name has its own place (the wrist feed, the Desktop Overlay, HMD and desktop
notifications), the event text is a short phrase such as **Online** or **In Test World**. Text
read aloud or shown as one line (text-to-speech, XSOverlay, OVR Toolkit and webhooks) uses a
full sentence with the name.

### When to show

Desktop notifications, text-to-speech and VR overlays each have a condition: **Never**,
**Desktop Only**, **In VR**, **Outside VR**, **In VRChat**, **Outside VRChat** or **Always**
(not every channel offers every choice).

### Filters

Each channel has a **Notification Filters** dialog listing every kind of event, grouped:

- **Action Required**: invites, invite requests and their responses, friend requests, boops,
  instance queue ready, instance closed.
- **Current Instance**: players joining, joined and left, and avatar changes in your instance.
- **Friend Activity**: online, offline, location and status changes.
- **Profile Changes**: avatar, display name, trust level and bio changes, new friends and
  unfriends.
- **Group & Social**: group announcements, events created and starting, join approvals,
  invites, join requests and transfer requests.
- **System & Safety**: misc events, external app items, blocked and muted players joining or
  leaving, [safety watchlist](FEATURES.md) matches (watched group, watched avatar, community
  list match, suspicious URL), and assistant reminders.
- **Media**: video playback.

For each event you choose **Off**, **On**, or who it applies to: **Friends**, **All favorites**,
**Selected favorites** (pick favorite groups), or **Everyone in instance**. **Reset** restores
the channel's recommended defaults.

Filters also let you get a notification when a [Saved Group](PAGES.md#favorites) opens a new
instance.

**Test Notification** sends a sample through every channel to check your setup. It skips
filters but respects each channel's switch, condition and Do Not Disturb.

## Do Not Disturb

Do Not Disturb pauses desktop notifications, text-to-speech, XSOverlay, OVR Toolkit and the
app's HMD notifications. Webhooks, the wrist overlay feed and notification history keep
working. Options:

- **Turn off when VRChat starts**.
- **Turn on while your status is Do Not Disturb** in VRChat.
- **Don't notify video playback errors** (for example when YouTube won't load) on any channel.

## Desktop notifications

Show friend icons in notifications, choose whether to notify while you are AFK, and pick a
**notification sound**. Nothing plays until you pick one: choose a built-in sound (all public
domain) or your own file. See [FEATURES.md](FEATURES.md) for the built-in sounds.

## Desktop Overlay

A small window on the desktop that keeps the last 50 activity entries, for people playing in
desktop mode, instead of system notifications. Turn it on or off from the status bar.
Right-click the window for **Always on Top** and **Click-Through**; while Click-Through is on,
turn it off from the tray. Set its background opacity, whether the newest entry is at the top
or bottom, and its own filters. User [badges](BADGES.md#badges-in-vr-and-the-desktop-overlay)
show after names.

## Text-to-Speech

Reads notifications aloud with a voice and volume you choose, under a when-to-play condition
and its own filters. **Spoken Name** picks whether it says the username, your local note
nickname, or both. **Play Test TTS** checks the voice.

## Webhooks

Sends notifications to a URL, as **Generic JSON** (pick which fields to include: version,
event, category, title, message, user, location, locationId, worldId, worldName, timestamp,
localTime) or as a **Discord** webhook message. It can also tell you when the app cannot
restore a dropped background sign-in. **Send Test Webhook** checks it, and **Delivery status**
shows the last success, the last failure and anything dropped.

How delivery works: only HTTP 2xx counts as success, each attempt times out after 10 seconds,
temporary failures are retried, pending deliveries are kept in memory only (and lost if the
app restarts), and too many queued deliveries may be dropped. Webhook URLs often contain
credentials, so treat yours as a secret.

## VR overlay apps

Send notifications to **XSOverlay** and **OVR Toolkit** (HUD and wrist) while SteamVR runs,
with friend icons, a notification duration and opacity, and their own filters. On Linux the
choices are the app's HMD notifications and WayVR.

## HMD notifications

The app's own notification cards in your headset view, drawn natively. Choose when they start
(when SteamVR starts, or when VRChat starts in VR), the position (top, center or bottom), the
style (standard or compact), friend icons, tracker disconnect alerts, how long they stay (1 to
30 seconds) and their opacity. **Left / right offset** and **up / down offset** move them from
the chosen position, and **text size** sets how big they are. Cards fit their text: short
notifications get small cards and long ones wrap onto more lines. User
[badges](BADGES.md#badges-in-vr-and-the-desktop-overlay) show after the name.

## Wrist overlay

A menu on your wrist in VR, opened with a controller button.

- **Start when** SteamVR starts, or when VRChat starts in VR. **Overlay Button**: grip or menu.
  **Display On**: left, right or both hands.
- **Pages**: the feed, the players in your instance, and the players you have notes on, plus
  what is playing now. Turn pages on or off and set their order; the first page shows each time
  the menu opens.
- **Pressing the menu button while it is open** switches to the next page and restarts the
  timer. The menu closes after a configurable time with no interaction (15 seconds by default,
  5 to 255). A short cooldown after opening keeps a double press from skipping a page.
- **Feed order**: newest at the top or bottom; when the feed does not fit, the oldest entries
  are left out.
- The top row shows your devices and battery levels (optionally as percentages), and the
  bottom row the player count, instance time and clock. A dark background and hiding private
  worlds are options.
- **Size and placement**: width, maximum height, header, content and footer text size, and
  moving the menu sideways, up or down, out from the wrist, and tilting it, with an anchored
  edge that stays put when the menu grows.
- The wrist feed has its own filters.
- User [badges](BADGES.md#badges-in-vr-and-the-desktop-overlay) show after names on the Feed,
  Players and Notes pages.

## Overlay Test

**Force Overlay Display** (Settings > VR > Overlay Test) shows a test card on the wrist overlay
and as an HMD notification, so you can check placement, size and opacity in the headset. It
needs SteamVR running and is never saved.

## Reminders

Reminders from the AI Assistant or the Reminders page arrive as **Assistant reminder**
notifications through the same channels and filters. See [PAGES.md](PAGES.md#reminders).
