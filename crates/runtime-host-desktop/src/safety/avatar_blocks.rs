use super::*;
use std::sync::atomic::Ordering;

const PAGE_SIZE: usize = 25;

#[derive(Clone)]
pub(super) struct AvatarReview {
    token: String,
    scope: RuntimeAuthScopeSnapshot,
    source: SafetySource,
    updated_at: String,
    entries: BTreeSet<String>,
    policy_revision: u64,
    pub(super) created: Instant,
}

impl SafetyRuntime {
    pub fn avatar_block_preview(
        &self,
        source_id: &str,
        offset: u32,
    ) -> Result<AvatarBlockPreview, String> {
        let scope = self.auth.snapshot();
        if !scope.active {
            return Err("Sign in before reviewing avatar blocks".into());
        }
        let mut state = self.state.lock().unwrap();
        if !state.settings.enabled {
            return Err("Safety checks are disabled".into());
        }
        let source = state
            .settings
            .sources
            .iter()
            .find(|s| {
                s.id == source_id
                    && s.enabled
                    && matches!(
                        s.format,
                        SourceFormat::AvatarIds | SourceFormat::GithubAvatars
                    )
            })
            .cloned()
            .ok_or("Enable an avatar-ID source first")?;
        let cache = state
            .caches
            .iter()
            .find(|c| cache_matches(c, &source) && cache_is_fresh(c))
            .ok_or("Refresh this source successfully before reviewing blocks")?;
        let total = cache.entries.len() as u32;
        let entries: Vec<_> = cache
            .entries
            .iter()
            .skip(offset as usize)
            .take(PAGE_SIZE)
            .map(|id| AvatarBlockEntry {
                id: id.clone(),
                name: vrcx_0_persistence::avatars::avatar_cache_get(&self.db, id.clone())
                    .ok()
                    .flatten()
                    .map(|a| a.name)
                    .unwrap_or_default(),
            })
            .collect();
        let updated_at = cache.updated_at.clone();
        state.revision += 1;
        let token = format!(
            "{}-{}-{}",
            scope.generation,
            state.revision,
            Utc::now().timestamp_micros()
        );
        state.avatar_review = Some(AvatarReview {
            token: token.clone(),
            scope: scope.clone(),
            source: source.clone(),
            updated_at: updated_at.clone(),
            entries: entries.iter().map(|e| e.id.clone()).collect(),
            policy_revision: state.policy_revision,
            created: Instant::now(),
        });
        Ok(AvatarBlockPreview {
            token,
            account_user_id: scope.current_user_id,
            source_name: source.name,
            updated_at,
            offset,
            total,
            entries,
        })
    }

    pub fn cancel_avatar_blocks(&self) {
        self.block_revision.fetch_add(1, Ordering::SeqCst);
        self.state.lock().unwrap().avatar_review = None;
    }

    fn review_current(&self, review: &AvatarReview, revision: u64, id: &str) -> bool {
        if review.created.elapsed() > Duration::from_secs(300)
            || self.block_revision.load(Ordering::SeqCst) != revision
            || !self.auth.snapshot().generation_matches(&review.scope)
        {
            return false;
        }
        let state = self.state.lock().unwrap();
        state.settings.enabled
            && state.policy_revision == review.policy_revision
            && state
                .settings
                .sources
                .iter()
                .any(|s| s == &review.source && s.enabled)
            && state.caches.iter().any(|c| {
                cache_matches(c, &review.source)
                    && c.updated_at == review.updated_at
                    && cache_is_fresh(c)
                    && c.entries.contains(id)
            })
    }

