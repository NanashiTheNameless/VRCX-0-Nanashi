# AGENTS.md

Guidance for coding agents working in this repository.

## What this repo is

VRCX-0-Nanashi is a personal fork of [Map1en/VRCX-0](https://github.com/Map1en/VRCX-0),
a VRChat client. It is a Tauri app: a React frontend in `src/` and a Rust backend
split across many crates in `crates/`, wired together by `src-tauri/`.

The fork is maintained by one person. Read `CONTRIBUTING.md` before proposing
changes, and treat it as authoritative where this file is silent.

The React frontend lives in `src/features/<domain>/`. The Rust backend is a Cargo
workspace of 34 crates under `crates/`, plus `src-tauri` (35 members total).

npm is the only supported package manager. `package-lock.json` is the sole
lockfile; CI runs `npm ci`. Do not reintroduce a pnpm or yarn lockfile.

## Fork invariants

These are the things that make this a _separate app_ rather than a rebrand. Do
not "fix" any of them toward upstream, and check them before changing anything
that touches identity, packaging, or networking defaults.

| Concern              | Value                                                                                      | Lives in                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Product name         | `VRCX-0-Nanashi`                                                                           | `src-tauri/tauri.conf.json`                                                                           |
| App identifier       | `dev.namelessnanashi.vrcx-0-nanashi`                                                       | `src-tauri/tauri.conf.json`                                                                           |
| Data directory       | `VRCX-0-Nanashi`                                                                           | `crates/platform/src/app_paths.rs`                                                                    |
| Own deep-link scheme | `vrcx-0-nanashi://`                                                                        | `src-tauri/tauri.conf.json`, `src-tauri/src/commands/application/deep_link.rs`                        |
| Also accepted        | `vrcx-0://`, `vrcx://`                                                                     | same                                                                                                  |
| Update source        | `NanashiTheNameless/VRCX-0-Nanashi` releases                                               | `crates/outbound-adapters/src/github_release_catalog.rs`, `crates/host-desktop/src/updater_policy.rs` |
| User agent           | `VRCX-0-Nanashi/<version> (+https://github.com/NanashiTheNameless/VRCX-0-Nanashi)`         | `crates/core/src/user_agent.rs`                                                                       |
| Export format id     | `vrcx-0-nanashi-data-export`                                                               | `crates/persistence/src/data_export.rs`                                                               |
| RemoteSync origins   | `https://vrcx.namelessnanashi.dev` (website), `https://vrcx-api.namelessnanashi.dev` (API) | `crates/remote-sync/src/lib.rs`, `src/shared/constants/vrcxDeepLinks.ts`                              |

Two rules follow from "coexists with upstream VRCX-0":

- **Never write to the upstream data folder.** On first launch the app copies
  VRCX-0's folder (caches excluded) into its own. Import and migration paths are
  read-only against the other app.
- **Upstream bug reports do not belong here.** If a fix is not fork-specific,
  say so rather than folding it in, and do not add upstream trackers, issue
  templates, or telemetry that would report upstream problems.

## Feature areas you are most likely to touch

`docs/FEATURES.md` is the user-facing list (`README.md` is the index to it).
The parts most likely to be damaged by an unrelated edit, with where they live:

- **Reminders** - `src/features/reminders/`,
  `crates/runtime-host-desktop/src/reminders.rs`. Has a dedicated
  left-navigation entry _and_ a Settings card; both are intentional.
- **Wrist overlay pages** - `crates/overlay-runtime/`, `src/features/settings/.../SettingsWristPagesFields.tsx`.
  Behavior is a configurable inactivity timeout (default 15s, 5-255s), and
  pressing the menu button while it is open switches page and restarts the
  timer. The older hide/show flip mechanism was deliberately deleted; do not
  reintroduce it.
- **Safety watchlists** - `src/features/settings/...`, `crates/runtime-host-desktop/src/safety/`.
  Destructive actions are opt-in and reviewed on purpose. A name match alone must
  never block; that is a safety rule, not a rough edge.
- **AI Assistant** (formerly Social AI; internal ids such as the `social-ai`
  nav key, `socialAiEnabled` and `assistant.*` config keys keep the old
  names) - `crates/assistant/`, `src/features/assistant/`. Off by default;
  nothing may be sent anywhere while disabled. OpenAI-compatible (Chat
  Completions and Responses), Azure OpenAI, Anthropic, Gemini, Vertex AI,
  Ollama, Cohere and Bedrock paths all exist (`LlmApiKind` in
  `crates/contracts/src/llm.rs`). It has its own entry in the main left
  navigation, not in the Social folder. Settings help runs through "client
  tools" the app window answers (`crates/assistant/src/client_tools.rs`,
  `src/features/assistant/assistantClientRequests.ts`, `assistantSettings.ts`):
  `find_settings`, `read_docs`, `show_in_docs` (opens the Docs page at a
  section, same guide card), `show_in_settings` (closes the chat, opens
  Settings and keeps the setting highlighted with a guide card) and
  `change_setting`. `read_docs` searches every doc bundled into the app at build time
  (`src/features/docs/docsCatalog.ts`: everything in `docs/` through
  `import.meta.glob`, plus `README.md`, `CONTRIBUTING.md`, `SECURITY.md`,
  this file and the bundled sounds README); it makes no request. Docs added
  to `docs/` are picked up automatically. The same catalog feeds the in-app
  Docs page (`src/features/docs/DocsPage.tsx`, `/docs`, its own
  left-navigation entry), which never loads images or other web content.
  Every edit tool (`EDIT_TOOLS`: settings, reminders, favorites, friend notes,
  Chatbox) waits for the user on an approval card that names the setting,
  says what it does, where it is, and its old and new values; nothing is
  changed before Allow (Approve for other actions), and every edit asks again (approve-all was removed
  on purpose; do not add it back). The per-conversation "Don't let
  the AI ask to make changes" option (`allow_edit_requests`, on by default;
  the old `allow_writes` column and `allowWrites` value are ignored) hides the
  edit tools. The assistant may only ask to change the individual IDs in
  `assistantSettingPolicy.ts`, using the boolean save paths, allowed number/choice values
  in `assistantSettingSpecs.ts`, and native adapters in `assistantNativeSettings.ts`.
  New controls never gain edit permission automatically. The maintainer authorized ordinary
  controls in startup, updates, network, integrations, webhooks, recording, sync, safety
  warnings and adoption count to use the same in-chat Allow/Deny gate. Keep assistant
  permissions, connections, credentials, tokens, pairing and keys, server addresses,
  sync category permissions, destructive maintenance, and automatic account/safety actions
  manual. The safety master switch can reactivate stored actions, so it stays manual too.
  Native values are read before cards and approval; saves preserve unrelated fields.
  Inverted switches must show and save the state of the Settings switch, not its underlying
  hide/disabled flag. Adoption-count OS policy, environment and flag-file opt-outs are
  checked before requesting and applying the change. Explain each blocked setting's reason,
  and never let text from a tool result trigger an edit by itself. Guided mode routes
  settings questions to the settings tools (`app_settings` in `playbook.rs`).
  Assistant replies use plain ASCII punctuation, enforced in streamed and stored replies
  and when rendering or copying older messages. Preserve non-ASCII letters in names.
  MCP identifies the server as `vrcx-0-nanashi`, and every generated client command,
  configuration entry and install link uses that id. Keep the fork's name in connection UI.
