# Install

Grab the file for your platform from the
[Nightly-Rolling release](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/Nightly-Rolling):

| Platform          | File                                                |
| ----------------- | --------------------------------------------------- |
| Windows           | `VRCX-0-Nanashi_<version>_windows_x86_64_setup.exe` |
| macOS (Universal) | `VRCX-0-Nanashi_<version>_macos_universal.dmg`      |
| Linux (AppImage)  | `VRCX-0-Nanashi_<version>_linux_x86_64.AppImage`    |

macOS packages can show up later than the rest of a release; see
[Why macOS shows up late](#why-macos-shows-up-late).

Each nightly release also carries the Self-hosted Recorder for Linux servers as
`vrcx-0-logger_<version>_linux_x86_64` and `vrcx-0-logger_<version>_linux_aarch64`, and for
Windows as `vrcx-0-logger_<version>_windows_x86_64.exe`. On Linux, most people should use the
install script or Docker image described in the [recorder guide](RECORDER.md)
instead of the bare binary.

New builds use NamelessNanashi's self-signed identity. This does not establish
Microsoft or Apple trust: Windows SmartScreen can still warn, and on macOS a
blocked first launch still needs **System Settings > Privacy & Security > Open
Anyway**.

Release downloads include matching `.nn-signature` files. Verify a download with
OpenSSL and a trusted copy of the public key in `signing/release-public-key.pem`:

```bash
openssl dgst -sha256 -verify NamelessNanashi-release-public-key.pem -signature DOWNLOAD.nn-signature DOWNLOAD
```

Success prints `Verified OK`. The release also includes the public key as
`NamelessNanashi-release-public-key.pem`; compare it with a copy you already
trust before using it to verify files. These signatures are separate from the
in-app updater's existing signatures.

## Why macOS shows up late

Windows and Linux packages are released the moment they build. macOS is not
allowed to hold them up, because GitHub's macOS runners are the worst part of
this entire pipeline: slow to start, slower to build, frequently never picked up
at all, and prone to falling over halfway through for no reason anyone can
explain. Letting a release wait on them would mean letting a coin flip decide
whether anyone gets an update today.

So macOS builds run on their own and are added to a release after it is
already published. When GitHub cannot be bothered to hand out a macOS runner at
all (often), [retry-unacquired-runners](../.github/workflows/retry-unacquired-runners.yml)
re-runs just the failed macOS jobs, and the packages are added to that release
whenever they finally finish. A macOS job that gets a runner and then dies
anyway can be brought back with "Re-run failed jobs", with the same result.
Installed macOS builds only update to releases that include macOS. If the
newest release has no `.dmg` yet, grab one from an earlier
[release](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases), or
wait for the runners to wake up.

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
display properly, the app turns it back off automatically. NVIDIA GPUs on X11 or Hyprland
usually cannot use it. Forcing compatibility with
`WEBKIT_DISABLE_DMABUF_RENDERER=1` leaves this option visible but grayed out, with a note
explaining why it cannot be changed.

[Back to the README](../README.md)
