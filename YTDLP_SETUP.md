# VRChat video playback helper

Open **Settings > Media > VRChat video playback helper**. The feature starts disabled.
Enable it and save to install managed yt-dlp **master** builds, Node.js 22, and the pinned
bgutil PO-token provider. Review the detected VRChat `Tools` folder before installing.
Linux discovers the VRChat Steam/Proton prefix; a folder override is available.

The helper preserves VRChat's original `yt-dlp.exe` and `yt-dlp.conf`, installs the managed
build with a portable config, and starts a token service on `127.0.0.1:4416`. Keep the app
running, including in background mode. It checks master builds daily and reapplies the
managed files when VRChat replaces its executable. **Check / repair installation** retries
setup or checks immediately. Downloads have size limits and SHA256 verification. Existing
user edits to the config cause a visible conflict instead of being overwritten.

## Cookies are a separate choice

Enabling the helper does **not** read browser cookies. To use cookies:

1. Turn on **Allow use of YouTube cookies**, then save.
2. Either explicitly select a browser and optional profile and press **Read and refresh
   cookies**, or choose your own Netscape-format **cookies.txt** file with **Import cookies.txt**.
3. Browser extraction asks for confirmation naming the selected browser and profile. File
   import reads only the file selected in the picker. Neither operation runs automatically.

Only unexpired YouTube cookies are retained. Persistent storage is obfuscated, not encrypted;
keep the profile folder private. Browser extraction briefly writes a private temporary file
which is removed afterward (or at the next startup after an interruption). Playback loads
cookies directly into yt-dlp's memory, without writing a plaintext playback cookie file.
**Forget stored cookies** deletes the saved copy and disables its use.

The status shows refresh time, cookie count and known expiry. These do not prove that YouTube
will accept a session. **Test YouTube playback** resolves one fixed test video without
transferring video. Network errors, restrictions on that video, expired sessions and bot checks
can all cause a failure. Visiting YouTube again may rotate cookies; use a separate browser
profile if desired. Chromium on Windows may require closing the browser and may still refuse
cookie decryption; Firefox or a supplied cookies.txt file provides another route. Synchronize
system time if playback or token checks fail.

## Restore and uninstall

**Disable and restore originals** stops the token service and restores the backed-up files.
If VRChat updated its executable while the helper was enabled, that newer original is retained
for restore. Backups stay in `Tools/.vrcx-nanashi-ytdlp` for manual recovery. Modified files or
invalid backups cause restoration to stop with a visible error.

The Windows NSIS uninstaller runs restore before deleting the app; updater replacements skip
that step. On Linux, disable and restore before removing the app. Headless recovery is also
available with `vrcx-0 --restore-ytdlp` (add `--data-dir PATH` for a custom command-line profile).
Close the app before running headless recovery. Cookies are removed by headless uninstall
recovery; disabling the feature alone retains them until **Forget stored cookies** is used.

## Playback limits

This is direct URL extraction with cookies and PO tokens. It does not cache videos, install
browser extensions, or run a streaming relay. SABR-only videos require a relay that speaks that
protocol; a "prefer SABR" switch would not make them playable through this helper. Tokens and
cookies cannot guarantee that every YouTube bot check or video restriction will be resolved.

The managed components are downloaded only after enabling: [yt-dlp master builds](https://github.com/yt-dlp/yt-dlp-master-builds),
[Node.js](https://nodejs.org/), and [bgutil provider 2.0.0](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/tree/2.0.0).
Provider source and plugin checksums are pinned in the integration. Node/provider dependency
installation requires internet access; Linux also needs `tar` with xz support. Component
licenses remain in their downloaded distributions/source folders.

## Development checks

- `cargo test --locked -p vrcx-0-ytdlp`
- `python3 crates/ytdlp/tests/test_cookie_plugin.py` (requires an installed yt-dlp Python module)
- `npm test -- src/features/settings/components/settings-tabs/SettingsYtdlpCard.test.tsx`
- `cargo test --locked -p vrcx-0-ytdlp managed_components_smoke -- --ignored`

The last check downloads real components into a temporary fake VRChat installation, checks
provider startup/plugin loading, and restores it. It does not read browser cookies or request
video content. Real Windows/Proton playback and Windows installer behavior still require
platform testing.