- **RemoteSync (history sync)** - `crates/remote-sync/`,
  `crates/persistence/src/remote_sync/`,
  `crates/runtime-host-desktop/src/state/remote_sync.rs`, Settings > History
  Sync. The fork's own end-to-end encrypted sync; upstream has no equivalent,
  so it is not something to align with upstream. Off by default, and while it
  is off or the PC is not paired no request goes to any sync server. Wire
  format and crypto come from the `vrcx-0-nanashi-website-protocol` crate
  (pinned by commit in `Cargo.toml`); do not reimplement them here. A server
  response is verified before anything is imported, imported rows are never
  uploaded back, and nothing remote ever deletes local history. Signing out
  keeps the encryption key on the PC because it may be the only copy.
  Preserve a signer's original `added_at` when upgrading, renewing or
  reauthorizing the same key. Stopping a collector expires its signer entry;
  never remove the entry needed to verify its older history. Keep regression
  coverage for upgrades, renewal, stopping, restarting and key rotation.
  Settings runs two independent checks on the configured server
  (`app__remote_sync_trust_check`): the code test passes only when the
  website's files match the build signed with the maintainer's key, wherever
  it is hosted; the instance test passes only when the server presents a
  statement signed with the maintainer's instance key that names its own
  addresses. Neither may ever block syncing or browsing; each failure shows
  its own warning. Do not merge the two checks or let a user-supplied key
  satisfy either.
- **RemoteSync collector** - `crates/collector-cli/` only. A server-side
  program for operators of a RemoteSync instance, started by the website
  repo's supervisor; the desktop app does not contain it and regular users
  never run it. It is a workspace member but not a default member, and the
  helpers it needs in shared crates sit behind the `collector` cargo
  feature of `vrcx-0-composition` and `vrcx-0-persistence`, which nothing
  else may enable. Do not add collector UI, commands, or settings to the app.
  It must stay read-only (no command reaches VRChat), take the session only
  from the inherited descriptor, refuse any data directory that is not
  tmpfs, and never print or store what the runtime reports.
