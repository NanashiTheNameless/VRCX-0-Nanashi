use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use moka::future::Cache;
use serde_json::Value;
use vrcx_0_application_core::{
    sleep_until_due_or_stopped, RuntimeAuthScopeSnapshot, TaskSupervisor,
};

const FAVORITE_WORLD_CARD_TIME_TO_IDLE: Duration = Duration::from_secs(30 * 60);
const FAVORITE_WORLD_CARD_HOUSEKEEPING_INTERVAL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Debug)]
pub(super) struct FavoriteWorldCard {
    payload: Option<Arc<str>>,
    availability: Option<String>,
}

impl FavoriteWorldCard {
    pub(super) fn resolved(payload: &Value, availability: Option<String>) -> Self {
        Self {
            payload: serde_json::to_string(payload).ok().map(Arc::from),
            availability,
        }
    }

    pub(super) fn deleted() -> Self {
        Self {
            payload: None,
            availability: Some("deleted".to_string()),
        }
    }

    pub(super) fn payload(&self) -> Option<Value> {
        serde_json::from_str(self.payload.as_deref()?).ok()
    }

    pub(super) fn availability(&self) -> Option<&str> {
        self.availability.as_deref()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct FavoriteWorldCardScope {
    endpoint: String,
    generation: u64,
}

impl From<&RuntimeAuthScopeSnapshot> for FavoriteWorldCardScope {
    fn from(snapshot: &RuntimeAuthScopeSnapshot) -> Self {
        Self {
            endpoint: snapshot.endpoint.clone(),
            generation: snapshot.generation,
        }
    }
}

pub(super) struct FavoriteWorldCardCache {
    cards: Cache<String, Arc<FavoriteWorldCard>>,
    scope: Mutex<Option<FavoriteWorldCardScope>>,
    synced_tags: Mutex<HashSet<String>>,
    housekeeping_started: AtomicBool,
}

impl FavoriteWorldCardCache {
    pub(super) fn new() -> Self {
        Self {
            cards: Cache::builder()
                .time_to_idle(FAVORITE_WORLD_CARD_TIME_TO_IDLE)
                .build(),
            scope: Mutex::new(None),
            synced_tags: Mutex::new(HashSet::new()),
            housekeeping_started: AtomicBool::new(false),
        }
    }

    pub(super) async fn enter_scope(&self, snapshot: &RuntimeAuthScopeSnapshot) {
        let next = FavoriteWorldCardScope::from(snapshot);
        let changed = {
            let mut current = self.scope.lock().unwrap_or_else(|error| error.into_inner());
            let changed = current.as_ref().is_some_and(|scope| *scope != next);
            *current = Some(next);
            changed
        };
        if changed {
            self.invalidate_all().await;
        }
    }

    pub(super) async fn invalidate_all(&self) {
        self.synced_tags
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
        self.cards.invalidate_all();
        self.cards.run_pending_tasks().await;
    }

    pub(super) fn mark_tag_synced(&self, tag: &str) {
        self.synced_tags
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(tag.to_string());
    }

    pub(super) fn unsynced_tags(&self, tags: Vec<String>) -> Vec<String> {
        let synced = self
            .synced_tags
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        tags.into_iter()
            .filter(|tag| !synced.contains(tag))
            .collect()
    }

    pub(super) async fn get(&self, world_id: &str) -> Option<Arc<FavoriteWorldCard>> {
        self.cards.get(world_id).await
    }

    pub(super) async fn insert(&self, world_id: String, card: FavoriteWorldCard) {
        self.cards.insert(world_id, Arc::new(card)).await;
    }

    pub(super) fn start_housekeeping(self: &Arc<Self>, tasks: &TaskSupervisor) {
        if self.housekeeping_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let cache = Arc::clone(self);
        tasks.spawn_cancellable(move |stop_token| async move {
            while sleep_until_due_or_stopped(FAVORITE_WORLD_CARD_HOUSEKEEPING_INTERVAL, &stop_token)
                .await
            {
                cache.cards.run_pending_tasks().await;
                if cache.cards.entry_count() == 0 {
                    break;
                }
            }
            cache.housekeeping_started.store(false, Ordering::Release);
        });
    }
}
