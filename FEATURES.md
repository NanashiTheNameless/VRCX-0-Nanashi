# What this fork changes

Everything VRCX-0-Nanashi does differently from upstream [VRCX-0](https://github.com/Map1en/VRCX-0).

- [Privacy and network](#privacy-and-network)
- [Sync and sharing](#sync-and-sharing)
- [Social AI and reminders](#social-ai-and-reminders)
- [Safety](#safety)
- [VR overlay](#vr-overlay)
- [Notifications and media](#notifications-and-media)
- [Interface](#interface)
- [App identity, links and updates](#app-identity-links-and-updates)

## Privacy and network

### No usage telemetry, one anonymous adoption count

Upstream's usage stats, heartbeats, crash reporting, the in-app feedback form, and community
theme install-count pings and download counts are removed entirely and stay removed.

The only thing this fork reports is an anonymous count of how many installs are in use, which
you can turn off. See [Telemetry](TELEMETRY.md) for exactly what is sent.

### HTTP protocol preference

App-managed HTTP clients try HTTP/3 when a direct HTTPS connection supports it, then HTTP/2.

- **No HTTP/1.1 for sensitive requests.** Requests that carry credentials or personal data
  cannot use HTTP/1.1 with a remote host: VRChat API and images, AI, translation, YouTube
  metadata, avatar search, webhooks and uploads.
- **HTTP/1.1 fallback for credential-free requests.** GitHub downloads (yt-dlp, safety-list
  mirrors), safety lists, update checks and the updater (still signature-verified), VRChat
  status, community theme catalog and stats, background image metadata and shared world
  collection reads.
- **Local addresses.** Localhost and private IP addresses can always use HTTP/1.1, including
  local AI services. A local proxy does not exempt a remote destination.
- **Proxies.** Proxy connections use TCP negotiation; HTTP/3 never bypasses a proxy.
- **Retries.** The HTTP layer never replays AI prompts or uploads after a transport failure.
  OpenAI-compatible and Azure OpenAI chat requests are resent up to 3 times when the connection
  cannot be opened or the provider answers 408, 409 or a 5xx error; rate limits (429), quota
  errors and other client errors are not retried.
- **Not covered.** WebSocket handshakes, WebView resources and external yt-dlp processes retain
  their own protocol handling.

## Sync and sharing

There are two ways to keep history beyond one PC, and they cannot be on at the same time:

| System                                                                            | Status                                                                                                                                                          |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [History sync (RemoteSync)](#history-sync-remotesync-off-by-default)              | **Preferred.** This fork's own system: end-to-end encrypted, shared between your PCs, and the one that gets new work. Use this unless you have a reason not to. |
| [Self-hosted Recorder](#self-hosted-recorder-experimental-from-this-forks-builds) | Upstream's system, kept for people who already depend on it. Experimental, and not where this fork's effort goes.                                               |

### History sync (RemoteSync), off by default

Under Settings > Sync Options, pair this PC with a RemoteSync server (the official one or your
own) to keep an end-to-end encrypted copy of your history there and share it between your PCs.

- **Your key stays yours.** The key is created on your PC, never sent to the server, and shown
  to you as a recovery string. You can move the key to another device.
- **History that is synced.** Friend feed, friend log, your own profile changes, avatar wear
  log and game log. The same event recorded by two PCs is kept once. A change that this PC
  and the collector noticed at different times is also kept once, with the time this PC
  recorded: up to 10 minutes apart for location, status, avatar and online/offline, and up to
  30 days apart for bio, your own profile, and friend log entries (new friend, unfriend,
  display name, trust level). A change that really happened again is kept.
- **Other data that is synced.** Memos, notes, favorites, moderation entries, notifications,
  avatar history and tags, profile bios and the mutual friends graph. The later edit wins and a
  deletion on one PC reaches the others.
- **Local history is safe.** Nothing on the server can delete local history.
- **Automatic sync.** Pushes and pulls changes on a configurable 1 to 60 minute interval, and
  can be set to wait while VRChat is open.
- **One PC merges.** You can choose one paired PC to merge and deduplicate the server copy;
  other PCs only upload and download changes. All PCs must use an app version that supports
  this selection. The selected PC uploads a complete merged snapshot before the server removes
  older chunks, and a failed upload leaves those chunks in place.
- **Settings sync.** You can sync non-secret app preferences too; this is on by default and can
  be changed under Settings > Sync Options. Credentials, device-specific paths, the adoption
  count switch, the Lock, VRChat launch options, the Integration API and other state tied to
  one PC stay local. "Settings to sync" opens a dialog that picks what each PC exchanges:
  choose a group on the left, then turn off the whole group or single settings, listed by the
  name they have in the app, or by a plain name for saved view state such as table filters.
  Categories keep application behavior, appearance, layout, history, favorites, instance
  defaults, avatar search, media, notifications, overlays, safety, automation, Discord and
  Social AI preferences together. Existing exclusions are preserved when categories change.
  Changes apply on Save. A setting that is off keeps its value on that PC and is left alone
  on the server, so other PCs can still share it. The choice is per PC and is not synced.
- **Manage it.** See and sign out connected clients, and delete the server copy, from the same
  settings page.

History sync and the Self-hosted Recorder cannot be on at the same time. History sync is the
preferred one.

### Server and website checks

Settings > Sync Options shows whether the server is the official instance and whether its
website runs the official unmodified code. Either check failing shows a warning that explains
the risk; neither blocks use, so self-hosted servers keep working.

### RemoteSync relay links

World, avatar, and instance dialogs can copy links through `vrcx.namelessnanashi.dev/open/...`.

- World and avatar previews stay in the URL fragment, so preview details are not sent to the
  website.
- Plain VRChat links remain available.
- The legacy `open.vrcx-0.dev` relay host is not accepted.

### Shared world collections on the fork's own service

A world favorite group can be shared as a public page on the RemoteSync website and updated by
sharing it again; manage shares on the website.

- Needs a paired RemoteSync account.
- Sends only what the page shows.
- Nothing goes to upstream's `vrcx-0.dev` services.

### Self-hosted Recorder (experimental), from this fork's builds

Upstream's recorder is kept: a small server program you run on an always-on Linux machine or Windows PC that
logs in to VRChat with your account while the app is closed, so friend activity from that time
is filled into the Feed when you come back. Set it up under Settings > Sync Options.

**History sync (RemoteSync) is preferred over the recorder.** The recorder is upstream's system
and is kept only so it keeps working for people who rely on it. If you are choosing between
the two, choose History sync.

- **Nothing is sent until you set it up.** Nothing is sent until you enter a recorder address
  and password, and login details only go to your own recorder.
- **Built by this fork.** The install script, Docker image
  (`ghcr.io/nanashithenameless/vrcx-0-logger`) and binaries come from this repository's nightly
  builds. There is no beta channel, and the app accepts any recorder that speaks a compatible
  protocol instead of matching stable and beta releases.
- **One or the other with history sync.** Connecting a recorder is refused while history sync
  is on, and turning history sync on is refused while a recorder is connected. The recorder's
  address and password are never included in settings sync.
- **Keep it on your own network.** Traffic to the recorder is encrypted with the recorder
  password but uses plain HTTP unless you give an `https://` address, so keep it on your own
  network or a VPN.

See the [recorder guide](crates/logger/README.md).

### Import from VRCX or VRCX-0

Merges the other app's database and adds settings you have not set here yet.

## Social AI and reminders

### Social AI is off by default

Turn it on under Settings > AI. Nothing is sent to an AI service while it is disabled. The chat
is also on the left navigation as **Social AI**.

Supported APIs:

- OpenAI-compatible (Chat Completions and Responses)
- Azure OpenAI
- Anthropic
- Google Gemini
- Vertex AI
- Ollama
- Cohere
- Amazon Bedrock
- Local or LAN models with no key, and custom headers

### Assistant reminders

Ask the assistant (with writes turned on) to tell you when a friend comes online, goes offline,
moves or joins you, or at a time.

Reminders are saved, fire as normal notifications with the chat closed, and have their own
**Reminders** entry in the left navigation (and a card under Settings > AI).

## Safety

### Safety watchlists and warnings

Settings > Notifications includes group/avatar watchlists, opt-in community lists, and URL-host
warnings.

**Watching and warnings**

- Group/avatar profiles have a Watch button; user/avatar profiles show community-list matches.
- Warning delivery uses the System & Safety filters and custom sounds.
- Logged URLs are inspected locally without fetching or resolving them.
- Game-log tables and sessions show inline warnings without opening logged URLs.
- Players already in the instance when the app starts or a list updates are warned about too,
  never acted on.

**Community lists**

- Community sources default to warnings.
- Automatic user blocks and bans from selected owned groups require explicit configuration and
  are recorded in Safety history.
- Community lists hosted on GitHub are mirrored locally and refreshed when the repository
  changes.

**What is checked**

- Group checks cover public memberships.
- Your own avatar ID can be confirmed through the API; other players' avatar alerts use names
  and explicitly mark the ID as unverified.

**Blocking avatars**

- Avatar lists offer reviewed batches of up to 25 exact IDs to block, with cancellation and
  per-ID results.
- A name match alone never blocks: an on-demand instance check looks names up with your avatar
  search provider and offers a confirmed block only when exactly one listed ID matches.
- Avatar lists can also be hidden account-wide at a throttled pace (daily cap, backoff).
  Turning that off never unblocks, and unblocking is a separate reviewed action. Its progress
  has its own history so it never pushes alerts out of Safety history.

Instance kicks remain unavailable.

## VR overlay

### Wrist overlay pages

The wrist menu shows the feed, the players in your instance, and the players you have notes on.

- **Pages.** Under Settings > VR you choose which pages appear, their order, whether the newest
  feed entry is on top or on the bottom, and the player order.
- **Friends in yellow.** Friends' names are yellow in the feed too; favorites also get a star.
- **Timeout.** The menu closes after 15 seconds without interaction by default; set the menu
  timeout anywhere from 5 to 255 seconds.
- **Switching pages.** Pressing the menu button while the menu is already open switches to the
  next page and restarts that timer - you never have to close and reopen it. A second press
  within 1 second of opening the menu (a double press) only keeps it open; press again to
  switch. Set this double press cooldown from 0 (off) to 5000 ms.
- **One menu at a time.** With the menu on both hands, opening it on one wrist closes it on the
  other. Each time the menu opens, on either wrist, it starts on your first page.
- **Full instances.** The Players and Notes pages list everyone in the instance with all of
  their details; when a full instance does not fit, they add columns and then use smaller text
  instead of leaving anyone out.
- **Player details.** Every player shows their state, platform, an 18+ badge when VRChat
  reports one, the profile languages you both list (such as `ENG, JPN`), and status text.
  While these pages are open the app loads each player's VRChat profile once every 10 minutes,
  one request at a time, reusing profiles the Player List page already loaded. You are listed
  last, with your own details and all of your languages. Friends' names are yellow.

### Wrist menu size and placement

Under Settings > VR you can:

- Set the menu's width and maximum height in centimeters (it is shorter when there is less to
  show).
- Set the text size of the header, footer and content separately.
- Move it sideways, up or down and out from the wrist, and tilt it.
- Choose which edge stays fixed as it grows (bottom by default, so it grows upward).

### HMD notifications fit their text

Short notifications get small cards, long ones wrap onto more lines instead of being cut off,
and the text size is adjustable under Settings > VR. Friends' names are yellow, and favorites
also get a star.

### Movable HMD notifications

On top of the Top, Center and Bottom positions, two sliders under Settings > VR move HMD
notifications left or right and up or down by up to 50 cm. Turn on Overlay Test there to see
the result while wearing the headset.

## Notifications and media

### Custom notification sounds

Under Settings > Notifications, choose a built-in sound or an audio file and volume per event
for anyone, friends, or favorite friends.

- Sounds work in background mode and respect Do Not Disturb and privacy lock.
- Built-in sounds are CC0 clips listed in
  [crates/host-desktop/sounds](crates/host-desktop/sounds/README.md).

### Experimental, opt-in VRChat video playback helper

Settings > Media installs managed yt-dlp master updates and a local PO-token provider.

- Cookie use is a separate opt-in: explicitly select a browser to refresh or import your own
  cookies.txt. Originals are backed up for restore.
- No video caching or browser extension.

See [setup and playback limits](YTDLP_SETUP.md).

### Keeps the PC awake

Optional, on by default, so live updates keep arriving while the app sits in the tray; the
screen can still turn off.

## Interface

| Change                                    | Details                                                                                                                                                                                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile decorations are hidden by default | VRChat profile backgrounds, avatar frames, profile and nameplate effects stay off in the user dialog, friends sidebar, user hover cards, Friends Locations and the Activity journey until turned on under Settings > Interface > Profile Appearance.                                    |
| One date format everywhere                | Dates show as `hh:mm:ss AM MM/DD/YY` by default. Under Settings > Interface > Time/Date, pick time-first or date-first with MM/DD/YY, DD/MM/YY or YYYY-MM-DD, or the language default. Today's feed entries show only the time.                                                         |
| Per-PC timezone                           | Settings > Interface > Time/Date accepts an IANA timezone such as `America/Chicago` or a fixed offset such as `UTC+05:30`. Blank follows the system timezone. The setting applies to displayed dates, reminders, calendar filters and Rust overlays, and is never synced to another PC. |
| Resizable feed columns                    | In the feed's column view, drag a column's right edge (or focus it and use the arrow keys) to set its width.                                                                                                                                                                            |
| Local fonts by default                    | Bundled 0xProto and system CJK fonts work offline. Additional online font choices are labelled in Settings > Interface.                                                                                                                                                                 |
| English only                              | Other UI translations were removed. Support (issues, questions) is offered in English only; other languages, including any custom translations you load, are not officially supported on this fork.                                                                                     |

Absolute dates are stored as signed Unix epoch seconds in UTC. Updates convert existing
ISO dates and millisecond timestamps automatically. Distinct old game-log events within
one second keep separate identities, and repeated imports still deduplicate them. Old
history and backup formats are accepted at import boundaries. Durations keep their existing
units; signed protocol envelopes retain the units required by their protocol version.
See [Dates and timezones](TIMESTAMPS.md) for migration, timezone and sync compatibility details.

## App identity, links and updates

### Separate app identity

Installs and runs side by side with upstream VRCX-0, with its own data folder
(`VRCX-0-Nanashi`).

- With no fork profile, first launch automatically imports upstream VRCX-0 or original
  VRCX, including custom data locations. Imports use verified snapshots and resume after
  interruption; source files are never changed. Existing fork profiles take priority.
- Older fork databases and settings migrate to `VRCX-0-Nanashi.sqlite3` and
  `VRCX-0-Nanashi.json`, keeping the originals for recovery. Releases before 3.0.1
  are blocked by the updater.
- Its own link scheme is `vrcx-0-nanashi://`, and `vrcx-0://` / `vrcx://` links are accepted
  too.

### Legacy VRCX links work

`vrcx://world/...`, `vrcx://avatar/...`, `vrcx://user/...`, `vrcx://group/...` and
`vrcx://addavatardb/...` open in this app. If the original VRCX or upstream VRCX-0 is also
installed, whichever app registered a scheme last handles it.

### Launch without Steam

Set the VRChat install folder in Launch Options to start VRChat directly.

### VRCX startup folders

Besides its own list, App Launcher starts the shortcuts and programs (`.exe`, `.lnk`, `.url`,
`.bat`, `.cmd`) in two folders when VRChat starts, using the VRCX layout: files in the folder
start every time, files in its `desktop` subfolder only without SteamVR, files in its `vr`
subfolder only with it. A file is skipped while it is already running and closed when VRChat
closes.

- **This app's folder.** `StartupApps` in the data folder, on by default. "Open folder" creates
  it.
- **VRCX's folder.** `%AppData%\VRCX\startup`, off by default so apps do not start twice while
  VRCX is still running. It is only read, never created or changed.

### Updates come from this fork's releases

Not upstream.

[Back to the README](README.md)