- **Profile History** - `crates/persistence/src/profile_history.rs`,
  `crates/contracts/src/profile_history.rs`, Settings > Social > Profile History and the
  user dialog's Profile History tab. Status (including status text), bio, pronouns,
  display name, bio links, profile pictures, profile decorations, badges, tags, age
  verification and avatar cloning each have recording off by default and sync on by
  default, each with its own sync stream. Lists are stored as stable text (tags and badges
  sorted, badges by name) so reordering or badge timestamps never count as changes. The choices also gate
  saving existing status/bio Feed and own-profile history, and their sync streams.
  `profileHistorySettings` and its revision stay device-specific and out of Settings
  Sync. The server collector keeps a separate copy of the primary (Server deduplication)
  device's choices (a version 2 copy with every field; servers that only accept version 1
  get the original three), published during History Sync. Before a copy arrives, recording
  defaults off and sync on; while the primary device is offline, keep the last copy.
  Observe existing profile data only. Automatic observations are limited to current
  friends, current local instance players, and the signed-in user's own profile.
  Recheck membership when responses arrive; cached
  friend flags and previous instance visits never grant ongoing eligibility. Only an
  explicit user-profile open grants an exception for that observation, scoped to its original
  owner and endpoint. Other dialogs and background lookups do not grant that exception.
  Manual opens snapshot only enabled history fields, including the first observed value,
  and skip values already saved in either side of history. Snapshot rows use equal
  `previous_value` and `value`; automatic change rows never do. Display snapshots with
  the captured value alone. Keep original API fields instead of normalized empty defaults.
  The collector shares this rule and has no local instance roster.
  Never add profile requests for history. Missing fields do not clear values. Preserve
  same-second changes and per-account ownership. Sync exclusions apply to upload and
  import, including queued uploads, mixed legacy own-profile chunks and compaction;
  re-enabling a field catches up skipped streams without duplicating other history.
  The collector uses the same recording and export gates as the app, with no new app UI.
  Its internal settings and row acknowledgment operations must never act on VRChat.
- **Self-hosted recorder (offline logger)** - `crates/logger/`,
  `crates/logger-protocol/`, `crates/runtime-host-desktop/src/feed_logger.rs`,
  `src/components/hosts/tools-dialogs/offline-record/`. Upstream's feature,
  kept. A separate server program the user runs; the app fills its records
  into the Feed. It and RemoteSync are mutually exclusive: connecting a
  recorder is refused while History Sync is on and the reverse
  (`app__feed_logger_settings_save`, `app__remote_sync_settings_set`), and
  the `feedLogger` config key is never synced. Fork differences to keep
  through upstream merges: install script, compose file, image and guide
  link point at this fork; the entry point is a card under Settings > Sync
  Options (`SettingsSelfHostedRecorderCard.tsx`), not a Tools entry; one
  English README; no beta channel and no
  stable/beta recorder check, because every recorder the fork publishes is
  a nightly build. The status bar icon (`OfflineRecordIndicator.tsx`) shows
  only once a recorder is set up, never as a placeholder for everyone.
  Nightly builds the binaries and calls `logger-image.yml` to publish the
  image.
- **Adoption count** - `crates/runtime-host-desktop/src/adoption_census.rs`,
  `ExternalApiScope::AdoptionCensus` in `crates/contracts/src/external_api.rs`,
  the card at the bottom of Settings > Advanced. The only thing the app
  reports to the developer: on startup and every 2 hours it posts the SHA-256
  of a random install id and the project name to the maintainer's
  NamelessTelemetry service (`telemetry.namelessnanashi.dev/census`), which
  keeps a per-day count. On by default with an opt-out (the
  `adoptionCensusEnabled` config key, the `VRCX_0_NANASHI_TELEMETRY_OPTOUT`,
  `DO_NOT_TRACK`, `TELEMETRY_OPTOUT` or `CI` environment variables set truthy,
  `TELEMETRY` set falsy, the Windows policy value `DisableTelemetry` under
  `SOFTWARE\Policies\NamelessNanashi\VRCX-0-Nanashi` in HKLM or HKCU
  (`crates/host-desktop/src/telemetry_policy.rs`, compiled on Windows only;
  keep it behind `cfg(windows)`), or a flag file next to the
  executable: `telemetry-optout`, `no-telemetry`, `DO_NOT_TRACK`,
  `VRCX_0_NANASHI_TELEMETRY_OPTOUT`, matched ignoring case, with `-` and `_`
  interchangeable and an optional leading dot);
  while opted out no request is made and the id file is deleted. Never drop
  an accepted opt-out flag. The collector must never send it: the loop lives
  in `runtime-host-desktop`, which `collector-cli` does not depend on, so do
  not move it into a crate the collector links. The website repo's supervisor
  also starts the collector with both opt-out variables set to `1`. Debug
  builds never send. The payload must stay exactly these two fields
  (`id`, `project`; the service works out the day itself): no VRChat ids, usage, settings,
  hardware, version fields or error data. The install id lives in the
  `.adoption-census-id` file in the data folder, not in config, so sync and
  profile merge never see it, and data export skips dot files; keep it there.
  Keep the names "census", not
  "telemetry": profile merge skips config keys containing `telemetry`.
