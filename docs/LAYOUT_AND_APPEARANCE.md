# Layout and appearance

How the window is laid out, how to move around quickly, and how to change the way the app
looks.

## The window

- **Left navigation**: every page. It can be collapsed to icons (Ctrl+B, or Cmd+B on macOS).
  Right-click a navigation item to customize the menu: drag items to reorder them, drop them
  into folders, rename folders, change icons, and hide items (they move to a Hidden list you
  can bring them back from). You can also restore the default arrangement. See
  [PAGES.md](PAGES.md).
- **Main area**: the page you are on.
- **Friends sidebar** (the side panel) on the right. Show or hide it with Ctrl+Shift+B or the
  app menu.
- **Status bar** at the bottom: background work such as the mutual friend fetch, and connection
  state.
- **App menu**: Settings, Check for Updates, Restart, Switch to Background Mode, Sign Out,
  Quit, Quick Search, Keyboard Shortcuts, show or hide the friends sidebar, Sidebar Mode,
  Always on Top, zoom, Report Issue on GitHub, Third-Party Notices and About. About shows when
  the app started, how long the session and the current instance have lasted, and the last game
  event.

## Friends sidebar

The sidebar lists your friends and groups in tabs.

- **Friends** shows you at the top ("ME", with an account menu to change your status, pick
  from recent statuses and saved presets, clear the status text or switch accounts), then
  favorites, friends in the same instance, online friends, friends online on the website or
  another platform, and offline friends. Friends who may have just gone offline show as
  **Possibly Offline**.
- **Groups** shows your groups' open instances.
- Its settings can group friends in the same instance, split favorites by favorite group, also
  show grouped friends in other sections, place the same-instance section above favorites, and
  sort by one rule then another.
- **Customize tabs** reorders the tabs and adds your own tabs built from VRChat or local
  favorite groups. Tabs can show an icon, text or both. Friends and Groups are built in.
- **Pinned worlds**: pin a world from its world dialog and it gets a tab of its own, showing the
  world's public instances and which friends are in them, so you can join from the sidebar.
- A filter box filters friends, groups or instances. **Refresh friends list** in the sidebar's
  settings updates your friends list, online/offline presence and favorites, with a 30-second
  cooldown. To fetch every friend's full profile details again, use **Refresh all friend
  profiles** on the Friends page; it has a separate 5-minute cooldown after completion or
  cancellation.
- The **Notification Center** in the sidebar shows recent notifications grouped by Needs
  Action, Activity and System, with **Join now**, mark as read and mark all read.

## Sidebar Mode

**Sidebar Mode** (app menu) shrinks the whole window into just the friends sidebar, to keep
next to VRChat or another app. **Return to Full Window** brings the full app back. On Windows
and macOS the sidebar can dock to the top or either side of the desktop and hide itself when
**Auto-hide when docked to a desktop edge** is on: drag it to the edge, and it slides away when
the pointer leaves and comes back when you move the pointer to that edge.

## Quick Search and Direct Access

- **Quick Search** (Ctrl+K) jumps to any page, opens a tool, or searches your friends (by name,
  local note and VRChat note), your own and favorite avatars and worlds, your groups and joined
  groups. Recently opened items show first.
- **Direct Access** (Ctrl+D) opens a pasted link or ID straight away: a `usr_`, `wrld_`,
  `avtr_`, `grp_` ID or a `vrchat.com` link. If your clipboard holds one, press Enter to open it.

## Keyboard shortcuts

Ctrl is Cmd on macOS. **Keyboard Shortcuts** (Ctrl+/) lists them all.

| Keys             | What it does                                                           |
| ---------------- | ---------------------------------------------------------------------- |
| Ctrl+K           | Quick Search                                                           |
| Ctrl+,           | Settings                                                               |
| Ctrl+D           | Direct Access                                                          |
| Ctrl+/           | Keyboard Shortcuts                                                     |
| Hold Ctrl        | Show shortcut hints on screen                                          |
| Ctrl+1 to Ctrl+9 | Open navigation item 1 to 9                                            |
| Ctrl+B           | Collapse or expand the navigation                                      |
| Ctrl+Shift+B     | Hide or show the friends sidebar                                       |
| Ctrl+Alt+Shift+T | Turn community themes off for this session (if a theme breaks the app) |
| Left / Right     | Previous or next page in search results and tables                     |

