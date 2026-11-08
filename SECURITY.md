# Security policy

## Reporting a problem

Please report security problems privately, never in a public issue, pull request or chat:

- Use GitHub's private reporting:
  [report a vulnerability](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/security/advisories/new).

Include what you found, how to reproduce it, which version you tested (Settings > About) and
what someone could do with it. Please write in English.

This fork is maintained by one person, so there is no fixed response time, but security
reports come first. Give the fix a reasonable time to ship in a nightly build before telling
anyone else.

If you would like the **Security Reporter** badge once it is fixed, add your VRChat user ID
(`usr_...`) to the report. The badge list is public, so adding it means you agree to your ID
being listed.

## What is in scope

This fork's own code and releases: the desktop app, the updater, History Sync (RemoteSync)
in the app, the global badges list and its signature check, and the build and release
workflows.

Problems in upstream VRCX-0 code that this fork has not changed belong upstream:
[Map1en/VRCX-0](https://github.com/Map1en/VRCX-0). Problems in VRChat itself go to VRChat.

## Supported versions

Only the latest nightly build
([Nightly-Rolling](https://github.com/NanashiTheNameless/VRCX-0-Nanashi/releases/tag/Nightly-Rolling))
gets fixes. Update before reporting.