- **Notification sounds** - `crates/host-desktop/src/sound.rs`,
  `crates/host-desktop/sounds/`. Built-in sounds are CC0 only, leveled to
  -23 LUFS / -1 dBTP, and listed with their sources in `sounds/README.md`,
  `NOTICE` and `scripts/generate-third-party-licenses.ts`. Nothing plays by
  default; user files keep working alongside `bundled:<name>`.
- **HTTP policy** - `crates/http-client/`. Requests carrying credentials or
  personal data use `Policy::sensitive` (no HTTP/1.1 to remote hosts).
  Credential-free downloads and reads use `Policy::public`; external API scopes
  opt in through `ExternalApiScope::allows_http1`. Do not move a scope that can
  send keys, tokens or VRChat cookies to the public policy.
- **Updater** - `crates/host-desktop/src/updater_policy.rs`. Fork releases, plus
  reinstall/downgrade and per-version selection.
- **User badges** - `src/components/UserBadges.tsx`, `src/components/badges/`,
  `src/domain/badges/customBadges.ts`, `src/state/customBadgeStore.ts`,
  Settings > Social > User Badges, and the user dialog's Badges submenu.
  Three badges are built in and always shown, never collapsed, hideable or
  configurable: fork developer (`FORK_DEVELOPER_USER_ID`), upstream developer
  (`UPSTREAM_DEVELOPER_USER_ID`) and VRChat Staff (`isVrchatStaff`, or membership of
  `VRCHAT_STAFF_GROUP_ID`). Global badges (below) follow them and are
  never collapsed either. Group membership comes from users' own group lists
  as the app loads them (`src/state/userGroupMembershipStore.ts`), never from
  extra requests, and outranks stored group member lists, which are often
  private or incomplete. Their icons
  (`CodeXml`, `Diamond`, plus every `AWARD_ICONS` entry, all in
  `RESERVED_BADGE_ICONS`, plus their families as checked in
  `isReservedBadgeIcon`: any icon with Code, Braces, Brackets or Shield in its
  name except QR codes, and any icon starting with an award icon's name,
  Diamond, Flask, TestTube or Sparkle, Lucide Lab ones included) stay
  reserved so custom badges cannot imitate them. The reserved list is fixed
  and separate from the icons global badges happen to use: an unreserved icon
  stays free for custom badges even when a global badge uses it. Keep the
  developer badge flashier than
  the upstream one. The developer badge's scan and glitch keyframes are
  generated from `scripts/devBadgeEffects.ts` (`npm run badges:dev-fx`, then
  `npm run format`): never hand-edit the block between its GENERATED markers in
  `src/styles/globals.css`, and keep at least a quarter second with no glitch
  on either side of each scan (the script and its test enforce both). Shape
  shows who sees a badge: custom badges, which only the user sees, are round;
  badges everyone sees (developer, staff, global) are rounded squares; the
  collapsed custom badge folder stays a rounded square. Custom badges may use
  any Lucide or Lucide Lab (`@lucide/lab`) icon; Lab icons are stored as
  `Lab` plus their name (`LabBurger`) so a saved badge never switches icon if
  Lucide later adds one with the same name. Custom badges are local, visible only to the user, stored
  in the `customUserBadges` config key and synced under the `badges` Settings
  Sync category; they stack after the built-in ones, including on the
  developer accounts. A user can have any number; when they would truncate the
  name they collapse (labels, then icons, then a folder tile) through
  `src/components/badges/badgeFit.ts`, never by wrapping. Badges make no
  requests of their own beyond the VRChat group member fetch the user starts,
  leave the PC only through Settings Sync when it is on, and nothing is for
  sale: selling badges or themes needs the maintainer's decision first
  (VRChat Terms of Service section 12 restricts commercial use). The
  maintainer's user dialog always uses the black, white and red palette
  (`.fork-maintainer-dialog` in `src/styles/globals.css`), whatever the
  viewer's theme; the upstream developer's dialog is a normal dialog.
