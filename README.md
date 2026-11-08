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

## Documentation

| Topic                                                  | What is in it                                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Using the app](docs/USER_GUIDE.md)                    | A guide to the whole app: pages, tools, settings tabs, notifications, VR, privacy, and the features it shares with upstream VRCX-0                                                             |
| [Pages](docs/PAGES.md)                                 | Every page in the app: what it shows and what you can do there                                                                                                                                 |
| [Dialogs](docs/DIALOGS.md)                             | The user, world, avatar, group, new instance and launch dialogs                                                                                                                                |
| [Layout and appearance](docs/LAYOUT_AND_APPEARANCE.md) | The window, friends sidebar, Sidebar Mode, Quick Search, keyboard shortcuts, Privacy Lock, themes                                                                                              |
| [Notifications and VR](docs/NOTIFICATIONS_AND_VR.md)   | Every notification channel, filters, Do Not Disturb, webhooks, HMD notifications and the wrist overlay                                                                                         |
| [Tools](docs/TOOLS.md)                                 | Screenshots, social automation, the Chatbox, App Launcher, groups, backups and more                                                                                                            |
| [AI Assistant](docs/AI_ASSISTANT.md)                   | Setting it up, what to ask, approving changes, reminders, the MCP server                                                                                                                       |
| [Integrations](docs/INTEGRATIONS.md)                   | Discord presence, translation, YouTube, avatar search providers, the Integration API                                                                                                           |
| [Troubleshooting](docs/TROUBLESHOOTING.md)             | Error log, display problems, multiple accounts, Game Isolation, storage, missing history                                                                                                       |
| [Badges](docs/BADGES.md)                               | Every badge next to user names: the built-in developer, upstream and VRChat Staff badges and how they look, global badges, custom badges and their rules                                       |
| [Profile History](docs/PROFILE_HISTORY.md)             | Per-field recording and encrypted sync choices for status, bio and pronouns, and the timeline in user dialogs                                                                                  |
| [What this fork changes](docs/FEATURES.md)             | Every difference from upstream VRCX-0: History Sync (RemoteSync), relay links, the self-hosted recorder, the AI Assistant, safety watchlists, the wrist overlay, notification sounds, and more |
| [Dates and timezones](docs/TIMESTAMPS.md)              | Epoch-second storage, automatic old-data migration, per-PC timezone settings, and sync compatibility                                                                                           |
| [Telemetry](docs/TELEMETRY.md)                         | What upstream telemetry was removed, the one anonymous adoption count this fork sends, every way to opt out, and the global badges list download                                               |
| [Install](docs/INSTALL.md)                             | Downloads for Windows, macOS and Linux, and platform notes                                                                                                                                     |
| [Building from source](docs/BUILDING.md)               | Requirements, dev and release builds, the RemoteSync collector and the recorder                                                                                                                |
| [Self-hosted Recorder guide](docs/RECORDER.md)         | Running your own recorder server                                                                                                                                                               |
| [Contributing](CONTRIBUTING.md)                        | How to propose changes to this fork                                                                                                                                                            |
| [Security](SECURITY.md)                                | How to report a security problem privately                                                                                                                                                     |

## At a glance

- **No usage telemetry.** Upstream's usage stats, heartbeats, crash reporting and feedback
  uploads are removed. The fork sends one anonymous adoption count, which you can turn off.
  See [Telemetry](docs/TELEMETRY.md).
- **Its own sync, off by default.** End-to-end encrypted History Sync through RemoteSync, on
  the official server or your own. It is preferred over upstream's Self-hosted Recorder, which
  is kept but experimental.
- **Separate app.** Installs side by side with upstream VRCX-0 with its own data folder, link
  scheme and updates.
- **Badges.** Badges next to user names: built in for the developers and VRChat Staff, your
  own custom ones, and global badges the developer gives to people who helped the fork
  (sponsors, contributors, bug and security reporters, testers and more). Want one? Open a
  [badge request](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/issues/new?template=badge_request.yml)
  with your VRChat user ID. See [Global badges](docs/FEATURES.md).
- **English only**, and updates come from this fork's
  [Nightly-Rolling release](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/Nightly-Rolling).

The full list is in [What this fork changes](docs/FEATURES.md).

## Credits

VRCX-0-Nanashi is built on [VRCX-0](https://github.com/Map1en/VRCX-0) by Map1en and its
contributors, which in turn builds on [VRCX](https://github.com/vrcx-team/VRCX). Thanks to
everyone who worked on both.

## Support this fork

As a thank-you, supporters can get a Donator or Sponsor badge that everyone using
VRCX-0-Nanashi sees next to their name. After supporting, open a
[badge request](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/issues/new?template=badge_request.yml)
with your VRChat user ID.

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
