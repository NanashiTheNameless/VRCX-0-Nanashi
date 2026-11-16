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
**LLM endpoint** from your [AI connections](AI_ASSISTANT.md#ai-connections). The text you
translate is sent to that provider.

LLM translation follows the **default model** in Settings > AI unless you pick a model
specifically for translation. The model picker lists the models selected in AI Connections;
**Default model** switches back to following the AI setting. If no default is set, choose
one there or pick a translation model before testing or saving. An assigned model stays
assigned when its connection is deleted; the dialog warns you to pick another. Removing a
model from a connection's selected list also shows a warning, but keeps the saved assignment.

You can set a reasoning effort when the selected model supports it, and an optional system
prompt that must include `{targetLang}`. **Test** tries the current draft without saving it;
**Save** stores it.

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

Turn it on under Settings > Integrations > Integration API, where the access token is shown.

### Connecting

Every request needs the access token, sent as an `Authorization: Bearer <token>` header.
Browsers cannot set that header on a WebSocket, so they can instead request the subprotocols
`vrcx0.integration.v1` and `vrcx0.integration.token.<token>`.

| Endpoint                              | Description                             |
| ------------------------------------- | --------------------------------------- |
| `GET http://127.0.0.1:8799/v1/health` | Returns `{ "ok": true, "protocol": 1 }` |
| `ws://127.0.0.1:8799/v1/stream`       | The event stream                        |

### Messages

All messages are JSON with a `type` field. Every message except `bye` carries an increasing
`seq`, and timestamps are ISO 8601 in UTC.

| `type`          | When                                                                                                 | Content                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `hello`         | Right after connecting                                                                               | `protocol`, `app`, `appVersion`, `scopes`, `heartbeatSec`                                                                 |
| `room.snapshot` | After `hello`, when you change instance, and whenever the stream resyncs; replaces all earlier state | `room`: `location`, `worldId`, `worldName`, `destination`, `enteredAt`, `members`; `null` when you are not in an instance |
| `room.joined`   | Players join                                                                                         | `members`                                                                                                                 |
| `room.left`     | Players leave                                                                                        | `userIds`                                                                                                                 |
| `ping`          | Every `heartbeatSec` seconds (20)                                                                    | none                                                                                                                      |
| `bye`           | VRChat closed or the API was turned off                                                              | `reason`: `gameStopped` or `disabled`                                                                                     |

Each member has `userId`, `displayName`, `isSelf`, `isFriend`, `joinedAt`, `languages` and
`note`. Send `{ "type": "resync" }` at any time to receive a fresh `room.snapshot`.

## VRCX IPC

Settings > Integrations > VRCX IPC. Off by default. Programs made for VRCX can talk to
VRCX-0-Nanashi over the same local pipe VRCX uses, so they work without changes:

- **Custom tags**: a program can tag a user, or clear all tags. Each tag shows exactly like
  one of your custom badges (see [BADGES.md](BADGES.md#tags-from-vrcx-programs)), everywhere
  user names appear, in VR and on the Desktop Overlay. Tags are kept in memory only and
  disappear when the app closes or the pipe is turned off, like in VRCX.
- **Game Log entries**: a program can add an event line, or an entry attributed to a user, to
  the Game Log, with the usual notification. An entry sent with `notify` set to `false` is saved
  without a notification, like in VRCX. Entries are only added while you are signed in.
- **Launch commands**: a program can open a world, instance, user, avatar or group, using the
  same paths as `vrcx://` links (for example `world/wrld_...`).
- **What the app sends**: connected programs are told when the pipe starts
  (`VRCXLaunch`) and which user's dialog you open (`ShowUserDialog` with the user ID), as VRCX
  does. Nothing is sent while the pipe is off.

Any program on this computer that can open the pipe can use it, so turn it on only if you use
such a program. Photon event logging from VRChat mods is not supported.

The pipe uses VRCX's name, `vrcx-ipc-` followed by a number made from your user name, and VRCX's
packet format (JSON objects ending with a NUL character). **Pipe name** changes the name; leave
it empty for VRCX's. On Linux and macOS the pipe is a Unix socket, by default where .NET programs
look for it (`CoreFxPipe_<pipe name>` in the temporary folder, readable only by you); **Socket
path** chooses another place. VRCX and VRCX-0-Nanashi cannot use the same pipe at the same time;
the status shows an error if another program already has it.

These settings stay on this PC and are not included in Settings Sync.

## Persistent World Info

Settings > Integrations > Persistent World Info. Off by default. Worlds made for VRCX can save
values, such as progress or scores, by writing `[VRCX-World]` lines to VRChat's log, and read
them back over HTTP from a server on this computer. VRCX dropped this feature; VRCX-0-Nanashi
brings it back with the same requests and answers, so those worlds work again.

- The server listens only on `127.0.0.1`, port **22500** by default (VRCX's), and answers only
  requests addressed to `127.0.0.1` or `localhost`. Change the port only if a world asks for a
  different one.
- VRChat lets a world reach the server only when **Allow Untrusted URLs** is on in VRChat's
  settings.
- Each world gets its own key and can save up to 10 MB. A world can let other worlds read its
  data.
- Nothing is saved while the feature is off. Values are kept in `VRCX-0-Nanashi-WorldData.db`
  in the data folder, in VRCX's format: VRCX's `VRCX-WorldData.db` can be copied over under that
  name.
- **Stored data** > **View** lists the worlds that saved something and their values. **Forget
  this world** deletes its values and its key.
- **Import world data** adds what worlds saved in VRCX: **Import from VRCX** reads VRCX's
  `VRCX-WorldData.db` from VRCX's data folder, and **Choose file** reads any such file. Worlds
  keep their keys, values already saved here are kept, and the 10 MB cap still applies. The
  other file is only read. Importing works whether or not the feature is on.

Endpoints (all `GET`, answering VRCX's `{ ok, error, data, statusCode, connectionKey }`):
`/vrcx/data/init`, `/vrcx/data/get?key=`, `/vrcx/data/getall`, `/vrcx/data/getbulk?keys=`,
`/vrcx/data/lasterror`, `/vrcx/data/settings?set=externalReads&value=` and `/vrcx/status`. `get`,
`getall` and `getbulk` take `world=` to read another world that allows it.

## MCP server

Under Settings > AI. Lets external AI tools read your local data. See
[AI_ASSISTANT.md](AI_ASSISTANT.md#mcp-server).

## Webhooks

Under Settings > Notifications. See [NOTIFICATIONS_AND_VR.md](NOTIFICATIONS_AND_VR.md#webhooks).

## History Sync and the Self-hosted Recorder

Under Settings > Sync Options. See [FEATURES.md](FEATURES.md) and [RECORDER.md](RECORDER.md).
