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

[Back to the README](README.md)
