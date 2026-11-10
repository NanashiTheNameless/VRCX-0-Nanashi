# Badges

Badges are the small labels next to user names. They show up everywhere a name does: friend
and player lists, the Feed, the Game Log, the friends sidebar, hover cards, the user dialog
and notifications. They also show in VR and on the desktop overlay (see
[Badges in VR and the Desktop Overlay](#badges-in-vr-and-the-desktop-overlay)). There are four kinds: built-in badges, global badges, your own custom badges, and
the collapsed folder custom badges fold into when space runs out.

The shape tells you who can see a badge:

- **Rounded squares** are seen by everyone using VRCX-0-Nanashi: the built-in badges and
  global badges.
- **Round** badges are your own custom badges. Only you see them.
- The **folder** that holds collapsed custom badges is a rounded square too.

Badges appear in this order: the built-in badges, then global badges, then custom badges.
Built-in and global badges are never collapsed or hidden.

## Built-in badges

Three badges are built into the app. They cannot be turned off, edited or copied, and their
icons are reserved (see [Reserved icons](#reserved-icons)).

### Developer badge (the glitchy red badge)

Marks NamelessNanashi, the developer of VRCX-0-Nanashi. It reads **Dev** with a code icon
(`</>`), in white text on a black badge that fades to dark red, with a red border and a red
icon.

It is animated on purpose, so it stands out from every other badge:

- A **red scanline** sweeps down across the badge.
- Then the badge **glitches**: red and white slices jump sideways across it, red and white
  copies of the icon split apart, and the icon and label jitter.
- Between glitches a **red glow** breathes along the inside edge.
- The scan and the glitch share one cycle of about 23 seconds, so the badge stays calm most of
  the time. There is always at least a quarter second with no glitch on either side of each
  scan.

In compact places (narrow lists) it shrinks to just the icon, with the same effects. The
developer's user dialog also always uses a black, white and red color scheme, whatever theme
you use.

Hover the badge for its full name, **VRCX-0-Nanashi Developer**.

### Upstream developer badge

Marks Map1en, the developer of upstream VRCX-0. It reads **UPSTREAM** with a diamond icon, in
dark text on a light silver badge with a gray border. Light catches the diamond now and then:
a bright flare and a soft cross of light pass over it about every 3.6 seconds. It is calmer
than the developer badge on purpose. Its full name is **Upstream VRCX-0 Developer**.

### VRChat Staff badge

Marks accounts VRChat itself marks as staff (a developer type or the moderator tag), and
members of VRChat's official team group, VRCHAT.0000. It reads **VRC Staff** with a shield
and check mark icon, in white on VRChat blue, with a white border inside a thin blue outline,
so it stays visible on light and dark themes. It does not animate. Its full name is **VRChat
Staff**.

Group membership is learned from each user's own group list as the app loads it; the app
makes no extra requests to find staff.

## Global badges

Global badges are given by hand by the developer to people who helped the fork, and everyone
using VRCX-0-Nanashi sees them. They come after the built-in badges, most prestigious first.
Hover one to see what it was given for and, if it has dates, when it applies.

| Badge                  | Icon             | Color    | Effect                 | Given for                                                      |
| ---------------------- | ---------------- | -------- | ---------------------- | -------------------------------------------------------------- |
| Early Supporter        | Sprout           | Gold     | Sparkle, shimmer, glow | Supporting VRCX-0-Nanashi from early on                        |
| Sponsor                | Gem              | Amethyst | Flip, sparkle          | Supporting VRCX-0-Nanashi with regular donations               |
| Donator                | Hand with heart  | Ember    | Flow, wiggle           | Supporting VRCX-0-Nanashi with a donation                      |
| Contributor            | Pull request     | Emerald  | Flow                   | A significant contribution to VRCX-0-Nanashi                   |
| Security Reporter      | Shield with plus | Midnight | Glow                   | Privately reporting multiple valid security problems           |
| Code Reviewer          | Merge            | Teal     | Flow                   | Reviewing pull requests or testing branches and reporting back |
| Bug Hunter             | Bug              | Crimson  | Wiggle                 | Finding and reporting important bugs                           |
| Tool Maker             | Wrench           | Midnight | None                   | Building a script, integration or tool that works with the app |
| Theme Artist           | Palette          | Amethyst | Flow                   | Making a theme or artwork for VRCX-0-Nanashi                   |
| Docs Writer            | Open book        | Emerald  | None                   | Writing or improving the guides                                |
| Accessibility Reviewer | Accessibility    | Sapphire | None                   | Testing accessibility and reporting what needed fixing         |
| Beta Tester            | Flask            | Sapphire | Shimmer                | Testing nightly builds and reporting back                      |
| Promoter               | Megaphone        | Rose     | Wiggle                 | A video, guide or post that brought people to VRCX-0-Nanashi   |
| Idea Contributor       | Light bulb       | Teal     | Sparkle                | Suggesting a feature that shipped                              |
| Special Thanks         | Sparkles         | Rose     | Glow                   | Helping in a way no other badge covers                         |

The developer can also give **one-off awards** with their own label, icon and look. These come
after the badges in the table.

### Colors and effects

Global badges use one of these color styles: ember, gold, emerald, sapphire, amethyst,
crimson, rose, teal and midnight. Each badge can combine several effects:

- **Shimmer**: a band of light sweeps across the badge.
- **Flow**: the colors slowly flow across the badge.
- **Sparkle**: small sparkles twinkle around it.
- **Wiggle**: the icon gives a little wiggle.
- **Glow**: the badge softly glows.
- **Embers**: embers rise and flicker off the badge.
- **Flip**: the icon flips over.

In lists, global badges animate only while you hover them; in the user dialog they animate on
their own.

### Getting a global badge

Supporters can get a Donator or Sponsor badge as a thank-you. For any global badge, open a
badge request on this fork's GitHub repository with your VRChat user ID. The badge list is
public, so you are only added with your consent.

### How the list updates

Every release has the badge list built in. The app also checks for a newer list 10 seconds
after startup, then every 6 hours and whenever you check for updates, from this fork's GitHub
releases. It only uses a list
that is signed by the developer and newer than the one it has, and it sends nothing about you
with the download. See [TELEMETRY.md](TELEMETRY.md).

## Custom badges

Custom badges are your own. Make them under **Settings > Social > User Badges**, or from a
user's dialog: the action menu has a **Badges** submenu to tick that user onto existing
badges or create a new badge for them. Only you see custom badges. They are saved with your
settings and travel with Settings Sync (under the Badges category) when that is on.

A custom badge has:

- a **name** (up to 32 characters),
- a **color** (pick one of the presets or any color),
- an **icon**: any [Lucide](https://lucide.dev/icons/) or Lucide Lab icon, except
  [reserved ones](#reserved-icons). Lab icons show "(Lab)" in the picker.
- **rules** that decide who gets it.

You can have as many custom badges as you like, turn each one on or off, and change their order.
Above 50, Settings shows a warning: every name on screen checks every badge, and all of them
sync as one value, so very many badges can slow down long lists and enlarge Settings Sync
uploads.

### Who gets a custom badge

The rule editor reads as a sentence: "Show this badge for users who match **ALL**, **ANY** or
**NONE** of these". Each condition reads as plain words:

- **Specific users**: users you list (paste user IDs or profile links).
- **Self**: whichever VRChat account you are signed in with.
- **All friends**.
- **Favorite friend group**: friends in one of your VRChat or local favorite groups.
- **Is in VRChat group**: members of a group, or of one role in it. Each user's own group list
  is trusted when the app has seen it; a member list you fetch fills in the rest (up to 5000
  members).
- **Trust rank**, **VRC+ supporters** and **Age verified**, using friend list data and
  profiles the app has already loaded. Age verification has three choices: **Any visible
  verification**, **Verified 18+ only**, and **Verified, hidden**. The hidden choice requires
  both a hidden verification status and an explicit verified flag. A hidden status alone,
  missing data, or an unverified flag does not match. Badges do not fetch profiles themselves.
  VRChat's friend list does not include age verification, so the app remembers the last value
  it saw for each friend (from a profile you opened or a live update) in its local database
  and restores it after a restart. A newer observation always replaces the remembered one.
  This is kept per account on your PC only and is never synced. People outside your friends
  list can match once the app observes the required data, such as when you open their profile.
- **Platform**: users last seen on PC, Android (Quest) or iOS.
- **Status**: online users with Join Me, Online, Ask Me or Do Not Disturb, or **Offline**,
  which matches friends who are offline. A friend who is offline never matches an online
  status, even if their last status is still known.
- **Spoken language**: users who list a language on their VRChat profile.
- **Friend number**: friends whose number falls in a range, such as 1 to 50, or from a
  number up with no upper limit. Numbers count up as you add friends and are never reused,
  so a former friend keeps their number.
- **Blocked or muted**: users you have blocked or muted in VRChat. The app reads this from
  the moderation list it keeps up to date in the background; badges never ask VRChat for it.
- **Display name**, **Status text**, **Memo or note**, **Bio** and **Pronouns**: compare a
  piece of profile text. Each one can **Contains**, **Starts with**, **Is exactly** or
  **Matches regular expression** some text, all ignoring case, or **Is not empty**, which
  needs no text and matches when the user has any. The memo and the VRChat note are checked
  separately. An invalid regular expression is marked in the editor and never matches.

More options:

- **Use** switches a condition off without deleting it.
- **NOT** reverses a condition: "are not your friends".
- **Add a group** nests conditions: "...who match ANY of these" inside "ALL of these". Groups
  can nest up to 8 levels.
- The ALL, ANY or NONE choice only appears once two or more conditions in a list are on. A
  single condition decides by itself, and a list with none switched on never matches.
- **Show advanced logic** adds XOR (an odd number match), NAND (not all match) and XNOR, also
  called XAND (an even number match, including none), plus an interactive logic guide with
  diagrams and a truth table.
- Missing profile information counts as no match, before NOT is applied.

Under the rules the editor shows the badge **in plain words** ("Users who are your friends and
were last on PC") and as a **condition map** that leads to the badge.

Users you add from the user dialog's Badges menu always get the badge, alongside the rules.

### When there is not enough room

Custom badges never wrap onto a second line. When they would cut off the user's name, they
first drop their labels and show only icons, then fold into a single folder badge. Like an
app folder, it shows tiny versions of up to four of the badge icons; hover it to see the names
of every badge inside.

### Import and export

**Export all** and the export button on each badge give you the badges as JSONC (JSON with
comments) to copy or save as a `.jsonc` file. **Import** takes pasted text or a file: a full
export, a list or a single badge. Badges with the same ID replace your saved ones unless you
choose to add copies. Fetched VRChat group member lists are left out of exports; fetch them
again after importing.

## Badges in VR and the Desktop Overlay

The wrist menu's Feed, Players and Notes pages, HMD notification cards and the Desktop
Overlay draw each user's badges after their name, as small icon tiles in the badge's colors:
rounded squares for built-in and global badges, circles for custom badges. They never move or
animate there, and show at most six per name; the rest are left out. The app window works out
who gets which badge and passes the result to the overlays on the same PC, so badges appear
there a moment after the app has started, and changes to your custom badges follow within a
few seconds.

## Reserved icons

So nobody can imitate them, custom badges cannot use:

- the built-in badge icons (code, diamond, shield with check mark),
- icons with Code, Braces, Brackets or Shield in their name (QR codes are fine),
- the global badges' award icons and their variants, and icons starting with Diamond, Flask,
  Test Tube or Sparkle.

If an icon you used becomes reserved, the badge shows a star instead and Settings asks you to
pick another icon.

## Less motion

Turning on **Reduce effects** (Settings > Interface > Appearance) or your system's reduced
motion setting stops every badge animation, the developer badge's glitch included.

## Privacy

Badges make no requests of their own, apart from fetching a VRChat group's member list when
you ask for it, and the signed global badge list download described above. Custom badges
leave your PC only through Settings Sync when you have it on. Handing badges to the VR and
desktop overlays stays on your PC.
