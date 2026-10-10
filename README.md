# VRCX-0-Nanashi

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/NanashiTheNameless/VRCX-0-Nanashi)

**A personal fork of [VRCX-0](https://github.com/Map1en/VRCX-0) by Map1en.**

**This is not the official VRCX-0.** It is maintained by NamelessNanashi for personal use,
tracks upstream loosely, and makes opinionated changes upstream may not want. For the
official app, support, and community, use [Map1en/VRCX-0](https://github.com/Map1en/VRCX-0).
Please do not report bugs from this fork to upstream.

VRCX-0-Nanashi is a desktop companion for VRChat: see where your friends are, keep a history of
the people you've met and the worlds you've visited, manage your favorites, and more.
It is a Rust + Tauri rewrite of VRCX.

## What this fork changes

- **No telemetry.** Usage stats, heartbeats, crash reporting, the in-app feedback form,
  and community theme install-count pings and download counts are removed entirely.
- **RemoteSync relay links.** World, avatar, and instance dialogs can copy links through
  `vrcx.namelessnanashi.dev/open/...`. World and avatar previews stay in the URL fragment,
  so preview details are not sent to the website. Plain VRChat links remain available.
  The legacy `open.vrcx-0.dev` relay host is not accepted.
- **History sync (RemoteSync), off by default.** Under Settings > History Sync, pair this PC
  with a RemoteSync server (the official one or your own) to keep an end-to-end encrypted copy
  of your history there and share it between your PCs. The key is created on your PC, never
  sent to the server, and shown to you as a recovery string. Friend feed, friend log, your own
  profile changes, avatar wear log and game log are synced, and the same event recorded by two
  PCs is kept once. Memos, notes, favorites, moderation entries, notifications, avatar history
  and tags, profile bios and the mutual friends graph are synced too: the later edit wins and
  a deletion on one PC reaches the others. Nothing on the server can delete local history, and
  you can move the key to another device, see and sign out connected clients, and delete the
  server copy from the same settings page.
- **Shared world collections on the fork's own service.** A world favorite group can be shared
  as a public page on the RemoteSync website and updated by sharing it again; manage shares on
  the website. This needs a paired RemoteSync account and sends only what the page shows.
  Nothing goes to upstream's `vrcx-0.dev` services.
- **Server and website checks.** Settings > History Sync shows whether the server is the
  official instance and whether its website runs the official unmodified code. Either check
  failing shows a warning that explains the risk; neither blocks use, so self-hosted servers
  keep working.
- **Social AI is off by default.** Turn it on under Settings > AI. Nothing is sent to an
  AI service while it is disabled. The chat is also on the left navigation as **Social AI**.
  Supports OpenAI-compatible (Chat Completions and Responses), Azure OpenAI, Anthropic,
  Google Gemini, Vertex AI, Ollama, Cohere and Amazon Bedrock APIs, local or LAN models
  with no key, and custom headers.
- **HTTP protocol preference.** App-managed HTTP clients try HTTP/3 when a direct
  HTTPS connection supports it, then HTTP/2. Requests that carry credentials or
  personal data (VRChat API and images, AI, translation, YouTube metadata, avatar
  search, webhooks, uploads) cannot use HTTP/1.1 with a remote host. Credential-free
  downloads and reads can fall back to HTTP/1.1: GitHub downloads (yt-dlp, safety-list
  mirrors), safety lists, update checks and the updater (still signature-verified),
  VRChat status, community theme catalog and stats, background image metadata and
  shared world collection reads.
  Localhost and private IP addresses can always use HTTP/1.1, including local AI
  services; a local proxy does not exempt a remote destination. Proxy connections use
  TCP negotiation; HTTP/3 never bypasses a proxy. AI prompts and uploads are not
  replayed after transport failures. WebSocket handshakes, WebView resources and
  external yt-dlp processes retain their own protocol handling.
- **Keeps the PC awake** (optional, on by default) so live updates keep arriving while the app
  sits in the tray; the screen can still turn off.
- **Profile decorations are hidden by default.** VRChat profile backgrounds, avatar frames,
  profile and nameplate effects stay off in the user dialog, friends sidebar, user hover cards,
  Friends Locations and the Activity journey until turned on under Settings > Interface >
  Profile Appearance.
- **Custom notification sounds.** Under Settings > Notifications, choose a built-in sound or
  an audio file and volume per event for anyone, friends, or favorite friends. Sounds work in
  background mode and respect Do Not Disturb and privacy lock. Built-in sounds are CC0 clips
  listed in [crates/host-desktop/sounds](crates/host-desktop/sounds/README.md).
- **Opt-in VRChat video playback helper.** Settings > Media installs managed yt-dlp master
  updates and a local PO-token provider. Cookie use is a separate opt-in: explicitly select a
  browser to refresh or import your own cookies.txt. Originals are backed up for restore.
  No video caching or browser extension. See [setup and playback limits](YTDLP_SETUP.md).
- **Safety watchlists and warnings.** Settings > Notifications includes group/avatar watchlists,
  opt-in community lists, and URL-host warnings. Group/avatar profiles have a Watch button;
  user/avatar profiles show community-list matches. Warning delivery uses the System & Safety
  filters and custom sounds. Logged URLs are inspected locally without fetching or resolving them.
  Community sources default to warnings; automatic user blocks and bans from selected owned
  groups require explicit configuration and are recorded in Safety history. Players already in
  the instance when the app starts or a list updates are warned about too, never acted on.
  Game-log tables and sessions show inline warnings without opening logged URLs.
  Group checks cover public memberships. Your own avatar ID can be confirmed through the API;
  other players' avatar alerts use names and explicitly mark the ID as unverified.
  Avatar lists offer reviewed batches of up to 25 exact IDs to block, with cancellation and
  per-ID results. A name match alone never blocks: an on-demand instance check looks names up
  with your avatar search provider and offers a confirmed block only when exactly one listed ID
  matches. Avatar lists can also be hidden account-wide at a throttled pace (daily cap, backoff);
  turning that off never unblocks, and unblocking is a separate reviewed action. Its progress has
  its own history so it never pushes alerts out of Safety history. Community lists
  hosted on GitHub are mirrored locally and refreshed when the repository changes.
  Instance kicks remain unavailable.
- **Assistant reminders.** Ask the assistant (with writes turned on) to tell you when a friend comes
  online, goes offline, moves or joins you, or at a time. Reminders are saved, fire as normal
  notifications with the chat closed, and have their own **Reminders** entry in the left
  navigation (and a card under Settings > AI).
- **Wrist overlay pages.** The wrist menu shows the feed, the players in your instance, and the
  players you have notes on. Under Settings > VR you choose which pages appear, their order,
  whether the newest feed entry is on top or on the bottom, and the player order. The menu closes after 15 seconds without interaction by default; set the menu
  timeout anywhere from 5 to 255 seconds. Pressing the menu button while the menu is already open
  switches to the next page and restarts that timer - you never have to close and reopen it.
  The Players and Notes pages list everyone in the instance with all of their details; when a
  full instance does not fit, they add columns and then use smaller text instead of leaving anyone
  out.
- **Wrist menu size and placement.** Under Settings > VR, set the menu's width and maximum height
  in centimeters (it is shorter when there is less to show), the text size of the header, footer
  and content separately, move it sideways, up or down and out from the wrist, tilt it, and choose
  which edge stays fixed as it grows (bottom by default, so it grows upward).
- **HMD notifications fit their text.** Short notifications get small cards, long ones wrap onto
  more lines instead of being cut off, and the text size is adjustable under Settings > VR.
- **Launch without Steam.** Set the VRChat install folder in Launch Options to start VRChat directly.
- **Import from VRCX or VRCX-0.** Merges the other app's database and adds settings you have not set
  here yet.
- **One date format everywhere.** Dates show as `hh:mm:ss AM MM/DD/YY` by default. Under
  Settings > Interface > Time/Date, pick time-first or date-first with MM/DD/YY, DD/MM/YY or
  YYYY-MM-DD, or the language default. Today's feed entries show only the time.
- **Resizable feed columns.** In the feed's column view, drag a column's right edge (or focus it
  and use the arrow keys) to set its width.
- **Local fonts by default.** Bundled 0xProto and system CJK fonts work offline. Additional
  online font choices are labelled in Settings > Interface.
- **Legacy VRCX links work.** `vrcx://world/...`, `vrcx://avatar/...`, `vrcx://user/...`,
  `vrcx://group/...` and `vrcx://addavatardb/...` open in this app. If the original VRCX or
  upstream VRCX-0 is also installed, whichever app registered a scheme last handles it.
- **English only.** Other UI translations were removed. Support (issues, questions) is offered
  in English only; other languages, including any custom translations you load, are not
  officially supported on this fork.
- **Separate app identity.** Installs and runs side by side with upstream VRCX-0, with its own data
  folder (`VRCX-0-Nanashi`). On first launch it copies your existing VRCX-0 data folder (caches
  excluded); upstream data is never changed. Its own link scheme is `vrcx-0-nanashi://`, and
  `vrcx-0://` / `vrcx://` links are accepted too.
- **Updates come from this fork's releases**, not upstream.

## Install

Grab the file for your platform from the
[Nightly-Rolling release](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/Nightly-Rolling):

| Platform          | File                                                |
| ----------------- | --------------------------------------------------- |
| Windows           | `VRCX-0-Nanashi_<version>_windows_x86_64_setup.exe` |
| macOS (Universal) | `VRCX-0-Nanashi_<version>_macos_universal.dmg`      |
| Linux (AppImage)  | `VRCX-0-Nanashi_<version>_linux_x86_64.AppImage`    |

Fork builds are not code-signed. On Windows, SmartScreen may warn on first run. On macOS,
if the first launch is blocked, open **System Settings > Privacy & Security** and click
**Open Anyway**.

### Linux

On first launch, the AppImage removes its build version from the standard download
filename, leaving `VRCX-0-Nanashi_linux_x86_64.AppImage`. Custom filenames are kept,
and an existing file with the destination name is never replaced.

Hardware acceleration for the app interface is off by default. Turn it on under
**Settings > System > Hardware acceleration (experimental)**; if the interface doesn't
display properly, the app turns it back off automatically. Setting
`WEBKIT_DISABLE_DMABUF_RENDERER` yourself hides this option.

## Building from source

Requirements: Node.js >= 24.10, npm >= 11.5, and a stable Rust toolchain via rustup
(rustc >= 1.95). On Windows, also install **Visual Studio Build Tools** with the
**Desktop development with C++** workload. On Linux, install the WebKitGTK 4.1
development packages, for example on Debian/Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev \
  librsvg2-dev libayatana-appindicator3-dev libasound2-dev
```

```bash
git clone https://github.com/NanashiTheNameless/VRCX-0-Nanashi
cd VRCX-0-Nanashi

npm install
```

Start the dev server:

```bash
npm run tauri:dev
```

Build for release (skip code signing and installer):

```bash
npm run tauri:build -- --no-sign --no-bundle
```

The RemoteSync collector is a separate server-side program for people who run a RemoteSync
server. It is not part of the desktop app and regular users never need it. Build it on Linux
x86_64 with:

```bash
cargo build --locked --release -p vrcx-0-nanashi-collector
```

It only runs when started by the RemoteSync collector supervisor: it takes a VRChat session
over an inherited descriptor, records to a tmpfs directory, and has no way to send invites,
messages, or any other action.

Release builds run `scripts/smoke-appimage.py` against the packaged AppImage before
uploading it. The check covers renaming, repeat launches, autostart arguments, and
the paths used for updates and relaunching without opening the app interface.

## Credits

VRCX-0-Nanashi is built on [VRCX-0](https://github.com/Map1en/VRCX-0) by Map1en and its
contributors, which in turn builds on [VRCX](https://github.com/vrcx-team/VRCX). Thanks to
everyone who worked on both.

## Support this fork

- [GitHub Sponsors](https://github.com/sponsors/NanashiTheNameless)
- [Buy Me a Coffee](https://buymeacoffee.com/NamelessNanashi)
- [Ko-fi](https://ko-fi.com/NanashiTheNameless)
- [Liberapay](https://liberapay.com/NamelessNanashi)
- [Throne](https://throne.com/NamelessNanashi)

## License

GNU General Public License v3.0 (GPLv3), same as upstream. See [LICENSE](LICENSE).

This project is not affiliated with or endorsed by [Map1en/VRCX-0](https://github.com/Map1en/VRCX-0).

This project is not affiliated with or endorsed by VRChat Inc. VRChat and all associated properties are
trademarks or registered trademarks of VRChat Inc.
