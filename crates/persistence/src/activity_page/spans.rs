use crate::activity::parse_activity_time_ms;
use crate::common::{row_i64, row_string, ParamsBuilder};
use crate::database::DatabaseService;
use crate::game_log::ensure_game_log_tables;
use crate::ownership::{owner_id_for_filter, OwnerId};
use crate::social_aggregates::{access_bucket_sql, world_id_from_location_sql};
use crate::Error;

use vrcx_0_contracts::activity_page::{
    ActivityLocationSpan as LocationSpan, ActivityWindowSpans as WindowSpans,
};
use vrcx_0_core::activity_sessions::{span_duration_ms, SpanEnd};

struct SourceRow {
    left_at: String,
    time: i64,
    world_id: String,
    world_name: String,
    access_bucket: String,
}

pub fn read_instance_spans(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: i64,
) -> Result<WindowSpans, Error> {
    let rows = read_source_rows(db, owner_user_id, from_ms, to_ms)?;
    Ok(WindowSpans {
        spans: clip_spans(&spans_from_rows(&rows), from_ms, to_ms),
        has_open_tail: false,
    })
}

pub fn read_play_spans(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: i64,
    open_location: Option<&str>,
) -> Result<Vec<LocationSpan>, Error> {
    let mut spans = read_instance_spans(db, owner_user_id, from_ms, to_ms)?.spans;
    let Some(location) = open_location else {
        return Ok(spans);
    };
    if let Some(open) = read_open_instance_span(db, owner_user_id, location, to_ms)? {
        spans.extend(clip_spans(&[open], from_ms, to_ms));
    }
    Ok(spans)
}

fn read_open_instance_span(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    location: &str,
    now_ms: i64,
) -> Result<Option<LocationSpan>, Error> {
    let location = location.trim();
    if location.is_empty() {
        return Ok(None);
    }
    ensure_game_log_tables(db)?;
    let world_id_expr = world_id_from_location_sql("location");
    let access_expr = access_bucket_sql("location");
    let rows = db.execute(
        &format!(
            "SELECT created_at, time, {world_id_expr} AS world_id,
                    COALESCE(world_name, '') AS world_name, {access_expr} AS access_bucket
             FROM gamelog_location
             WHERE owner_id IN (0, @owner_id) AND location = @location
             ORDER BY created_at DESC, id DESC
             LIMIT 1"
        ),
        &ParamsBuilder::new()
            .set("owner_id", owner_id_for_filter(db, owner_user_id)?)
            .set("location", location)
            .build(),
    )?;
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    if row_i64(row, 1) != 0 {
        return Ok(None);
    }
    let Some(start_ms) = parse_activity_time_ms(&row_string(row, 0)) else {
        return Ok(None);
    };
    let duration_ms = span_duration_ms(start_ms, 0, SpanEnd::OpenTail, now_ms);
    if duration_ms <= 0 {
        return Ok(None);
    }
    Ok(Some(LocationSpan {
        start_ms,
        end_ms: start_ms + duration_ms,
        world_id: row_string(row, 2),
        world_name: row_string(row, 3),
        access_bucket: row_string(row, 4),
        inferred: true,
    }))
}

fn read_source_rows(
    db: &DatabaseService,
    owner_user_id: &OwnerId,
    from_ms: Option<i64>,
    to_ms: i64,
) -> Result<Vec<SourceRow>, Error> {
    ensure_game_log_tables(db)?;
    let owner_id = owner_id_for_filter(db, owner_user_id)?;
    let world_id_expr = world_id_from_location_sql("jl.location");
    let access_expr = access_bucket_sql("jl.location");
    let from_filter = if from_ms.is_some() {
        "AND julianday(jl.created_at) >= julianday(@from_iso)"
    } else {
        ""
    };
    let params = ParamsBuilder::new()
        .set("owner_id", owner_id)
        .set("user_id", owner_user_id.as_str())
        .set(
            "from_iso",
            from_ms
                .map(crate::activity::activity_iso_from_ms)
                .unwrap_or_default(),
        )
        .set("to_iso", crate::activity::activity_iso_from_ms(to_ms))
        .build();
    let sql = format!(
        "SELECT jl.created_at,
                jl.time,
                {world_id_expr} AS world_id,
                COALESCE((
                    SELECT gl.world_name
                    FROM gamelog_location gl
                    WHERE gl.owner_id IN (0, @owner_id)
                      AND gl.location = jl.location
                    ORDER BY gl.id DESC
                    LIMIT 1
                ), '') AS world_name,
                {access_expr} AS access_bucket
         FROM gamelog_join_leave jl
         WHERE jl.owner_id IN (0, @owner_id)
           AND jl.user_id = @user_id
           AND jl.type = 'OnPlayerLeft'
           AND jl.time > 0
           {from_filter}
           AND julianday(jl.created_at, '-' || (jl.time * 1.0 / 1000) || ' seconds') <= julianday(@to_iso)
         ORDER BY jl.created_at ASC, jl.id ASC"
    );

    Ok(db
        .execute(&sql, &params)?
        .into_iter()
        .map(|row| SourceRow {
            left_at: row_string(&row, 0),
            time: row_i64(&row, 1),
            world_id: row_string(&row, 2),
            world_name: row_string(&row, 3),
            access_bucket: row_string(&row, 4),
        })
        .collect())
}