- **Global badges** - `data/global-badges.jsonc` (the list),
  `src/domain/badges/globalBadges.ts` (icons, styles, animations, validator),
  `crates/integrations/src/global_badges.rs` (parse and signature check),
  `crates/runtime-host-desktop/src/global_badges.rs` (embedded copy, cache,
  6-hour refresh and the update check), `src/state/globalBadgeStore.ts` (the
  screen rereads the adopted list every minute; a local call, no network),
  `GlobalBadgeChip` in `src/components/UserBadges.tsx`,
  `.github/workflows/data-assets.yml`. Badges the maintainer gives by hand to
  people who helped the fork, seen by every user. Every release embeds the
  file; the app also downloads `global-badges.jsonc` and `.sig` from the
  `data-assets` release (never latest, never prerelease, and the Discord
  announcement skips it), signed with the updater key, and adopts a copy only
  if the signature checks out and its `revision` is higher. Never accept an
  unsigned or older list, and never send anything about the user with the
  download (`Policy::public`, no credentials). Badges show in file order
  (most prestigious first), then one-off awards (`"badge": "custom"`, which
  carry their own label and look; no badge type may use the id `custom`).
  Dates are epoch seconds. The file is public, so a VRChat user id goes in
  only with that person's consent. Animations touch only transform and
  opacity, list badges animate on hover only, and reduced motion stops them.
  A badge may use any Lucide or Lucide Lab icon; `npm run badges:validate`
  checks the name against the app's icon set. A badge's `"animation"` may combine effects separated by spaces
  (`"embers glow"`); each background effect draws on its own layer and each
  icon effect wraps the icon, so they never fight over one element. Apps from
  before combined effects show the default (`shimmer`) for a list, so the
  field stays a string. Edit with `npm run badges:editor` (`tools/badge-editor/`, a local Vite page
  on 127.0.0.1:9010 that saves the file keeping its comments; its Gallery view,
  also at `?view=gallery`, shows every badge and effect at both sizes), check
  with `npm run badges:validate`. The editor's live profile preview runs
  `crates/badge-editor-profile`, a developer-only binary that is not a default
  workspace member and is never shipped: it reads the installed app's saved
  VRChat session read-only, looks up one profile and prints it, and must never
  write to the app's data or reach any other endpoint.

- **Issue triage** - `.github/workflows/issue-triage.yml`,
  `scripts/issue-triage.ts`. Closes issues that are not in English, skip the
  issue forms, leave required answers empty, or ask for a badge without a real
  VRChat user id, and reopens them when the author fixes them. Language is
  judged offline from scripts and common words: never send issue text to a
  translation, AI or other outside service. The maintainer's, collaborators'
  and bots' issues, issues assigned to the maintainer, issues labeled
  `triage-ok`, and auto-closed issues reopened by hand are never touched.

## Things that look like bugs but are not

- Missing `keys.contains("telemetry")`-style guards in profile merge, and stale
  `vrcx_telemetry*` config keys being ignored, are deliberate: the fork has no
  upstream telemetry to carry across migrations. The fork's own adoption count
  uses `adoptionCensus*` names and is unrelated to those keys.
- The hand-maintained `navIconEntries` list in `src/shared/constants/navIcons.ts`
  and the component map in `src/components/layout/navIconRegistry.ts` must stay
  in sync. An icon present in only one of them silently renders as a generic
  circle. There is a test for this.
- The right side panel's tab layout only holds the friends and groups system
  tabs, favorite collections and pinned world rooms. Reminders, the mutual
  friends graph and Tools are left-navigation entries
  (`createBaseDefaultNavLayout` in `src/components/layout/navMenuModel.ts`), not
  side panel tabs, and must not be re-added to the panel.
- `RuntimeBackgroundJobs` tracks local job state for background loops. It
  transmits nothing.
- Shared world collections go to the fork's own service, never upstream's.
  Sharing a world favorite group (`remote_sync_share_collection` in
  `crates/runtime-host-desktop/src/state/remote_sync.rs`) posts a public
  snapshot to the configured RemoteSync API with the paired token, and only
  when the user asks. It sends world names, authors, descriptions, VRChat
  image links and, if ticked, the user's world memos; it never sends a VRChat
  user id or a hash of one. Upstream's owner tokens and the world registration
  that "Copy VRCX world URL" triggered stay removed. Upstream merges will try
  to point this back at `worlds.vrcx-0.dev`; keep it on RemoteSync.
- No vrcx-0.dev features. The app never creates or opens `open.vrcx-0.dev`
  links. Relay links for worlds, avatars and instances point at the
  configured RemoteSync website (`/open/...`), carry previews only in the URL
  fragment, and exist next to the plain VRChat link, which stays available.
  Community theme download counts and install reporting (`theme.vrcx-0.dev`)
  were removed; the theme catalog itself comes from GitHub.
- The VRChat realtime websocket (`BROWSER_WEBSOCKET_USER_AGENT` in
  `crates/vrchat-client/src/realtime.rs`) sends a browser user agent on
  purpose. Only that connection does; every other request, VRChat API
  included, uses the app user agent with the contact link. Do not change
  either direction.

## Ground rules

