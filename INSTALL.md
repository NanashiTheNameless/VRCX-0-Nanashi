# Install

Grab the file for your platform from the
[Nightly-Rolling release](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/Nightly-Rolling):

| Platform         | File                                                |
| ---------------- | --------------------------------------------------- |
| Windows          | `VRCX-0-Nanashi_<version>_windows_x86_64_setup.exe` |
| Linux (AppImage) | `VRCX-0-Nanashi_<version>_linux_x86_64.AppImage`    |

macOS is not supported.

Each nightly release also carries the Self-hosted Recorder for Linux servers as
`vrcx-0-logger_<version>_linux_x86_64` and `vrcx-0-logger_<version>_linux_aarch64`, and for
Windows as `vrcx-0-logger_<version>_windows_x86_64.exe`. On Linux, most people should use the
install script or Docker image described in the [recorder guide](crates/logger/README.md)
instead of the bare binary.

Fork builds are not code-signed. On Windows, SmartScreen may warn on first run.

## Upgrading from older builds

An existing fork profile always takes priority. During normal startup with no fork profile, the app
automatically imports upstream VRCX-0 first, then original VRCX. It follows
upstream VRCX-0's custom data-directory pointer and VRCX's custom database
location, including supported Wine installations on Linux. The source is read
only. Interrupted imports resume, and conflicting files are never overwritten.
Corrupt databases, unsupported newer VRCX schemas and missing custom databases
stop the import with an error instead of silently creating an empty profile.
An explicit `--data-dir` stays isolated: existing files there migrate, and an
empty directory starts a separate profile.

From 3.0.1, the desktop executable is `VRCX-0-Nanashi` (`.exe` on Windows).
The first launch copies `VRCX-0.sqlite3` and `VRCX-0.json` to
`VRCX-0-Nanashi.sqlite3` and `VRCX-0-Nanashi.json` in the same data directory.
The SQLite snapshot includes committed WAL data and must pass an integrity
check before it becomes active. The original files remain for recovery.
Older exports and profile backups remain importable. The updater blocks all
releases with a base version below 3.0.1, including older nightly builds.
Autostart entries are refreshed when the updated app starts.

## Linux

On first launch, the AppImage removes its build version from the standard download
filename, leaving `VRCX-0-Nanashi_linux_x86_64.AppImage`. Custom filenames are kept,
and an existing file with the destination name is never replaced.

Hardware acceleration for the app interface is off by default. Turn it on under
**Settings > System > Hardware acceleration (experimental)**; if the interface doesn't
display properly, the app turns it back off automatically. Setting
`WEBKIT_DISABLE_DMABUF_RENDERER` yourself hides this option.

[Back to the README](README.md)