fn spans_from_rows(rows: &[SourceRow]) -> Vec<LocationSpan> {
    let mut spans = Vec::with_capacity(rows.len());
    for row in rows {
        if row.time <= 0 {
            continue;
        }
        let Some(end_ms) = parse_activity_time_ms(&row.left_at) else {
            continue;
        };
        let Some(start_ms) = end_ms.checked_sub(row.time) else {
            continue;
        };
        spans.push(LocationSpan {
            start_ms,
            end_ms,
            world_id: row.world_id.clone(),
            world_name: row.world_name.clone(),
            access_bucket: row.access_bucket.clone(),
            inferred: false,
        });
    }
    spans
}

fn clip_spans(spans: &[LocationSpan], from_ms: Option<i64>, to_ms: i64) -> Vec<LocationSpan> {
    let mut clipped = Vec::with_capacity(spans.len());
    for span in spans {
        let start_ms = match from_ms {
            Some(from_ms) => span.start_ms.max(from_ms),
            None => span.start_ms,
        };
        let end_ms = span.end_ms.min(to_ms);
        if end_ms <= start_ms {
            continue;
        }
        clipped.push(LocationSpan {
            start_ms,
            end_ms,
            world_id: span.world_id.clone(),
            world_name: span.world_name.clone(),
            access_bucket: span.access_bucket.clone(),
            inferred: span.inferred,
        });
    }
    clipped
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: i64 = 1_700_000_000_000;
    const HOUR: i64 = 3_600_000;

    fn source_row(left_offset_ms: i64, time: i64) -> SourceRow {
        SourceRow {
            left_at: crate::activity::activity_iso_from_ms(BASE + left_offset_ms),
            time,
            world_id: "wrld_a".into(),
            world_name: "Alpha".into(),
            access_bucket: "public".into(),
        }
    }

    #[test]
    fn spans_use_the_closed_instance_end_and_duration() {
        let spans = spans_from_rows(&[source_row(3 * HOUR, HOUR)]);

        assert_eq!(spans.len(), 1);
        assert_eq!((spans[0].end_ms - spans[0].start_ms), HOUR);
        assert_eq!(spans[0].start_ms, BASE + 2 * HOUR);
        assert_eq!(spans[0].end_ms, BASE + 3 * HOUR);
        assert!(!spans[0].inferred);
    }

    #[test]
    fn spans_drop_unclosed_instance_rows() {
        let spans = spans_from_rows(&[source_row(3 * HOUR, 0)]);

        assert!(spans.is_empty());
    }

    #[test]
    fn clip_trims_spans_to_window_bounds() {
        let spans = vec![LocationSpan {
            start_ms: BASE,
            end_ms: BASE + 10 * HOUR,
            world_id: "wrld_a".into(),
            world_name: "Alpha".into(),
            access_bucket: "public".into(),
            inferred: false,
        }];

        let clipped = clip_spans(&spans, Some(BASE + 2 * HOUR), BASE + 5 * HOUR);

        assert_eq!(clipped.len(), 1);
        assert_eq!(clipped[0].start_ms, BASE + 2 * HOUR);
        assert_eq!(clipped[0].end_ms, BASE + 5 * HOUR);
    }

    #[test]
    fn clip_drops_spans_outside_window() {
        let spans = vec![LocationSpan {
            start_ms: BASE,
            end_ms: BASE + HOUR,
            world_id: "wrld_a".into(),
            world_name: "Alpha".into(),
            access_bucket: "public".into(),
            inferred: false,
        }];

        assert!(clip_spans(&spans, Some(BASE + 2 * HOUR), BASE + 5 * HOUR).is_empty());
    }
}
