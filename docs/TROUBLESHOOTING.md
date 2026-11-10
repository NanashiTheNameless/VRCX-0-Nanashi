# Troubleshooting and advanced use

## Something went wrong

- **Error log**: `error-log.txt` in the data folder records errors and connection problems,
  including the provider's reply when the AI Assistant fails. Open it from Settings > Advanced >
  Troubleshooting. Attach it when reporting a bug, but read it first: it can contain local paths
  and account IDs.
- **Report a bug** from the app menu (**Report Issue on GitHub**), on this fork's repository,
  in English. Problems in this fork do not belong in upstream VRCX-0's tracker. Security
  problems are reported privately; see [SECURITY.md](../SECURITY.md).
- **Updates**: Settings > System > Updates chooses between no automatic checks, notify only,
  download in the background, or install on startup. Updates come from this fork's releases;
  the updater can also reinstall or downgrade to a chosen version. See [INSTALL.md](INSTALL.md).

## The window looks wrong

- **Flickering, or the desktop showing through**: turn on **Window Compatibility Mode**
  (Settings > System > Window & Tray), which uses the standard system window frame.
- **Linux**: hardware acceleration is off by default. Turn on **Hardware acceleration
  (experimental)** under Settings > System > Window & Tray and restart. After the restart you
  have 30 seconds to confirm the interface looks right; otherwise the app turns acceleration
  off again and restarts. NVIDIA GPUs on X11 or Hyprland usually cannot use it. Forcing
  compatibility with `WEBKIT_DISABLE_DMABUF_RENDERER=1`
  grays out this option and shows a note explaining the environment override.
  Menus, popups and dialog overlays are opaque on Linux and never use a backdrop blur; the app
  behind an open dialog still blurs, unless **Reduce Effects** is on.
  The option stays visible even when an environment override prevents changes. If that note
  appears after restarting an older build, fully quit the app and launch it again from the
  desktop. If the note remains, remove the override from your launcher or session to use the
  switch. The app keeps its own rendering choice out of the next process's startup environment.
- **A community theme broke the interface**: press Ctrl+Alt+Shift+T (Cmd on macOS) to turn
  community themes off for the session, then change the theme.
- **Too much motion**: turn on **Reduce Effects** (Settings > Interface > Appearance).

## VRChat behavior

Settings > System > VRChat behavior:

- **Auto Relaunch VRChat After Crash**: relaunch and rejoin the last instance after a crash.
- **Close lingering VRChat processes**: after VRChat exits, close any of its processes still
  running.
- **Bring VRChat to the front** when you join an instance (desktop mode only).

## More than one account, or another PC playing

- **Switch accounts** from the account menu at the top of the friends sidebar. Each account
  keeps its own game log, so playing on one account does not mix into another's history.
- **Game Isolation**: turn it on when the account signed in here is not the one playing VRChat on
  this PC (or when running more than one game client). While it is on, the game log is not
  recorded, your location and status come only from VRChat's servers, VR overlays, XSOverlay,
  OVR Toolkit and text-to-speech are off, and game-based automation, Discord status, screenshot
  info and crash relaunch are off. Desktop notifications and the Desktop Overlay keep working.
  Turn it on before launching VRChat; if VRChat is already running, recording stops from the
  next room.

## Storage and cleanup

Settings > Advanced > Storage & cleanup:

- **Data location**: where the app keeps its data. The app copies upstream VRCX-0's folder on
  first launch and never writes to it.
- **Clean VRChat cache automatically** when VRChat closes.
- **Keep avatar history for** a set time (checked weekly on startup), and **View history
  retention**.
- **Save Game Log history** and **Save Feed history**: when off, new history is not saved, but
  live features (Current Players, Now Playing, the friends sidebar) still work.
- **Danger zone**: permanently delete avatar history to reclaim disk space (the app restarts).
- **Database usage** (Troubleshooting) shows what takes space.

## Missing history

- History is only recorded while the app runs. To fill in the Game Log for times it was closed,
  use **Import Game Log from VRChat logs** (Settings > Advanced > Import & recovery); existing
  records are skipped.
- To keep your Feed recording while the PC is off, use History Sync's collector or the
  Self-hosted Recorder (Settings > Sync Options). See [FEATURES.md](FEATURES.md) and
  [RECORDER.md](RECORDER.md).
- Import from VRCX or VRCX-0, or restore a backup, under Settings > Advanced > Export & import
  data.

## Links

VRCX-0-Nanashi opens `vrcx-0-nanashi://` links, and can also take over `vrcx-0://` and `vrcx://`
links (Settings > Advanced > Troubleshooting), so links meant for VRCX or VRCX-0 open here.

## Logging for world creators

Settings > Advanced > Troubleshooting can log **Udon exceptions** and **Udon string and image
loads** from VRChat's log into the Game Log.

## Running without a window

**Headless mode** runs the app's core without any interface, for running on a server. It is
for advanced users; see the `crates/headless` folder in the repository.

## Keeping the PC awake

By default the app stops the PC from going to sleep on its own while it runs, so friend updates
and notifications keep arriving. The screen can still turn off. Turn it off under Settings >
System > Window & Tray.
