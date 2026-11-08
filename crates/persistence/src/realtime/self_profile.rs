use crate::common::{affected_count, row_string, ParamsBuilder};
use crate::database::DatabaseWriteTransaction;
use crate::Error;

use super::types::SelfProfileObservation;

pub(crate) fn observe_self_profile_field(
    tx: &mut DatabaseWriteTransaction<'_>,
    user_prefix: &str,
    observation: &SelfProfileObservation,
) -> Result<u64, Error> {
    let settings = crate::profile_history::settings_in_transaction(tx)?;
    let enabled = match observation.field {
        vrcx_0_contracts::realtime::SelfProfileField::Status
        | vrcx_0_contracts::realtime::SelfProfileField::StatusDescription => {
            settings.status.recording
        }
        vrcx_0_contracts::realtime::SelfProfileField::Bio => settings.bio.recording,
    };
    if !enabled {
        return Ok(0);
    }
    let field = observation.field.as_str();
    let previous_value = tx
        .execute(
            &format!(
                "SELECT value FROM {user_prefix}_self_profile_log WHERE field = @field ORDER BY id DESC LIMIT 1"
            ),
            &ParamsBuilder::new().set("field", field).build(),
        )?
        .first()
        .map(|row| row_string(row, 0));
    if previous_value.as_deref() == Some(observation.value.as_str()) {
        return Ok(0);
    }
    let inserted = tx.execute_non_query(
        &format!(
            "INSERT INTO {user_prefix}_self_profile_log (created_at, field, value, previous_value)
             VALUES (@created_at, @field, @value, @previous_value)"
        ),
        &ParamsBuilder::new()
            .set("created_at", observation.observed_at)
            .set("field", field)
            .set("value", observation.value.clone())
            .set("previous_value", previous_value.unwrap_or_default())
            .build(),
    )?;
    super::drop_synced_copies_near(
        tx,
        user_prefix,
        "self_profile_log",
        field,
        observation.observed_at,
    )?;
    Ok(affected_count(inserted))
}
