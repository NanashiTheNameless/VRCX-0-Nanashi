# Install

Grab the file for your platform from the
[Nightly-Rolling release](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/Nightly-Rolling):

| Platform          | File                                                |
| ----------------- | --------------------------------------------------- |
| Windows           | `VRCX-0-Nanashi_<version>_windows_x86_64_setup.exe` |
| macOS (Universal) | `VRCX-0-Nanashi_<version>_macos_universal.dmg`      |
| Linux (AppImage)  | `VRCX-0-Nanashi_<version>_linux_x86_64.AppImage`    |

Each nightly release also carries the Self-hosted Recorder for Linux servers as
`vrcx-0-logger_<version>_linux_x86_64` and `vrcx-0-logger_<version>_linux_aarch64`. Most people
should use the install script or Docker image described in the
[recorder guide](crates/logger/README.md) instead of the bare binary.

Fork builds are not code-signed. On Windows, SmartScreen may warn on first run. On macOS,
if the first launch is blocked, open **System Settings > Privacy & Security** and click
**Open Anyway**.

## Linux

On first launch, the AppImage removes its build version from the standard download
filename, leaving `VRCX-0-Nanashi_linux_x86_64.AppImage`. Custom filenames are kept,
and an existing file with the destination name is never replaced.

Hardware acceleration for the app interface is off by default. Turn it on under
**Settings > System > Hardware acceleration (experimental)**; if the interface doesn't
display properly, the app turns it back off automatically. Setting
`WEBKIT_DISABLE_DMABUF_RENDERER` yourself hides this option.

[Back to the README](README.md)
