#![allow(non_snake_case)]

use vrcx_0_runtime_host_desktop::adoption_census::{adoption_census_lock, AdoptionCensusLock};

#[tauri::command(async)]
#[specta::specta]
pub fn app__adoption_census_lock() -> Option<AdoptionCensusLock> {
    adoption_census_lock()
}