    /// Only IDs explicitly selected from the current preview can be blocked. A refresh never
    /// expands a reviewed batch, and names/image URLs never authorize avatar moderation.
    pub async fn block_reviewed_avatars(
        &self,
        token: &str,
        ids: Vec<String>,
    ) -> Result<Vec<AvatarBlockResult>, String> {
        let _lock = self
            .block_lock
            .try_lock()
            .map_err(|_| "An avatar block batch is already running")?;
        let (api, moderation) = self.api.get().ok_or("Safety API is not ready")?;
        let selected: BTreeSet<_> = ids.iter().cloned().collect();
        let (review, revision) = {
            let mut state = self.state.lock().unwrap();
            let review = state
                .avatar_review
                .as_ref()
                .filter(|r| r.token == token)
                .ok_or("Review this source again; preview expired or was replaced")?;
            if ids.is_empty()
                || ids.len() > PAGE_SIZE
                || selected.len() != ids.len()
                || selected
                    .iter()
                    .any(|id| !valid_id(id, "avtr_") || !review.entries.contains(id))
            {
                return Err("Select up to 25 exact IDs from the current preview".into());
            }
            let review = state.avatar_review.take().unwrap();
            (review, self.block_revision.load(Ordering::SeqCst))
        };
        let existing_request = vrcx_0_vrchat_client::http_api::api_input(
            review.scope.endpoint.clone(),
            "GET",
            "auth/user/avatarmoderations",
            None,
        );
        let existing = tokio::time::timeout(
            Duration::from_secs(15),
            api.execute_guarded(&review.scope, existing_request, VrchatScope::Vrchat, || {
                self.review_current(&review, revision, &ids[0])
            }),
        )
        .await
        .map_err(|_| "Could not load existing avatar blocks: timed out")?
        .map_err(|e| e.to_string())?;
        if !(200..300).contains(&existing.status) {
            return Err(format!(
                "Could not load existing avatar blocks: HTTP {}",
                existing.status
            ));
        }
        let existing: Vec<Value> = serde_json::from_str(&existing.data)
            .map_err(|_| "Invalid avatar moderation response; no changes made")?;
        let already_blocked: BTreeSet<_> = existing
            .iter()
            .filter(|v| v.get("avatarModerationType").and_then(Value::as_str) == Some("block"))
            .filter_map(|v| {
                v.get("targetAvatarId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .collect();
        let mut results = Vec::new();
        let mut stopped = false;
        for id in ids {
            let job = SafetyJob {
                queued_at: Instant::now(),
                scope: review.scope.clone(),
                epoch: 0,
                player_revision: 0,
                policy_revision: review.policy_revision,
                is_join: false,
                location: String::new(),
                created_at: now(),
                user_id: String::new(),
                display_name: String::new(),
                avatar_name: String::new(),
                url: String::new(),
                log_kind: String::new(),
                avatar_id: id.clone(),
            };
            let message = format!("Reviewed global avatar block: {id}");
            if stopped || !self.review_current(&review, revision, &id) {
                let outcome =
                    "not attempted: batch stopped or account/source/settings changed".to_string();
                self.record(
                    &job,
                    "SafetyCommunity",
                    &review.source.name,
                    &message,
                    "block avatar",
                    &outcome,
                );
                results.push(AvatarBlockResult { id, outcome });
                stopped = true;
                continue;
            }
            if already_blocked.contains(&id) {
                self.record(
                    &job,
                    "SafetyCommunity",
                    &review.source.name,
                    &message,
                    "block avatar",
                    "already blocked",
                );
                results.push(AvatarBlockResult {
                    id,
                    outcome: "already blocked".into(),
                });
                continue;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
            let input = vrcx_0_vrchat_client::http_api::api_input(
                review.scope.endpoint.clone(),
                "POST",
                "auth/user/avatarmoderations",
                Some(json!({"avatarModerationType":"block", "targetAvatarId":id})),
            );
            // Persist the attempt before calling the endpoint, including the exact reviewed ID.
            self.record(
                &job,
                "SafetyCommunity",
                &review.source.name,
                &message,
                "block avatar",
                "attempting",
            );
            let result = tokio::time::timeout(
                Duration::from_secs(15),
                api.execute_guarded(&review.scope, input, VrchatScope::Vrchat, || {
                    self.review_current(&review, revision, &id)
                }),
            )
            .await;
            let outcome = match result {
                Ok(Ok(response)) if (200..300).contains(&response.status) => {
                    moderation.invalidate();
                    "success".to_string()
                }
                Ok(Ok(response)) => {
                    stopped = true;
                    format!("failed: HTTP {}; remaining blocks stopped", response.status)
                }
                Ok(Err(error)) => {
                    stopped = true;
                    format!("failed or cancelled: {error}")
                }
                Err(_) => {
                    stopped = true;
                    "outcome unknown: request timed out; remaining blocks stopped".into()
                }
            };
            self.record(
                &job,
                "SafetyCommunity",
                &review.source.name,
                &message,
                "block avatar",
                &outcome,
            );
            results.push(AvatarBlockResult { id, outcome });
        }
        Ok(results)
    }
}