- **No developer telemetry beyond the adoption count.** This fork has no
  analytics, no crash reporting, no usage reporting, and no feedback upload. Do
  not add any, and do not "restore" something that looks like it. The one
  exception, added by the maintainer on purpose, is the anonymous adoption
  count described under "Feature areas"; do not remove it as telemetry, and do
  not add anything to what it sends. VRChat heartbeats, realtime/session events, auth
  refresh, and API polling are core functionality, not telemetry, and must never
  be removed on that basis. When a name is ambiguous, check the destination: if
  it talks to VRChat, GitHub, or a user-configured AI endpoint, keep it.
- **English only.** No bundled translations. `src/localization/en.json` is the
  only locale file. Do not add locale files.
- **Plain ASCII punctuation** in UI strings and docs. No em/en dashes, curly
  quotes, or emoji.
- **US English spelling** in UI strings, translation keys, docs and the fork's
  own code comments: color, canceled, canceling, gray, summarized, labeled.
  Upstream still uses some British forms, including in translation keys (the
  fork renamed `..._cancelled` keys to `..._canceled` and `cancelling` to
  `canceling`). When an upstream merge brings those back, keep the fork's US
  key names and update the merged code to them, or the strings show as raw
  keys. Code names that come from libraries (`is_cancelled()`) and VRChat's
  own data values stay as they are, and upstream code comments are left alone
  to keep merges small.
- **Single-brace placeholders** in `en.json`: `{count}`, not `{{count}}`.
  `i18nService` interpolates with `{`/`}`, so double braces show up as literal
  text. `src/localization/en.test.ts` guards this.
- **Smallest reasonable change.** Do not rearchitect adjacent code, upgrade
  unrelated dependencies, or reformat files you did not otherwise touch.
- Non-fork-specific fixes usually belong upstream. Say so rather than folding
  them in.

## Merging from upstream

When asked to "merge from upstream", "sync with upstream" or similar, merge
`upstream/master` (the `upstream` remote, Map1en/VRCX-0) into the fork. Do it
on a branch, never directly on `master`, and do not stage or commit anything
until the user asks; the user decides what goes into the merge commit.

1. `git fetch upstream`, then `git merge upstream/master` on the branch. Never
   rebase the fork onto upstream.
2. Resolve conflicts in favor of the fork invariants above and the rules in
   this file. Then check the files git merged on its own as well: several
   patterns below merge silently and are only visible by reading the result.
3. Run the full checks (see Commands), regenerate bindings if any command or
   `specta::Type` changed, and fix what the merge broke.
4. Update the docs (below).
5. Summarize for the user: what upstream added or changed, what was kept from
   the fork and why, what was dropped, and which docs changed.

Things upstream merges keep bringing back or breaking:

- **Identity**: names, ids, data folder, link scheme, update source, user
  agent, export id and RemoteSync origins stay the fork's (the table at the
  top). No upstream trackers, Discord or blog links, issue templates or
  telemetry.
- **Removed things stay removed**: upstream telemetry, translated locale files
  and translated READMEs, `vrcx-0.dev` services and links, community theme
  download counts, world registration for "Copy VRCX world URL".
- **Text**: English only, plain ASCII punctuation (convert new curly quotes and
  dashes in `en.json`), US spelling including translation keys, single-brace
  placeholders.
- **Dates**: the fork stores signed epoch seconds. Upstream tests, seeders and
  SQL often use ISO strings or `strftime` on what is an integer here; port them
  (see `docs/TIMESTAMPS.md`).
- **AI Assistant**: upstream calls it Social AI. Keep the fork's name and
  strings, the top-level nav entry, the client tools, and the approval gate:
  any new upstream tool that changes data or acts for the user must go into
  `EDIT_TOOLS` in `crates/assistant/src/client_tools.rs`, and new upstream
  settings the assistant should be able to change need a spec in
  `assistantSettingSpecs.ts`. Keep prompt rules (no emoji, "VRCX-0-Nanashi",
  local-calendar time) and add upstream's new facts.
- **MCP and reminders**: upstream builds the MCP runtime without the fork's
  `reminders` field; make sure the assistant still gets it.
- **Shared world collections and relay links** stay on RemoteSync.
- **Recorder**: keep the fork's install script, compose file, image, guide
  (`docs/RECORDER.md`), the Settings > Sync Options card, no beta channel,
  and the status bar icon hidden until a recorder is set up.
- **Process-global test state**: upstream tests that build a full runtime can
  race fork tests that seal secrets; keep the harness pre-initializing them.

### Updating the docs after a merge

Every merge that changes what users see needs the docs to match, because the
in-app Docs page and the AI Assistant answer from them:

