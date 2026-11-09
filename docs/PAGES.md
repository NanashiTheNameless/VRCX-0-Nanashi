# Pages

Every page in the left navigation, what it shows and what you can do there. Most lists have
a search box, filters, a date range where it makes sense, and keep loading older entries as
you scroll. Clicking a person, world, avatar or group opens its dialog; see
[DIALOGS.md](DIALOGS.md).

## Feed

A live and recorded stream of what your friends do. Entries are recorded while the app runs
(and filled in by History Sync or the Self-hosted Recorder if you use one).

**Entry types**, which you can filter by:

- **Location**: a friend moved to another world or instance. The entry shows the new location,
  the previous one, and how long they stayed.
- **Online** and **Offline**: a friend came online or went offline. Offline entries show how
  long they were online.
- **Status**: a friend changed their status (Join Me, Online, Ask Me, Do Not Disturb) or
  status text. Saving these entries requires **Record status history** under Settings >
  Social > Profile History (off by default).
- **Avatar**: a friend changed avatar. The entry shows the previous avatar.
- **Bio**: a friend changed their bio. Saving these entries requires **Record bio history**
  under Settings > Social > Profile History (off by default). **Keep friend bios up to date**
  under Friend bios periodically checks profiles for changes.

**Two views:**

- **Table**: one list with every entry. Expand an entry for details.
- **Columns**: several side-by-side columns, each with its own title, friends (all friends, all
  or selected favorite groups, optionally excluding some) and entry types. The preset columns
  are Favorites, Location, Profile and Presence; **Restore preset** brings them back. Columns
  can be compact or dense, and you can drag a column's right edge to change its width.

**Searching**: type a friend's name to filter to that friend, or search the whole feed for the
text. **Favorites only** limits the feed to favorite friends.

**Right-click an entry** to hide a friend's location changes from the Feed, or hide the friend
from the Feed entirely. Hidden friends are listed under Settings > Social > Friends hidden from
the feed, where you can also hide them from notifications.

From an entry you can join the location in VRChat, invite the friend to your instance, request
an invite, or send a boop.

A small icon shows when Feed history is not being saved (Settings > Advanced > Storage &
cleanup > Save Feed history).

## Friend Locations

Where your online friends are right now.

- **Friends view** groups friends into sections: **Favorite Friends**, **Same instance** (friends
  in your instance), **Online**, **Other platform** (online on the website or app, not in the
  game) and **Offline**. Options can also show same-instance and favorite friends under Online.
  You can split favorites by favorite group.
- **Worlds view** groups friends by world and instance, with how many instances of each world
  your friends are in, and the player count of each instance (and its capacity when known).
- Density can be standard, compact or dense. A search box finds friends by name.

## Game Log

What happened in the instances you were in, read from VRChat's own log while the game runs.

