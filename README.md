# VRCX-0-Nanashi

**A personal fork of [VRCX-0](https://github.com/Map1en/VRCX-0) by Map1en.**

This is not the official VRCX-0. It is maintained by NamelessNanashi for personal use,
tracks upstream loosely, and makes opinionated changes upstream may not want. For the
official app, support, and community, use [Map1en/VRCX-0](https://github.com/Map1en/VRCX-0).
Please do not report bugs from this fork to upstream.

VRCX-0-Nanashi is a desktop companion for VRChat: see where your friends are, keep a history of
the people you've met and the worlds you've visited, manage your favorites, and more.
It is a Rust + Tauri rewrite of VRCX.

## What this fork changes

- **No telemetry.** Usage stats, heartbeats, crash reporting, the in-app feedback form,
  and community theme install-count pings are removed entirely.
- **Social AI is off by default.** Turn it on under Settings > AI. Nothing is sent to an
  AI service while it is disabled. Supports OpenAI-compatible, Anthropic, Google Gemini and
  Ollama APIs, local or LAN models with no key, and custom headers.
- **Keeps the PC awake** (optional, on by default) so live updates keep arriving while the app
  sits in the tray; the screen can still turn off.
- **Custom notification sounds.** Under Settings > Notifications, choose an audio file and
  volume per event for anyone, friends, or favorite friends. Sounds work in background mode
  and respect Do Not Disturb and privacy lock.
- **Opt-in VRChat video playback helper.** Settings > Media installs managed yt-dlp master
  updates and a local PO-token provider. Cookie use is a separate opt-in: explicitly select a
  browser to refresh or import your own cookies.txt. Originals are backed up for restore.
  No video caching or browser extension. See [setup and playback limits](YTDLP_SETUP.md).
- **Safety watchlists and warnings.** Settings > Notifications includes group/avatar watchlists,
  opt-in community lists, and URL-host warnings. Group/avatar profiles have a Watch button;
  user/avatar profiles show community-list matches. Warning delivery uses the System & Safety
  filters and custom sounds. Logged URLs are inspected locally without fetching or resolving them.
  Community sources default to warnings; automatic user blocks and bans from selected owned
  groups require explicit configuration and are recorded in Safety history.
  Game-log tables and sessions show inline warnings without opening logged URLs.
  Group checks cover public memberships. Your own avatar ID can be confirmed through the API;
  other players' avatar alerts use names and explicitly mark the ID as unverified.
  Avatar lists offer reviewed batches of up to 25 exact IDs to block, with cancellation and
  per-ID results. A name match alone never blocks: an on-demand instance check looks names up
  with your avatar search provider and offers a confirmed block only when exactly one listed ID
  matches. Avatar lists can also be hidden account-wide at a throttled pace (daily cap, backoff);
  turning that off never unblocks, and unblocking is a separate reviewed action. Community lists
  hosted on GitHub are mirrored locally and refreshed when the repository changes.
  Instance kicks remain unavailable.
- **Assistant reminders.** Ask the assistant (with writes turned on) to tell you when a friend comes
  online, goes offline, moves or joins you, or at a time. Reminders are saved, fire as normal
  notifications with the chat closed, and are listed under Settings > AI.
- **Wrist overlay pages.** Hide and show the wrist overlay again quickly (3 seconds by default) to
  switch between the feed, the players in your instance, and the players you have notes on. Under
  Settings > VR you choose which pages appear, their order, the player order and the switch window.
- **Launch without Steam.** Set the VRChat install folder in Launch Options to start VRChat directly.
- **Import from VRCX or VRCX-0.** Merges the other app's database and adds settings you have not set
  here yet.
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
[latest release](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/latest):

| Platform          | File                                                |
| ----------------- | --------------------------------------------------- |
| Windows           | `VRCX-0-Nanashi_<version>_windows_x86_64_setup.exe` |
| macOS (Universal) | `VRCX-0-Nanashi_<version>_macos_universal.dmg`      |
| Linux             | `.AppImage`, `.deb`, or `.rpm`                      |

Fork builds are not code-signed. On Windows, SmartScreen may warn on first run. On macOS,
if the first launch is blocked, open **System Settings > Privacy & Security** and click
**Open Anyway**.

### Linux

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

This project is not endorsed by VRChat Inc. VRChat and all associated properties are
trademarks or registered trademarks of VRChat Inc.