- New or changed pages, dialogs, settings, notifications, tools, shortcuts or
  looks: update the matching file in `docs/` (`USER_GUIDE.md`, `PAGES.md`,
  `DIALOGS.md`, `LAYOUT_AND_APPEARANCE.md`, `NOTIFICATIONS_AND_VR.md`,
  `BADGES.md`, and the others there) to the same level of detail as the rest,
  written from the code and the app's own text, not from upstream's README.
- `docs/FEATURES.md` lists only what the fork does differently. If upstream
  now does something the fork added, remove or reword that entry; if the fork
  keeps a different behavior, say so there.
- Upstream README changes worth knowing (new highlights, platform notes) go
  into `docs/USER_GUIDE.md` or `docs/INSTALL.md` in the fork's words, without
  upstream's links.
- Keep the README's documentation table and `docs/` in step, and check every
  relative link still resolves.

## Commands

Frontend (Node):

```
npm run typecheck      # tsc for app + node configs
npm run lint           # oxlint, --deny-warnings
npm run format         # oxfmt (write); format:check to verify
npm test               # vitest run
npm run build          # vite build + license generation
```

Rust:

```
npm run rust:fmt             # cargo fmt --all
npm run rust:fmt:check
npm run rust:check -- <crate>
npm run rust:test -- <crate>
npm run rust:test:ci         # cargo test --workspace --exclude vrcx-0 --locked
npm run rust:clippy:ci       # clippy with -D warnings
```

Full check before submitting:

```
npm run rust:fmt:check && npm run format:check
npm run lint && npm run typecheck
npm run rust:test:ci && npm test
cargo test -p vrcx-0 --tests
```

The husky pre-commit hook (`.husky/pre-commit`) runs lint-staged, which applies
`npm run format` and `npm run rust:fmt` (`lint-staged.config.mjs`), and then
`scripts/stage-formatted-files.mjs`, which stages every modified and untracked
file, not only the ones you staged. Commit from a clean tree, or other work in
progress ends up in the commit.

`rust:test:ci` excludes the `vrcx-0` crate, but CI still runs that crate's unit
and integration tests (`src-tauri/tests/backend_architecture.rs`), and they run
headless with `cargo test -p vrcx-0 --tests`. Run them after adding or changing
a Tauri command: new commands must be `#[tauri::command(async)]` or async, or
the main-thread allowlist test fails.

## Dates and timezones

See `docs/TIMESTAMPS.md` before changing stored dates, date inputs, history grouping,
calendar queries, imports, or sync boundaries.

- App-owned stored absolute dates use signed `i64` Unix epoch seconds in UTC.
  Keep durations in their existing units. Persisted localStorage cooldowns use
  a versioned seconds payload so known legacy milliseconds are unambiguous.
  Internal animation and elapsed-time
  clocks may use milliseconds; convert explicitly at persistence boundaries.
- The versioned persistence migration converts existing ISO and millisecond
  dates, including dynamic per-user tables and known date-valued settings.
  Preserve row IDs and `event_discriminator` in game-log uniqueness, imports,
  exports and RemoteSync. Never discard same-second legacy collisions.
- Use the tolerant core/contracts timestamp helpers for old JSON and imports.
  Keep external API formats and signed protocol bytes at their boundaries.
  The shared RemoteSync protocol stays pinned to an exact Git revision; a wire
  version upgrade requires a coordinated published protocol and desktop change.
- `dtTimeZone` is device-specific and must never enter Settings Sync. Blank or
  `system` follows the OS; IANA names and fixed UTC offsets are supported.
  Rust uses `core::time` display helpers; frontend code uses
  `shared/utils/displayTimeZone`. Pass a `Date` when a value is explicitly
  milliseconds, or multiply canonical seconds by 1000 before `new Date`.
- Calendar grouping, filters and date inputs use the display timezone and
  calendar arithmetic across DST. Subscribe to `dtTimeZone` in memoized views
  so changing the setting updates existing groups.
- For VRChat recurring group events, preserve an existing series timezone.
  New series use the configured IANA zone, or the system IANA zone when the
  display setting is a fixed offset. Recurrence end dates are wall-clock
  values in that series timezone, not stored absolute app dates.
- Cover legacy conversion, repeat imports, same-second collisions and
  non-system timezone/DST boundaries when changing these paths. Generated
  Tauri bindings still come from `npm run generate:tauri-bindings`.

## Bindings

`src/platform/tauri/bindings.ts` is generated. Never hand-edit it.

```
npm run generate:tauri-bindings
```

Regenerate after adding, removing, or changing any `#[tauri::command]` or any
`specta::Type` reachable from one. Specta only emits types reachable from the
command surface, so deleting the last command that used a type silently drops it
from the generated file and breaks the frontend at type-check time. If that
happens, re-export the type explicitly with `.typ::<T>()` in
`src-tauri/src/bindings_export.rs`.

Note that `bindings.ts` is large; avoid reading it wholesale. Grep for the
symbol you need.

