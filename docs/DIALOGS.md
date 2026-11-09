# Dialogs

Clicking a person, world, avatar, group or instance anywhere in the app opens its dialog. Each
dialog has tabs and an actions menu. What you can do depends on whether it is yours, whether
you are friends, and your permissions in VRChat.

Most dialogs can copy the ID, the VRChat link, and a **VRCX-0-Nanashi link**. A VRCX-0-Nanashi
link opens the same thing in VRCX-0-Nanashi through the RemoteSync website, and carries a
preview so it looks good when pasted; the plain VRChat link is always available too. See
[FEATURES.md](FEATURES.md) for how these links work.

## User dialog

### What it shows

- The user's name, status (Online, Join Me, Ask Me, Do Not Disturb, online on another
  platform or the website, Offline), status text, pronouns, trust level and
  [badges](BADGES.md).
- **Current location** with the instance, its creator, whether it is age-restricted or
  closed, and who else is there. From here you can join (Launch/Invite) or invite yourself.
- **Info**: bio (with **Translate Bio** when translation is set up, and clickable bio links),
  languages, the group they represent, avatar info, home world, VRChat note and your **local
  note**, previous display names, status history, last seen, join count, **time together**
  (how long you have played together), play time, when they joined VRChat, when you became
  friends (and friendship history if you unfriended and re-friended), whether they allow
  avatar cloning and boops, and VRChat Credits.
- **Groups**: their groups, with owned and mutual groups first; sort alphabetically, by
  members or in their in-game order.
- **Profile History**: observed changes to status, status text, bio, pronouns, display name,
  bio links, profile pictures, profile decorations, badges, tags, age verification and
  avatar cloning, with before and after values, field filters and older entries. Also available on your own profile.
  Recording is opt-in for each field; see [Profile History](PROFILE_HISTORY.md).
- **Worlds** they made, sortable by name, update, creation, favorites or popularity, and their
  public **Favorite Worlds**.
- **Avatars** they uploaded that are public (all of yours, including purchased, on your own
  profile).
- **Mutual Friends**, sortable by last active or your friend order. Friends who hide the
  connection show as undisclosed.
- **Activity**: a calendar of when they were online (the "green squares", which you can't
  farm), their most active day and peak hours, your **online overlap** with them, and their
  most visited worlds (by time or visits, optionally without their home world). Pick 7, 30, 90, 180 or 365 days, or all time.
- **JSON**: the raw data, for the curious.

### Actions

- **Invite**, **Request Invite**, **Send Boop**, **Invite to Group**.
- Friend requests: send, cancel, accept or decline. **Unfriend**.
- **Edit Note and Local Note**. The VRChat note is stored by VRChat; the local note only in
  the app.
- **Show Instance History** with this user.
- **Show Avatar Author** and fallback avatar details for the avatar they wear.
- **Moderation**: block, mute, hide or show their avatar, reset avatar visibility, enable or
  disable avatar interaction, mute the chatbox, and **Report User**.
- **Group Moderation**: kick or ban them from groups you manage.
- **Badges**: tick them onto your custom badges or make a new badge for them. See
  [BADGES.md](BADGES.md).
- On your own profile: **Edit Profile** (bio, links, pronouns, languages), **Edit Social
  Status** with saved presets, **Account Standing**, and your profile media (banner and
  icon, managed in the Gallery). For a solid banner color, use the color picker or enter
  a 3- or 6-digit hex color, with or without `#`, then choose **Apply Color**. The preview
  updates for valid colors; invalid values cannot be applied.
- Copy the user ID, VRChat URL, display name, or open **Show Discord Connections** and
  **Show Mutual Friends**.

The developer's own user dialog always uses a black, white and red color scheme.

## World dialog

### What it shows

- **Info**: name, description (with **Translate Description**), your local note, author tags,
  YouTube preview, players now, favorites, visits, capacity, heat and popularity, when it was
  created, updated and published (and published to Labs), version, release status, platforms
  and restrictions, plus **your last visit**, **your visits**, **your time spent**, friends who
  visited and when they last did, the world's persistent data and its cache size on your PC.
- **Instances**: the world's open instances with their players and friends in them. You can pin
  a world to the side panel from here to keep watching its instances.
- **Screenshots** you took in this world.
- **JSON**.

### Actions

- **New Instance** (and self-invite or open in-game at once). See [New instance](#new-instance).
- **Share**, copy the links, **Make Home** or **Reset Home**.
- Favorite it, locally or in VRChat.
- **Show Instance History** for this world.
- **Local Data**: open the world's cache, delete it from the cache, and delete its persistent
  data.
- For your own worlds: edit details, image, content warnings, settings and tags, allowed video
  player domains, download the Unity package, publish, publish to Labs (once every 7 days),
  unpublish and delete.

## Avatar dialog

### What it shows

- **Info**: name, description, ID and links, when it was created and updated, version,
  platforms, its performance rating on PC, Android and iOS, how long you have worn it,
  visibility, tags, your local note, store listings, its gallery and attributes.
- **Performance**: the full performance stats against each platform's limits.
- **JSON**.

### Actions

- **Select Avatar** to wear it, or **Select Fallback Avatar**.
- **Block Avatar** or unblock it.
- Favorite it, locally or in VRChat.
- **Open Cache** or delete it from the cache.
- For your own avatars: make public or private, edit details, content tags and image, manage
  tags, download the Unity package, create, regenerate or delete its impostor, and delete it.

## Group dialog

### What it shows

- **Overview**: announcement, rules, member count, creation date, links, roles (and yours),
  your last visit, open instances, and past and upcoming events.
- **Events**, **Posts** and **Photos**.
- **JSON**.

### Actions

- **Join Group** (or cancel your join request), **Leave Group**, **Block Group**.
- **Represent Group** or stop representing it, and set its **visibility** on your profile
  (everyone, friends or hidden).
- **Subscribe** or **unsubscribe** from its announcements.
- **Invite to Group**, **Share**, save it to [Saved Groups](PAGES.md#favorites).
- With permissions: create posts and events, manage or view roles, use the moderation tools
  (members, bans, invites and join requests), edit the group's details, banner and icon, and
  delete it.

## New instance

Choose the **access type** (Public, Friends+, Friends, Invite+, Invite, or Group with Group
Members, Group+ or Group Public), the **region** (US West, US East, Europe, Japan), a minimum
avatar performance, queue and age gate, and an instance name. Then **Create Instance** or
**Create and Invite**.

## Launch

The launch dialog opens an instance: in VR, in desktop mode, or in your running game, or send
yourself an invite. **Switch avatar before joining** changes your avatar first, from your
current, own or favorite avatars. You can copy the VRChat link, the VRCX-0-Nanashi link or the
instance ID, or share it.

## Instance History

Opened from a user or world, it lists the instances you shared, with a **Players** table and a
**Timeline** chart of who was there when. You can copy the instance ID or world name.