- **Event types**: Location (you joined an instance), Player joined, Player left, Portal spawn,
  Video play, Event, External (messages a world writes to VRChat's log for VRCX-style apps), String
  load and Image load (worlds loading text or images from the web).
- **Sessions view** groups entries by visit: the world, when you were there, which friends and
  how many players were there, and which videos played and who played them. When a session's
  video list is too long to fit, **Show all** expands it and **Show less** shrinks it back.
  Expand a session for every event. A session marked **Other device** was recorded from your online status
  while VRChat was not running on this PC, so it has no player or video details.
- **Table view** lists every entry. Right-click to open a logged link, copy the detail, show the
  instance's history or delete the entry.
- Game log recording can be turned off under Settings > Advanced > Storage & cleanup. To fill in
  times the app was closed, import VRChat's own logs under Settings > Advanced > Import &
  recovery.

The [safety watchlists](FEATURES.md) also mark suspicious links and known players here.

## Instance History

The instances you, or a user you pick, have been in.

- **Search** mode lists instances by date range, for you or for a selected user.
- **Day** mode shows one day at a time, with an activity chart of online time you can expand.
  Its settings let you change the bar width and show or hide solo instances and instances
  without friends.

## Current Players

Everyone in your current instance, rebuilt from the game log. It needs the game log to be
recording and VRChat to be running.

- Badges show the **Instance Master**, **VRChat Team** members, favorites, people you muted, and
  people with avatar interaction disabled, chatbox muted or a timeout, and **Age verified**.
- Tabs filter All, Friends, Favorites and Restricted players. Search covers names, notes and
  user IDs.
- The world header is compact: the world's image, name, release status (shown as an icon) and
  instance details. Platform sizes and cache status are no longer shown here; open the world
  dialog for those.
- **Group roles** (shield button in the toolbar) shows each player's roles in a group. It is off
  until you turn it on; then pick the group (the instance's group is picked automatically for
  group instances).
- **Check mutual friends** (icon button in the toolbar) shows how many players share friends
  with you and which friend communities they mostly come from (it uses the Mutual Friend
  Graph's data).

## Search

Search VRChat by:

- **User**, optionally sorted by last sign-in.
- **World**, by name or by category, optionally including Community Labs.
- **Avatar**, through the avatar search provider set under Settings > Integrations > Remote
  Avatar Database (VRChat itself has no avatar search). Type at least 3 characters; filter
  public, private or all, and sort by name.
- **Group**.
- **Explore** shows popular and newly discovered worlds with their instance counts, and can
  shuffle them.

## View history

The users, worlds, avatars and groups you opened recently, with search and a date range.
Entries older than the retention time (Settings > Advanced > Storage & cleanup > View history
retention) are deleted automatically, and you can clear the list.

## Favorites

The **Favorites** folder holds four pages.

- **Favorite Friends**, **Favorite Worlds** and **Favorite Avatars** show your VRChat favorites
  (in VRChat's own favorite groups) and your **local favorites**, which live only in the app and
  have no size limit. Local groups can be created, renamed and deleted.
- You can select several favorites to move or copy them to another group, copy their IDs,
  unfavorite them in bulk, export them to CSV, or import favorites. VRChat favorites can only be
  moved between VRChat groups.
- Sort by date, by player count (worlds) or by your own order; **Edit order** lets you drag
  cards. VRChat favorite groups can be renamed and set to public, friends or private.
- Worlds can be searched by name or tag. Avatars have a **Local History** of avatars you wore,
  and avatar styles; avatars that look like possible nuisances are flagged.
- A world favorite group can be **shared** as a public page on the RemoteSync website, optionally
  listed in its public directory and with your world notes as comments. This needs a paired
  RemoteSync account. See [FEATURES.md](FEATURES.md).
- **Saved Groups** keeps VRChat groups you use often in local collections, and can notify you
  when a saved group opens a new instance.

## Social

The **Social** folder holds four pages.

### Friend History

Changes to your friends list: **New friend**, **Friend removed**, **Friend request**, **Friend
request canceled**, **Display name** changes and **Trust level** changes. Filter by type, search,
and set a date range. Unfriend events can be hidden (Settings > Social > Friend History).

### Friends

Open **Social > Friends** in the default left navigation. Your full friends list appears as
a table. Search by display name, username, rank, status, VRChat note, local note or bio and
links; filter to favorites.

The **Refresh all friend profiles** button is in the toolbar above the friends table,
immediately after **Load friend details**. **Load friend details** fills in missing
full profiles. The same **Refresh all friend profiles** button is also in the bottom-right
sidebar settings popover, beside **Refresh friends list**. Both full-profile buttons ask
you to confirm that the refresh can take a while, should be allowed to finish once started,
and has a 5-minute cooldown after finishing or being canceled.
**Refresh all friend profiles** fetches every friend's profile again, including
already loaded or cached profiles and friends outside the current search and filters.
It updates profile data, including bio, pronouns, status, and badge-related fields. Profiles
load one at a time, with at least 2 seconds between requests. A rate-limit response pauses
the job for at least 60 seconds, doubling the backoff on repeated limits and honoring longer
server-provided waits. Persistent rate limiting stops the refresh rather than continuing
through the remaining friends. Other VRChat reads share the server's wait, including after
cancellation or restarting a refresh. Actions report a rate limit instead of waiting to
execute much later; retry them after the wait.
Progress appears in a dialog that can be
minimized or canceled; only one profile loading or refresh job runs at a time. A 5-minute
cooldown follows completion or cancellation of a full refresh, with a countdown on the
button. It applies per account and VRChat endpoint and stays active when you leave and
return to the page. **Load friend details** remains available during the cooldown.
Profile history recording still follows your per-field choices.
**Refresh friends list** in the sidebar's settings updates the friends list, online/offline
presence and favorites. Use **Refresh all friend profiles** to update every friend's full
profile details.
**Load Mutual Friends** and a mutual-graph refresh fetch mutual relationships, not full
profile details, bios or pronouns. **Bulk Unfriend
Mode** lets you select several friends and unfriend them at once.

### Moderation

Your history of player moderation: blocks, mutes, interaction on and off, and chat mutes, with
type filters and search.

### Reminders

Reminders fire as normal notifications (desktop, VR, sound) even with the AI Assistant closed.
A reminder can be for a friend coming online, going offline, moving, or joining you, or for a
time. Create them by hand, describe one in plain words for the AI to fill in the form (when the
AI Assistant is set up), or ask the assistant in a chat. See [AI_ASSISTANT.md](AI_ASSISTANT.md).

## AI Assistant

Opens the assistant chat, or its settings while it is off. See
[AI_ASSISTANT.md](AI_ASSISTANT.md).

## Notifications

Your VRChat notifications in one place, grouped by **Social**, **Groups**, **Moderation** and
**Other**, with unread, new-this-session, expired and "All caught up" states. Notifications from
the same person are grouped together.

Types include invites and invite requests and their responses, friend requests, messages, boops,
group announcements, updates, invites, join requests, transfers, queue-ready alerts, group events
and posts, moderation warnings and notices, instance closed, badges earned, VRC+ and economy
gifts, avatar review results, and app (System) notifications.

Depending on the type you can accept, decline (optionally with a message), invite, send a boop,
mark as read, ignore locally or delete. Settings > Notifications > In-App Indicators >
Notification View switches this page to a table layout.

## My Avatars

Your uploaded and purchased avatars, as a grid (standard, compact or dense) or a table. Filter
by visibility and platform, sort, and search. You can wear an avatar by clicking it, make it
public or private, change its image, set its primary and secondary style and author tags, add
your own local tags, and see the local test avatars you built with Build & Test in the VRChat
SDK.

## Activity

Where your time went over a period (last N days, all time, or a custom range, with previous and
next buttons).

- **Overview** shows total time, daily average, days played and longest session, each compared
  with the previous period; time per day and per week; **When you play** (with an hour-by-hour,
  day-by-day heatmap and how much is late at night); your instance-type preferences; **Where you
  spend your time** (top worlds, optionally including your home world); **Who you spend time
  with**, including friends you are **fading out** with; **Familiar strangers** you keep meeting
  who are not friends; highlights; and the avatars you use most.
- **Journey** replays each visit on a timeline with the world, who was there (or that you were
  alone) and your screenshots from it.

Activity is only recorded while the app runs; the page says since when.

## Mutual Friend Graph

How your friends know each other. **Start Fetch** downloads mutual friends in the background
(progress shows in the status bar); **Fetch Again** refreshes it.

- Each dot is a friend; bigger dots have more mutual friends. A hollow dot means that friend does
  not share their mutual friends.
- Friends are colored by **community** (circles of friends who know each other); small
  communities are gray. Bright lines connect different communities, and you can mute the lines
  inside them.
- Find a friend, filter by a minimum number of connections, hide friends from the graph, and tune
  the layout (iterations, spacing, curvature, community separation).

## Tools

See [TOOLS.md](TOOLS.md).

## Docs

This documentation, built into the app, with search and a contents list.

## Dashboards

With **Show New Dashboard Button** on (Settings > Interface > Navigation) you can build your own
dashboards: add full, split or stacked rows and put a page in each panel (Feed, Friend Locations,
Game Log, Current Players, favorites, Friend History, Friends, Moderation, Notifications, My
Avatars, the VRChat Log Viewer or Tools) or a compact widget (recent feed, recent game log, or your
current instance).
