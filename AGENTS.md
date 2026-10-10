# AGENTS.md

Guidance for coding agents working in this repository.

## What this repo is

VRCX-0-Nanashi is a personal fork of [Map1en/VRCX-0](https://github.com/Map1en/VRCX-0),
a VRChat client. It is a Tauri app: a React frontend in `src/` and a Rust backend
split across many crates in `crates/`, wired together by `src-tauri/`.

The fork is maintained by one person. Read `CONTRIBUTING.md` before proposing
changes, and treat it as authoritative where this file is silent.

The React frontend lives in `src/features/<domain>/`. The Rust backend is a Cargo
workspace of 29 crates under `crates/`, plus `src-tauri` (30 members total).

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
| User agent           | `NanashiTheNameless/VRCX-0-Nanashi`                                                        | `crates/core/src/user_agent.rs`                                                                       |
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

`README.md` is the user-facing list. The parts most likely to be damaged by an
unrelated edit, with where they live:

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
- **Social AI** - `crates/assistant/`, `src/features/assistant/`. Off by default;
  nothing may be sent anywhere while disabled. OpenAI-compatible (Chat
  Completions and Responses), Azure OpenAI, Anthropic, Gemini, Vertex AI,
  Ollama, Cohere and Bedrock paths all exist (`LlmApiKind` in
  `crates/contracts/src/llm.rs`).
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
  two helpers it needs in shared crates sit behind the `collector` cargo
  feature of `vrcx-0-composition` and `vrcx-0-persistence`, which nothing
  else may enable. Do not add collector UI, commands, or settings to the app.
  It must stay read-only (no command reaches VRChat), take the session only
  from the inherited descriptor, refuse any data directory that is not
  tmpfs, and never print or store what the runtime reports.
- **yt-dlp / media** - `crates/ytdlp/`, `YTDLP_SETUP.md`. Cookie use is opt-in
  and backs up originals.
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

## Things that look like bugs but are not

- Missing `keys.contains("telemetry")`-style guards in profile merge, and stale
  `vrcx_telemetry*` config keys being ignored, are deliberate: the fork has no
  telemetry to carry across migrations.
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

## Ground rules

- **No developer telemetry.** This fork has no analytics, no crash reporting, no
  usage reporting, and no feedback upload. Do not add any, and do not "restore"
  something that looks like it. VRChat heartbeats, realtime/session events, auth
  refresh, and API polling are core functionality, not telemetry, and must never
  be removed on that basis. When a name is ambiguous, check the destination: if
  it talks to VRChat, GitHub, or a user-configured AI endpoint, keep it.
- **English only.** No bundled translations. `src/localization/en.json` is the
  only locale file. Do not add locale files.
- **Plain ASCII punctuation** in UI strings and docs. No em/en dashes, curly
  quotes, or emoji.
- **Smallest reasonable change.** Do not rearchitect adjacent code, upgrade
  unrelated dependencies, or reformat files you did not otherwise touch.
- Non-fork-specific fixes usually belong upstream. Say so rather than folding
  them in.

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
  by crate or subsystem.
- Comments should explain why, not what. Do not add comments that were not asked
  for.

## Environment notes

- Linux: avoid native GTK/WebKit theme changes; they have caused crashes. Do not
  reintroduce live OS-theme switching.
- `README.md` documents fork features. Keep it accurate when behavior changes.
