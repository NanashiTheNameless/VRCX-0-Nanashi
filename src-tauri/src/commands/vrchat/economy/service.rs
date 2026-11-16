#![allow(non_snake_case)]

use tauri::State;
use vrcx_0_contracts::vrchat_api::VrchatResponse;

use crate::error::AppError;
use crate::state::AppState;

use super::types::{
    VrchatEconomyClaimFreeListingInput, VrchatEconomyPageInput, VrchatEconomyPurchasesInput,
    VrchatEconomyStoreInput, VrchatEconomyTransactionsInput, VrchatEconomyUserInput,
};

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_economy_licensed_avatars_get(
    state: State<'_, AppState>,
    input: VrchatEconomyPageInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .licensed_avatars(input.n, input.offset)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_economy_purchases_get(
    state: State<'_, AppState>,
    input: VrchatEconomyPurchasesInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .economy_purchases(input.buyer_id, input.n, input.offset)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_economy_transactions_get(
    state: State<'_, AppState>,
    input: VrchatEconomyTransactionsInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .economy_transactions(input.user_id, input.n)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_economy_balance_get(
    state: State<'_, AppState>,
    input: VrchatEconomyUserInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .economy_balance(input.user_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_economy_store_get(
    state: State<'_, AppState>,
    input: VrchatEconomyStoreInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .economy_store(input.store_id)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_economy_store_shelves_get(
    state: State<'_, AppState>,
    input: VrchatEconomyStoreInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .economy_store_shelves(input.store_id)
        .await
        .map_err(AppError::from)
}

/// Fork (from VRCX): claims a free store item. The price sent is always 0.
#[tauri::command]
#[specta::specta]
pub async fn app__vrchat_economy_claim_free_listing(
    state: State<'_, AppState>,
    input: VrchatEconomyClaimFreeListingInput,
) -> Result<VrchatResponse, AppError> {
    state
        .runtime_host()
        .vrchat_remote()
        .economy_claim_free_listing(input.listing_id)
        .await
        .map_err(AppError::from)
}
