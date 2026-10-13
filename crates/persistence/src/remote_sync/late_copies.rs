use crate::common::ParamsBuilder;
use crate::database::DatabaseWriteTransaction;
use crate::Error;

/// A change a recorder only notices the next time it looks at the profile:
/// a PC that was off learns of a rename when it next starts, long after the
/// collector logged it.
const NOTICED_ON_NEXT_LOOK_SECONDS: i64 = 30 * 86_400;
/// A change every running recorder is told about, where one of them can
/// still be minutes behind after a missed event or a reconnect.
const NOTICED_LIVE_SECONDS: i64 = 600;

enum Change {
    /// The same change when these columns are equal.
    Columns(&'static [&'static str]),
    /// Friend log rows say what changed in a column that depends on `type`.
    FriendLog,
}

/// How one history stream tells a late copy of a change from a repeat of it.
struct Rule {
    stream: &'static str,
    /// Whose change it is. Changes of others never lie in between.
    subject: &'static str,
    change: Change,
    max_seconds: i64,
}

const RULES: &[Rule] = &[
    Rule {
        stream: "feed_gps",
        subject: "user_id",
        change: Change::Columns(&["location"]),
        max_seconds: NOTICED_LIVE_SECONDS,
    },
    Rule {
        stream: "feed_status",
        subject: "user_id",
        change: Change::Columns(&["status", "status_description"]),
        max_seconds: NOTICED_LIVE_SECONDS,
    },
    Rule {
        stream: "feed_avatar",
        subject: "user_id",
        change: Change::Columns(&["avatar_name"]),
        max_seconds: NOTICED_LIVE_SECONDS,
    },
    Rule {
        stream: "feed_online_offline",
        subject: "user_id",
        change: Change::Columns(&["type"]),
        max_seconds: NOTICED_LIVE_SECONDS,
    },
    Rule {
        stream: "feed_bio",
        subject: "user_id",
        change: Change::Columns(&["bio"]),
        max_seconds: NOTICED_ON_NEXT_LOOK_SECONDS,
    },
    Rule {
        stream: "self_profile_log",
        subject: "field",
        change: Change::Columns(&["value"]),
        max_seconds: NOTICED_ON_NEXT_LOOK_SECONDS,
    },
    Rule {
        stream: "friend_log_history",
        subject: "user_id",
        change: Change::FriendLog,
        max_seconds: NOTICED_ON_NEXT_LOOK_SECONDS,
    },
];

/// Streams small enough to be checked whole when an account is opened, for
/// copies stored before this rule existed.
pub(crate) const CHECKED_WHOLE: &[&str] = &["friend_log_history", "self_profile_log"];

/// Which rows are checked for being a late copy.
pub(crate) enum Rows<'a> {
    All,
    /// Rows stored from this row id on: the ones an import just added.
    From(i64),
    /// Rows about `subject` around `time`: the surroundings of a row this
    /// PC just recorded.
    Near {
        subject: &'a str,
        time: &'a str,
    },
}

impl Change {
    /// SQL that is true when row `other` is the same change as row `r`.
    fn same(&self, other: &str) -> String {
        match self {
            Self::Columns(columns) => columns
                .iter()
                .map(|column| format!("{other}.\"{column}\" IS r.\"{column}\""))
                .collect::<Vec<_>>()
                .join(" AND "),
            Self::FriendLog => format!("{other}.type = r.type AND CASE r.type WHEN 'DisplayName' THEN {other}.display_name IS r.display_name AND {other}.previous_display_name IS r.previous_display_name WHEN 'TrustLevel' THEN {other}.trust_level IS r.trust_level AND {other}.previous_trust_level IS r.previous_trust_level ELSE 1 END"),
        }
    }

    /// SQL that is true when row `x` is a different change that has to
    /// happen before the change of row `r` can happen again.
    fn undoes(&self) -> String {
        match self {
            Self::Columns(_) => format!("NOT ({})", self.same("x")),
            Self::FriendLog => format!("CASE WHEN r.type IN ('DisplayName', 'TrustLevel') THEN x.type = r.type AND NOT ({}) ELSE x.type IN ('Friend', 'Unfriend') AND x.type != r.type END", self.same("x")),
        }
    }

    /// Friend requests are left alone: the same person can ask twice in a
    /// row, with nothing in between.
    fn applies(&self) -> &'static str {
        match self {
            Self::Columns(_) => "1",
            Self::FriendLog => "r.type IN ('Friend', 'Unfriend', 'DisplayName', 'TrustLevel')",
        }
    }
}

