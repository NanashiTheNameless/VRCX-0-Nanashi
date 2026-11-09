# Integrations

Settings > Integrations connects VRCX-0-Nanashi to other services and apps. Every integration
is off until you turn it on.

## Discord Presence

Shows what you are doing in VRChat as your Discord status. Turn off VRChat's own Rich Presence
to avoid the two fighting (VRChat Config can do that for you). Options:

- **Show Now Playing**: show the video playing in the world and its progress. Works in Popcorn
  Palace, PyPyDance, VRDancing and LS Media, and in worlds whose video player supports ProTV's
  now-playing information.
- **Instance Type & Player Count**.
- **Show Current Platform**.
- **Show Details in Private Instances** (off keeps private instances private).
- **Join Button**, shown only in public instances.
- **Show World Images**.
- **Use World Name as Activity**.

The app sends your status again every minute even when nothing changed, so it comes back on its
own if Discord restarts or misses an update.

## Content Translation

Translates user bios and world descriptions when you ask (the **Translate** button in a user or
world dialog), and messages in the Chatbox tool. Providers: Google, DeepL, or an
OpenAI-compatible AI connection (see [AI_ASSISTANT.md](AI_ASSISTANT.md)) with an optional
system prompt that must include `{targetLang}`. The text you translate is sent to that
provider.

## YouTube API

With your own YouTube API key, the app looks up video titles for the Game Log and video lengths
for the overlay progress bar.

## Remote Avatar Database

VRChat has no avatar search, so avatar search uses providers you add here (Search > Avatar).
Your search text is sent to the provider. A link can offer to add a provider; the app asks you
first.

## Integration API

Shares selected live information with apps you trust over a token-protected WebSocket on this
PC (port 8799 by default), only while VRChat runs. Today it shares the current instance, the
player list, language tags and notes. **Allow LAN connections** lets other devices on your
network read it; keep it off on untrusted networks. The token gives access to whatever is
shared, so give it only to software you trust.

## MCP server

Under Settings > AI. Lets external AI tools read your local data. See
[AI_ASSISTANT.md](AI_ASSISTANT.md#mcp-server).

## Webhooks

Under Settings > Notifications. See [NOTIFICATIONS_AND_VR.md](NOTIFICATIONS_AND_VR.md#webhooks).

## History Sync and the Self-hosted Recorder

Under Settings > Sync Options. See [FEATURES.md](FEATURES.md) and [RECORDER.md](RECORDER.md).
