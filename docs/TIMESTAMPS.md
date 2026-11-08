# Dates and timezones

## Storage and upgrades

App-owned absolute dates use signed 64-bit Unix epoch seconds in UTC. Dates
before 1970 remain negative. SQLite stores these in INTEGER columns. Durations,
timeouts and elapsed-time calculations keep their existing units.

On update, the versioned database migration converts old ISO text and integer
millisecond dates, including account-specific history tables and known dates in
settings. Existing rows and row IDs are retained. Game-log rows that used to
have different fractional timestamps within one second keep a stable
`event_discriminator`; repeated imports match that identity instead of adding
copies or discarding collisions. Old backup manifests, registry backups,
replay checkpoints, profile imports and history imports remain readable.

Dates lose fractional-second precision. Invalid legacy date values retain their
rows, with a NULL or zero date where required, and a migration warning. Derived
activity caches are rebuilt. Recent-action cooldown timestamps in localStorage
are converted when first read into a versioned seconds cache, retaining the
original cooldown boundary to whole-second precision. The version marker also
keeps old millisecond dates near 1970 unambiguous.

The normal database upgrade process works on a SQLite backup before replacing
the active database. Keep an independent profile backup before an update if
you need to return to an older build. Successful upgrade cleanup removes its
working backup; this is not a permanent rollback archive. An old build should
not open a migrated profile in place.

## Display timezone

Open Settings > Interface > Time/Date > Timezone. Enter an IANA timezone such
as `America/Chicago` or `Asia/Tokyo`, or a fixed offset such as `UTC+05:30`,
`-03:30` or `+0530`. Offsets through +23:59 and -23:59 are accepted. Leave the
field blank, or use `system`, to follow the operating system. Invalid input is
rejected without changing the saved preference.

The setting belongs to this PC and is excluded from Settings Sync. It changes
displayed dates, notification and game-session day groups, calendar filters,
reminder inputs, Rust overlays, and assistant calendar windows. Stored UTC
seconds do not change when the timezone changes.

IANA zones follow daylight-saving rules at each event's date. A calendar day
can be 23 or 25 hours. Date inputs use calendar boundaries rather than assuming
every local day is 24 hours. For a skipped wall-clock time, input resolution
moves forward through the gap; for a repeated time, it chooses the earlier
occurrence.

Group-event start and end inputs use the display timezone and are converted to
VRChat's required ISO format when submitted. Recurring events also have a series
timezone: existing series keep their saved IANA zone; new series use the display
IANA zone, or the system IANA zone when the display preference is a fixed offset.
The editor shows this zone. The recurrence end date is a wall-clock value in
the series timezone. It is not converted as an absolute timestamp.

## Imports, APIs and RemoteSync

Legacy readers accept ISO text, integer seconds and legacy integer milliseconds.
For fields without an explicit unit, integer magnitudes at or above
`100_000_000_000` are interpreted as milliseconds. Explicit old millisecond
columns and fields are converted by their declared unit, including dates near 1970. Conversion rounds down, including negative fractions.

VRChat and other external APIs retain their required formats at the boundary.
RemoteSync cryptography and wire types come from the protocol crate pinned in
`Cargo.toml`. Existing signed bytes are never rewritten before verification.
The pinned v2 protocol uses `/v2` API routes and epoch seconds in new chunk,
live snapshot, envelope and manifest timestamps. Its readers still verify old
signed data before importing it. Local history rows carry epoch seconds and
retain their event discriminators.

The website database and protocol migration is a separate coordinated rollout.
The chosen rollout makes new writers use the new protocol and requires older
desktop builds to upgrade, while retaining readers for old signed data. Publish
and pin the matching protocol revision before enabling those writers together.
Changing an `_ms` payload to seconds without a version change is incompatible.
The desktop repository's ignored `nogit/website-epoch-seconds-prompt.md` records
the website handoff. It is not a replacement for implementing that migration.

## Development checks

Use `vrcx_0_core::time` and the contracts epoch deserializers on the Rust side.
Use `src/shared/utils/displayTimeZone.ts` for frontend normalization, display
parts and local-calendar conversion. JavaScript `Date` expects milliseconds:
pass `seconds * 1000` or use the shared parser. Use a `Date` explicitly when a
value is already a millisecond clock.

Regression coverage includes old-schema upgrades, signed dates, collision
preservation and repeated imports, legacy replay/backup data, DST boundaries,
fixed offsets, timezone-aware session/notification groups, group-event inputs,
and persisted cooldown conversion. Run the repository's full frontend and Rust
checks after changing shared timestamp contracts; regenerate Tauri bindings
when a reachable command type changes.
