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

| Topic                                                 | What is in it                                                                                                                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [What this fork changes](FEATURES.md)                 | Every difference from upstream VRCX-0: History Sync (RemoteSync), relay links, the self-hosted recorder, Social AI, safety watchlists, the wrist overlay, notification sounds, and more |
| [Dates and timezones](TIMESTAMPS.md)                  | Epoch-second storage, automatic old-data migration, per-PC timezone settings, and sync compatibility                                                                                    |
| [Telemetry](TELEMETRY.md)                             | What upstream telemetry was removed, the one anonymous adoption count this fork sends, and every way to opt out                                                                         |
| [Install](INSTALL.md)                                 | Downloads for Windows and Linux, and platform notes                                                                                                                                     |
| [Building from source](BUILDING.md)                   | Requirements, dev and release builds, the RemoteSync collector and the recorder                                                                                                         |
| [yt-dlp setup](YTDLP_SETUP.md)                        | The opt-in VRChat video playback helper                                                                                                                                                 |
| [Self-hosted Recorder guide](crates/logger/README.md) | Running your own recorder server                                                                                                                                                        |
| [Contributing](CONTRIBUTING.md)                       | How to propose changes to this fork                                                                                                                                                     |

## At a glance

- **No usage telemetry.** Upstream's usage stats, heartbeats, crash reporting and feedback
  uploads are removed. The fork sends one anonymous adoption count, which you can turn off.
  See [Telemetry](TELEMETRY.md).
- **Its own sync, off by default.** End-to-end encrypted History Sync through RemoteSync, on
  the official server or your own. It is preferred over upstream's Self-hosted Recorder, which
  is kept but experimental.
- **Separate app.** Installs side by side with upstream VRCX-0 with its own data folder, link
  scheme and updates.
- **English only**, and updates come from this fork's
  [Nightly-Rolling release](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/Nightly-Rolling).

The full list is in [What this fork changes](FEATURES.md).

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