/// Removes rows that sync brought in for a change this PC also holds.
///
/// Two recorders stamp the same change with the moment each of them noticed
/// it, which can be minutes or hours apart, so time alone cannot tell a
/// copy from a repeat. What lies between the two rows can: the same change
/// only happens again after a different one (a rename back, an unfriend,
/// another location).
///
/// A row this PC recorded itself is never removed, so its time is the one
/// that stays. Between two rows that both went through sync the one stored
/// here first stays, and two rows of one source are that source's own
/// separate events. Returns the number of rows removed; streams without a
/// rule are left alone.
pub(crate) fn drop_synced_copies(
    tx: &DatabaseWriteTransaction<'_>,
    table: &str,
    stream: &str,
    rows: Rows<'_>,
) -> Result<i64, Error> {
    let Some(rule) = RULES.iter().find(|rule| rule.stream == stream) else {
        return Ok(0);
    };
    let nothing_synced = tx
        .execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'remote_sync_provenance'",
            &Default::default(),
        )?
        .is_empty()
        || tx
            .execute(
                "SELECT 1 FROM remote_sync_provenance WHERE stream = @stream LIMIT 1",
                &ParamsBuilder::new().set("stream", table).build(),
            )?
            .is_empty();
    if nothing_synced {
        return Ok(0);
    }

    let quoted = format!("\"{}\"", table.replace('"', "\"\""));
    let subject = rule.subject;
    let seconds = rule.max_seconds;
    let synced = |alias: &str| {
        format!("EXISTS (SELECT 1 FROM remote_sync_provenance WHERE stream = @stream AND local_rowid = {alias}.rowid)")
    };
    // The text range lets the time index narrow the search; julianday then
    // compares the instants themselves.
    let around = |alias: &str, center: &str| {
        format!("{alias}.created_at >= strftime('%Y-%m-%dT%H:%M:%S', {center}, '-{seconds} seconds') AND {alias}.created_at <= strftime('%Y-%m-%dT%H:%M:%S', {center}, '+{seconds} seconds') || '~'")
    };
    let mut params = ParamsBuilder::new()
        .set("stream", table)
        .set("seconds", seconds);
    let checked = match rows {
        Rows::All => "1".to_owned(),
        Rows::From(rowid) => {
            params = params.set("from", rowid);
            "r.rowid >= @from".to_owned()
        }
        Rows::Near { subject: who, time } => {
            params = params.set("subject", who).set("time", time);
            format!("r.\"{subject}\" IS @subject AND {}", around("r", "@time"))
        }
    };
    let removed = tx.execute_non_query(
        &format!(
            "DELETE FROM {quoted} WHERE rowid IN (SELECT r.rowid FROM {quoted} AS r WHERE {checked} AND {applies} AND julianday(r.created_at) IS NOT NULL AND {r_synced} AND EXISTS (SELECT 1 FROM {quoted} AS k WHERE k.\"{subject}\" IS r.\"{subject}\" AND {k_around} AND k.rowid != r.rowid AND {same} AND ABS(julianday(k.created_at) - julianday(r.created_at)) * 86400.0 <= @seconds AND (k.rowid < r.rowid OR NOT {k_synced}) AND NOT {same_source} AND NOT EXISTS (SELECT 1 FROM {quoted} AS x WHERE x.\"{subject}\" IS r.\"{subject}\" AND {x_around} AND julianday(x.created_at) > MIN(julianday(k.created_at), julianday(r.created_at)) AND julianday(x.created_at) < MAX(julianday(k.created_at), julianday(r.created_at)) AND {undoes})))",
            applies = rule.change.applies(),
            r_synced = synced("r"),
            k_synced = synced("k"),
            same_source = "EXISTS (SELECT 1 FROM remote_sync_provenance AS of_r JOIN remote_sync_provenance AS of_k ON of_k.source_id = of_r.source_id WHERE of_r.stream = @stream AND of_r.local_rowid = r.rowid AND of_k.stream = @stream AND of_k.local_rowid = k.rowid)",
            k_around = around("k", "r.created_at"),
            x_around = around("x", "r.created_at"),
            same = rule.change.same("k"),
            undoes = rule.change.undoes(),
        ),
        &params.build(),
    )?;
    if removed > 0 {
        tx.execute_non_query(
            &format!("DELETE FROM remote_sync_provenance WHERE stream = @stream AND local_rowid NOT IN (SELECT rowid FROM {quoted})"),
            &ParamsBuilder::new().set("stream", table).build(),
        )?;
    }
    Ok(removed)
}
