# Tools

The **Tools** page collects helpers by kind. Any tool can be pinned to **Quick access** at the
top of the page, or pinned to the left navigation as its own item.

## Media

- **Screenshot**: browse your VRChat photos with the details VRChat and the app saved in them
  (world, instance, who was there). Drag a screenshot in or run a metadata search. Keyboard
  shortcuts work in the details view (see
  [LAYOUT_AND_APPEARANCE.md](LAYOUT_AND_APPEARANCE.md#keyboard-shortcuts)). You can favorite,
  copy and delete screenshots, add a frame to one or several, and **send screenshots to Discord**
  through webhooks you set up (stored only on this PC), choosing what details to include and
  the image quality.
- **Gallery**: your VRChat photos, profile icons and prints. Upload (Ctrl+V pastes an image),
  crop, select and delete.
- **Inventory**: your emojis, stickers, items and cosmetics.

The **Screenshot Helper** (Settings > Media) writes the world, instance and players into each
new screenshot's metadata, can rename the file to include the world, and can copy the new
screenshot to the clipboard. Settings > Media can also save spawned prints, placed stickers and
spawned emoji to your VRChat Pictures folder, remove the white border from prints, and
auto-delete your oldest non-favorite prints on VRChat when you have more than a limit (30 to 60).

## Social Automation

- **Status Schedule**: rules that change your status, status message or both during a time
  window, on chosen days (or every day). Rules can run only while you are in game, and can
  restore your previous status when the window ends. Same start and end time keeps a rule
  active all day.
- **Instance Rules**: change your status or status message depending on the instance, world or
  friends you are with, with priorities (high, medium, low) when several rules match.
- **Invite Request Auto-Reply**: automatically invite allowlisted favorite friends who request an
  invite, optionally only in certain statuses, with a message slot of your choice. Your current
  instance still has to allow invites.
- **Follow Links**: rules for who your app invites when they send you a request invite: must be
  your friend, age verified (or age verified as 18+), a member of one of up to 8 of your groups,
  or any mix of these. Every check reads fresh data from VRChat; anything VRChat does not show
  (a hidden age status, a private member list) counts as a no. **Copy link** makes a page on your
  History Sync website with **Join**, **Request an invite**, **Open profile** and **Open in
  VRCX-0-Nanashi** buttons. It never shows your location, and everything in it stays in the
  link. In the viewer's app, Join asks first, then sends them an invite to your instance if
  they can see it and VRChat lets them in, or a request invite otherwise; Request an invite
  asks first too. **Opt in by boop** shows an emoji: people
  who pass a rule and boop you with it get an invite each time you move, until they boop you
  with **Stop** (which cancels at once), you pick a new emoji, you clear opt-ins, or the chosen
  number of hours (1 to 168, default 24) passes without an invite. An optional Thumbs Up boop
  confirms the opt-in.
  **Live location links** show your current world and instance to anyone with the link, with a
  Join in VRChat button, optionally behind a password. They need no account. The location is
  encrypted with a key that only exists in the link, so the History Sync server stores data it
  cannot read. Invite and invite+ instances are never shown, the page says when your PC has not
  updated it for 10 minutes, and a link stops a day after its last update. Up to 5 links; turn
  one off or delete it to stop sharing.
- **Party**: groups of people who stay together. Each party has its own emoji, and **Boop
  members to confirm** boops the members with it. You only follow members who booped you with
  that emoji, and a Stop boop undoes it. When a confirmed member moves (in **Only the leader**
  mode, only the leader), the app sends you an invite to their instance if VRChat lets you join
  it, or asks them for an invite if it is invite-only, and their app answers. In game you still
  click the invite; with **Launch VRChat to follow when it is closed** on, the app starts
  VRChat straight into their instance instead. **Guests** do not need the app: their request
  invites are answered, and they get an invite when you move only after booping you with the
  party emoji. **Copy link** shares the party; opening it in the app asks before joining.
- **Limits** for Follow Links and Party cannot be changed: at most 20 automatic invites and 30
  rule checks per hour, one unasked invite per person per move, a 2-minute pause between
  follows, and a 5-minute pause for all of it whenever VRChat answers that the app is sending
  too much. Request invites, boops and location updates may only work between friends; that is
  VRChat's rule.

## VRChat & System

- **VRChat Config**: edit VRChat's configuration file (cache size and location, and other
  options).
- **VRChat Log Viewer**: read VRChat's own output logs live, filtered by level, category and
  text.
- **Launch Options**: VRChat launch arguments the app uses when it starts VRChat.
- **App Launcher**: start other apps when VRChat starts, in VR, desktop or both, every time or
  only if not already running, after a delay, with arguments, optionally as administrator; and
  either keep them running or close them when VRChat closes. Shortcuts in the app's startup
  folder start with VRChat too, like VRCX's startup folders (VRCX's own folder can be read as
  well). Steam App IDs are supported.
- **VRChat Registry Backup**: back up and restore VRChat's settings stored in the Windows
  registry.
- **AI Connections**: the AI services the AI Assistant and translation use. See
  [AI_ASSISTANT.md](AI_ASSISTANT.md).
- **AI Assistant**: opens the assistant.
- **Chatbox**: see below.

## Chatbox

Shows information in VRChat's in-game chatbox over OSC, or sends messages you type.

- **Status pages**: build one or more pages of lines from text and values: the time, what you
  are playing (track, title, artist, with a maximum length), how long you have been playing,
  CPU, GPU, RAM and VRAM use and temperatures, and more, with styles and symbols. Pages rotate
  every few seconds; lines whose values are unavailable are hidden. An in-game preview shows
  what others will see and the character count.
- **Type and send**: type a message and send it, optionally translated first (check the
  translation, then send) or **shortened with AI** to fit the character limit. Save messages as
  quick phrases. A typing indicator can show while you type, and the notification sound can
  play when you send.
- **AFK**: switch to an AFK text, optionally showing how long you have been away, by hand or
  automatically when you take off your headset (needs the wrist overlay or HMD notifications
  on).
- The chatbox pauses while VRChat is not running or game isolation is on. **Address** and
  **Port** set where OSC messages go.

The AI Assistant can also send chatbox messages and change these settings, but only after you
approve each request.

## Groups

- **Calendar**: upcoming events from your groups.
- **My Groups**: your owned and joined groups, invitations and requests, and blocked groups.
  Drag groups to set the order VRChat shows them in (changes made while VRChat runs may be
  overwritten when the game exits), choose who sees each one on your profile, and leave them.
- **Group Moderation**: members, bans, invites and join requests for groups you manage.

## Data

- **Backup & restore**: back up and restore your VRCX-0-Nanashi data, on demand or on a
  schedule, and restore with one click.
- **VRChat Registry Backup** (above).
- **Discord Names**: find the Discord usernames your VRChat friends list in their profiles.
- **Export Local Notes to VRChat**: copy your local notes into VRChat's own notes.
- **Export Friends List** and **Export My Avatars**: save them as files.

Settings > Advanced > Export & import data exports all of your data and imports or restores it,
including data from VRCX or VRCX-0.

## Folders

Open the VRChat photos folder, the Steam screenshots folder, the VRChat data folder, the
VRCX-0-Nanashi data folder and the VRChat crash dumps folder.

## Other

- **Message Templates**: edit your invite and request message slots.
- **My Reports**: reports you submitted to VRChat.
- **Purchase History**: items you bought and your VRChat Credits activity.
