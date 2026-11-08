# Profile History

Open Settings > Social > Profile History. Each field has two independent switches:

| Field                  | Record history | Sync history  |
| ---------------------- | -------------- | ------------- |
| Status and status text | Off by default | On by default |
| Bio                    | Off by default | On by default |
| Pronouns               | Off by default | On by default |

These choices belong to this PC and are never copied by Settings Sync.

## Recording

Recording saves changes the app observes in profiles it already receives, including your
own profile. It does not start additional profile requests. Missing fields are ignored;
an explicitly empty value records a field being cleared. Repeated values do not add rows.

Automatic recording covers your friends and players currently in your game instance.
When a non-friend leaves, you leave the instance, or the game closes, automatic recording
for that player stops. Unfriending someone also stops automatic recording unless they are
currently in your instance. Eligibility is checked when a profile response arrives, so a
request already in progress does not keep tracking a player who has left.

Opening a user's profile manually allows that profile observation even if they are not
a friend or in your instance. It saves a snapshot of each enabled field value that is not
already in history, including the first value you see. Reopening an unchanged profile or
a version already saved does not add duplicate snapshots. Values already present in a
change's before or after data also count as saved. Missing fields are not filled with
empty defaults; explicitly cleared fields are captured. Recording must be enabled for
each field you want to capture, and its sync switch still controls whether it syncs.

A manual open does not enroll the user in ongoing tracking. Background lookups for
search results, notification senders, or other dialogs do not grant this
exception. Previously recorded history is kept, and your own profile history still works.

The switches also control saving status and bio changes in the Feed and your own profile
log. Existing records are kept when you turn recording off. For automatic recording, the
first observed value after enabling a field starts a comparison baseline; later changes save both the old
and new value. Turning recording off and back on starts a fresh comparison, keeping the
earlier history.

**Keep friend bios up to date**, under Settings > Social > Friend bios, is a separate option
that periodically fetches profiles. If you use it, enable **Record bio history** to save its
bio changes. Current profile data and badges keep working with history recording off.

Use **Refresh all friend profiles** on the Friends page to fetch all friends' profiles again,
including profiles already loaded. This updates current data and records observed changes
for fields whose recording is enabled. It uses the automatic history rules, so each field's
first observation establishes a baseline. Opening an individual profile also captures
enabled values that are not already in history. Completing or canceling a full refresh starts
a 5-minute cooldown before another full refresh can run.

## Reading history

Open a user dialog and select **Profile History**. This tab is also available on your own
profile. Filter to Status, Bio or Pronouns, or show all fields. Each entry shows its observed
time, previous value and new value. Times use your configured display timezone.
Manually captured values are labeled **Snapshot** and show the captured value once,
without claiming an earlier value or edit time.

Use **Refresh** to reread local history and **Load more** for older entries. The times are
when a device noticed a change, not a claim about exactly when the person edited it.
Previously saved Feed entries remain available in the Feed.

## History Sync

Syncing requires History Sync to be enabled and this PC to be paired. It uses the existing
end-to-end encryption and makes no request to a sync server while History Sync is off or
the PC is unpaired.

Each field's sync switch controls both uploads and imports, independently of local
recording. Existing history is included when syncing is enabled. You can receive history
from another device while recording is off on this PC. Status and bio selections also cover
their existing Feed and own-profile records; the bio selection also covers saved profile
bios. Turning a field's sync off keeps copies already stored on this PC and the server.

When syncing a field is re-enabled, the app catches up on previously skipped server history.
Imported entries are not uploaded back as new history, and matching changes seen by two
devices are deduplicated. Nothing remote deletes local history.

An upload or compaction already queued before you turn a field's sync off can pause syncing.
The app reports this instead of sending the deselected field. Re-enable the indicated field
to finish that queued work. Server history compaction waits while any profile field's sync
is off, so it cannot discard history this PC has chosen not to import.

## Server collector

The read-only server collector saves the same observed status, bio, and pronouns changes
as the app. It has its own copy of the six recording and sync switches, following the
primary PC selected as the **Server deduplication device** under Settings > Sync Options.
Other paired PCs keep their own choices.

Sync the primary PC after changing its choices. During History Sync it updates the
collector's copy, separately from Settings Sync. The collector checks that copy every
30 seconds and before each upload, and applies changes without restarting or sending your
VRChat session again. It uses its last received choices while the primary PC is offline.
Until it receives choices, recording defaults off and syncing defaults on for each field.

The collector observes profiles its normal runtime already receives; history recording
adds no profile requests. It uses the same eligibility rule. Without a local game instance
roster, it automatically records only friends and its own profile. Recording can stay on
while a field's sync is off, keeping those
changes only in the collector's temporary memory-backed database until syncing is enabled.
Stopping or restarting the collector discards unsent temporary history. Disabling a field's
sync also pauses a previously queued signed upload containing that field until re-enabled.

The desktop app, server API, supervisor, and collector runtime need compatible versions
for these settings to follow the primary PC. The settings copy contains only field choices
and device ordering metadata; profile values use the existing encrypted history chunks.
