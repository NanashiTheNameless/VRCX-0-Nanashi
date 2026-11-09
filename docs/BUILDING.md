# Building from source

Requirements: Node.js >= 24.15, npm >= 11.5, and a stable Rust toolchain via rustup
(rustc >= 1.95). On Windows, also install **Visual Studio Build Tools** with the
**Desktop development with C++** workload. On Linux, install the WebKitGTK 4.1
development packages, for example on Debian/Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev \
  librsvg2-dev libayatana-appindicator3-dev libasound2-dev
```

Linux CI and AppImage builds use the maintained WebKitGTK and JavaScriptCore
packages from Ubuntu 24.04, including its security updates. The `4.1` in the
package names is the API version, not the WebKit engine version. macOS uses the
system WebKit, updated with macOS and Safari; Windows uses WebView2.

Linux AppImage packaging also requires `gstreamer1.0-plugins-base` and
`gstreamer1.0-plugins-good` on the build system. The Linux bundle configuration
enables `bundleMediaFramework` to include the media plugins and plugin scanner.
The AppImage smoke test checks for these files, including the plugin that provides
`appsink`.

```bash
git clone https://github.com/NanashiTheNameless/VRCX-0-Nanashi
cd VRCX-0-Nanashi

npm install
```

Start the dev server:

```bash
npm run tauri:dev
```

Build for release (skip code signing and installer):

```bash
npm run tauri:build -- --no-sign --no-bundle
```

Both cleanup commands use `scripts/clean.mjs`:

- `npm run clean:caches` clears this checkout's Rust build cache (`target/` and
  `src-tauri/target/`), Vite and tool caches, and TypeScript build metadata.
- `npm run clean` also removes frontend output (`dist/`, `build/` and the badge editor's
  `dist/`), generated Tauri files (`src-tauri/gen/` and the generated third-party notice),
  coverage reports (`coverage/` and `.nyc_output/`), and Python bytecode in `scripts/`.
  Rust binaries, installers, bundles and their signatures are removed with the target
  directories.

Use `npm run clean:dry-run` or `npm run clean:caches:dry-run` to preview the corresponding
cleanup without removing anything. Appending `-- --dry-run` to either cleanup command
also works.
Both commands report each cleaned path, file and directory counts, and estimated space
reclaimed, followed by totals and counts of missing, skipped and failed paths. Dry runs
report what would be removed and estimated space to reclaim. Space uses allocated disk
blocks when the filesystem reports them, otherwise file sizes; hard-linked file data
counts once and only when all its links are included in successful cleanup paths.
Symlinks inside directories are counted without following their targets. Failed paths
are excluded from totals, and a cleanup failure makes the command exit with an error.
Append `-- --frontend-only` to keep compiled Rust artifacts. For example:

```bash
npm run clean:dry-run
npm run clean:caches:dry-run
npm run clean:caches -- --frontend-only
```

Installed dependencies, shared npm and Cargo download caches, app data, signing
credentials, and tracked generated source files such as the Tauri bindings are kept.
Symlink paths are skipped. Custom Cargo target directories are kept unless they use
the checkout's standard `target/` or `src-tauri/target/` paths. Rust dependencies need
recompiling after clearing the target directories.

Normal `tauri:build`, Preview and Dev Kit builds use the configured NamelessNanashi
signing identity. Windows signs the executable and installer with Authenticode; macOS
signs the app before packaging; all platforms add `.nn-signature` download
signatures. Existing Tauri updater keys remain separate. Contributors without
the kit can still build unsigned, and `--no-sign` explicitly skips app signing.

Native signing needs Homebrew `openssl@3` on macOS, and OpenSSL plus Windows SDK
SignTool on Windows. `NN_SIGNING_OPENSSL` can select another compatible OpenSSL.
On a local Mac, import `signing/identity.cert.pem` into Keychain Access and trust it for
Code Signing first. Builds use a temporary private keychain; hosted macOS release
jobs also install and remove temporary trust for this certificate. Private keys
are read from the kit or Actions secrets and never stored in the repository.

Nightly, Preview and Dev Kit packaging requires `NN_SIGNING_KEY_PEM_BASE64`,
`NN_SIGNING_MACOS_P12_BASE64` and `NN_SIGNING_PASSWORD` repository secrets. The
macOS package is exported and verified during secret setup, then imported directly
by the runner. To upload them from the local kit with
an authenticated GitHub CLI:

```bash
npm run signing:secrets
```

This command updates Actions secrets in `NanashiTheNameless/VRCX-0-Nanashi` and
does not push code. Local signing and verification of finished downloads use
`npm run signing:sign -- <file>` and `npm run signing:verify -- <file>`.

The RemoteSync collector is a separate server-side program for people who run a RemoteSync
server. It is not part of the desktop app and regular users never need it. Build it on Linux
x86_64 with:

```bash
cargo build --locked --release -p vrcx-0-nanashi-collector
```

It only runs when started by the RemoteSync collector supervisor: it takes a VRChat session
over an inherited descriptor, records to a tmpfs directory, and has no way to send invites,
messages, or any other action.

The Self-hosted Recorder is also a separate program and is not bundled into the desktop app.
Nightly builds produce static binaries; to build one yourself on Linux:

```bash
rustup target add x86_64-unknown-linux-musl
sudo apt install musl-tools
cargo build --locked --release -p vrcx-0-logger --target x86_64-unknown-linux-musl
```

Release builds run `scripts/smoke-appimage.py` against the packaged AppImage before
uploading it. The check covers renaming, repeat launches, autostart arguments, and
the paths used for updates and relaunching without opening the app interface.

CI caches compiled Rust dependencies separately for desktop builds and workspace
tests. Desktop builds populate the cache on master; Clippy and binding generation
reuse it without saving duplicate caches. Pull requests restore the master caches
without saving their own. Linux desktop checks and package builds use mold to
reduce linking time; local builds can also use it after installing `mold`:

```bash
mold -run npm run tauri:build -- --no-sign --no-bundle
```

[Back to the README](../README.md)