In screenshot details: Left and Right go to the previous and next screenshot, I shows or hides
details, Space opens it full screen, F favorites it, Ctrl+C copies the image, and Delete deletes
the file. In the full-screen image viewer: + and - zoom, R rotates, 0 resets, Escape closes.
Escape clears a selection in screenshots and favorites, and Ctrl+V pastes an image to upload in
the Gallery and Inventory.

**Show / Hide VRCX-0-Nanashi** (Settings > System > Window & Tray) sets a global shortcut that
works from any app, on Windows. Use Ctrl or Alt with a letter, number or function key.

## Window, tray and background mode

Under **Settings > System > Window & Tray**:

- **Minimize to Tray When Closing** keeps the app running in the tray when you close the window.
- **Background Mode in Tray**: when the window is hidden, the app drops its interface and keeps
  only its core running (recording, notifications, overlays), using far less memory.
  **Delay Background Mode** waits a number of minutes (10 to 600) before doing so. You can also
  switch now from the app menu.
- **Privacy Lock**: see below.
- **Hardware acceleration (experimental)**, on Linux: see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
- **Window Compatibility Mode** for systems where the window misbehaves.

By default the app also keeps the PC from going to sleep, so live updates keep arriving while
it sits in the tray; the screen can still turn off.

## Privacy Lock

The Privacy Lock hides the app behind a 4-digit lock password while it keeps running and
recording, so someone at your PC cannot browse your history. Set the password under Settings >
System > Window & Tray > Privacy Lock, then lock from the tray or the app. From the lock screen
you can also switch to Background Mode or sign out. Forgot the password? Remove the lock with
your VRChat account password (checked against the password the app has saved) or by approving a
QR code on a phone signed in to the same VRChat account.

## Themes

Open **Settings > Interface > Appearance**, or the **Themes** dialog, to change the look.

- **Theme**: light, dark, or following the system. The title bar has a quick toggle.
- **Accent color**: pick a preset or any color.
- **Source**: the **Default** themes, a **Background image**, or a **Community theme**.
- **Background image**: NASA's daily Astronomy Picture of the Day (only images without a
  copyright notice), your own image, several images or a folder (including subfolders) that
  rotates every few minutes, or a VRChat profile decoration. **Dimming** (subtle, balanced or
  strong) keeps text readable.
- **Community themes**: browse the catalog (from GitHub), install and enable a theme, update it,
  or disable and delete it. A theme tested with an older app version is marked. Some themes
  control the accent color themselves. Theme authors can preview a local theme folder that
  reloads as they edit it.
- **Custom CSS**: write your own CSS in the built-in editor, on top of any theme.
- If a theme makes the app unusable, press Ctrl+Alt+Shift+T to turn community themes off for
  the session.

## Text, tables and colors

Under **Settings > Interface**:

- **Appearance**: language (English), font (the bundled 0xProto, system fonts, a few online
  fonts, or your own), zoom, table density (standard or compact), striped tables, **Reduce
  Effects** (stops animations, badge effects included, and blur), and **Accessible Status
  Indicators** (status dots get shapes as well as colors).
- **Profile Appearance**: VRChat profile decorations (backgrounds, avatar frames, profile and
  nameplate effects). They are off by default and can be turned on separately for the user
  dialog, hover cards, the sidebar, the friends and worlds views, and the Activity journey.
- **Display**: show instance IDs, show age-gated instances.
- **Lists & Tables**: page sizes and how many entries tables keep.
- **Time/Date**: 12 or 24 hour time, date format (time or date first, MM/DD/YY, DD/MM/YY or
  YYYY-MM-DD, or the language default), forcing ISO dates, the first day of the week, relative
  or exact times in the Feed, and your timezone (blank follows the system). See
  [TIMESTAMPS.md](TIMESTAMPS.md).
- **User Colors**: give each user a consistent color from their user ID (classic, pastel, warm
  or cool), and set the colors used for each trust level (Visitor, New User, User, Known User,
  Trusted User, and VRChat Team).
- **User Dialog**: show or hide nicknames from local notes, VRChat notes and local notes.
- **User Badges**: under Settings > Social; see [BADGES.md](BADGES.md).