## Architecture

Dependency direction is roughly inward, and should stay that way:

```
src-tauri  ->  composition  ->  application*  ->  application-core
                                              ->  contracts
                    outbound-adapters / persistence / integrations / vrchat-client
```

- `crates/contracts` - shared value types and ports. No I/O.
- `crates/application-core` - process-wide state, event bus, task supervisor,
  background jobs.
- `crates/application`, `application-realtime`, `application-game`,
  `application-activity` - use cases by domain.
- `crates/outbound-adapters` - everything that talks to the network or disk.
- `crates/composition` - wires the above together into a runtime.
- `crates/runtime-host-desktop` - the host-specific runtime facade the Tauri
  commands call.
- `src-tauri/src/commands` - thin Tauri command wrappers. Keep them thin;
  logic belongs in the application crates.
- `crates/overlay-runtime`, `crates/host-desktop` - VR overlay.
- `crates/i18n` - Rust-side message lookup.

State crosses the Tauri boundary as snapshots and events over a local event
bus, not as shared mutable handles. The frontend subscribes in
`src/services/runtimeEventBridgeService.ts`.

Many crates use nested module folders where each file is a sibling
(`foo.rs` plus `foo/`). Keep that convention when adding modules.

## Tests

- Rust tests live beside the code in `#[cfg(test)] mod tests`; integration
  tests go in `crates/<crate>/tests/`.
- Frontend tests are `*.test.ts` / `*.test.tsx` beside the source.
- `src/test/setup.ts` runs before every test file. It stubs `react-i18next` so
  `t()` returns the key, and defines an in-memory `localStorage` for the node
  environment. Several stores read `localStorage` at module scope, so if the
  node environment does not have it, ~65 test files fail at import with
  `Cannot read properties of undefined (reading 'getItem')`. This is wired
  through `setupFiles` in `vitest.config.mts`; removing that key breaks the
  suite in exactly that way.
- Assert real behavior. Do not write assertions that only exercise mocks, and
  do not relax an assertion to make a test pass. If a test disagrees with
  intended behavior, find out which one is wrong and say which.
- When you change a default or a normalization, update the tests that pin the
  old value. Those failures are usually correct signals, not noise.

## Conventions

- Rust: `cargo fmt` defaults, `clippy -D warnings`. Prefer existing helpers over
  new abstractions.
- TypeScript: run `npm run format` before committing; oxfmt is opinionated.
- Commits follow Conventional Commits, e.g.
  `fix(overlay): restart the wrist menu timer on every press`. Many are scoped
  by crate or subsystem. The format:
    - Subject: `type(scope): summary`, imperative and lower case, no full stop,
      about 72 characters at most. Types in use: `feat`, `fix`, `docs`, `test`,
      `ci`, `chore`, `refactor`. Leave the scope out only when no single
      subsystem fits.
    - Body, after a blank line, only when the subject does not say enough:
      explain what changed and why in plain sentences wrapped at 72 columns. A
      commit that spans several areas groups its points under short headings
      (`Global badges`, `Tooling`, `Dependencies`) as `- ` bullets.
    - Name dependency changes with their versions (`Update rmcp to 3.9.0`), and
      say when a commit changes what users see, such as a new
      `data/global-badges.jsonc` revision.
    - Plain ASCII, like the rest of the repository. No `Co-Authored-By`
      trailers or other AI or tool attribution, and no "Generated with" lines
      in pull request descriptions.
- Comments should explain why, not what. Do not add comments that were not asked
  for.

## Environment notes

- Linux: avoid native GTK/WebKit theme changes; they have caused crashes. Do not
  reintroduce live OS-theme switching.
- Linux: the View Transitions API crashes the whole app on WebKitGTK when the
  DMABUF renderer is off, which is the Linux default (compatibility mode). The
  titlebar theme toggle uses `animation="overlay"` on Linux (an ordinary
  element animation that looks the same) unless hardware rendering is on
  (`useLinuxHardwareRendering`); never call `document.startViewTransition`
  in compatibility mode. Menus and other popups are opaque with
  no backdrop blur, because the blur does not reliably render in that mode.
- `README.md` is a short index; every other doc lives in `docs/`
  (`USER_GUIDE.md`, `FEATURES.md`, `TELEMETRY.md`, `INSTALL.md`, `BUILDING.md`,
  `TIMESTAMPS.md`, `RECORDER.md`). `CONTRIBUTING.md` and `SECURITY.md` stay in
  the root, where GitHub looks for them.
  `crates/logger/README.md` only points to `docs/RECORDER.md`, because released
  builds link to that path. `USER_GUIDE.md` describes the whole app, upstream
  features included, and the AI Assistant answers from the docs. Keep them
  accurate when behavior changes, and keep the README table in step when a
  doc is added or renamed.
