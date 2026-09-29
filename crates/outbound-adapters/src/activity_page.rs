use std::collections::BTreeSet;
use vrcx_0_application_activity::activity_page::ActivityPageStore;
use vrcx_0_application_core::Result;
use vrcx_0_contracts::activity_page::{ActivityLocationSpan, ActivityPageView, CachedActivityPage};
use vrcx_0_contracts::social_aggregates::{
    CopresenceSummaryInput, CopresenceSummaryOutput, FadingFriendsInput, FadingFriendsOutput,
};
use vrcx_0_core::OwnerId;
use vrcx_0_persistence::{activity_page, social_aggregates, DatabaseService};

pub struct LocalActivityPageStore<'a> {
    db: &'a DatabaseService,
}

impl<'a> LocalActivityPageStore<'a> {
    pub fn new(db: &'a DatabaseService) -> Self {
        Self { db }
    }
}

impl ActivityPageStore for LocalActivityPageStore<'_> {
    fn with_build_lock<T>(
        &self,
        owner: &OwnerId,
        operation: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        activity_page::with_activity_page_build_lock(self.db, owner.as_str(), operation)
    }
    fn source_cursor(&self, owner: &OwnerId) -> Result<String> {
        Ok(activity_page::source_cursor(self.db, owner)?)
    }
    fn read_cached_page(
        &self,
        owner: &OwnerId,
        range_days: i64,
    ) -> Result<Option<CachedActivityPage>> {
        Ok(activity_page::read_cached_page(self.db, owner, range_days)?)
    }
    fn write_cached_page(
        &self,
        owner: &OwnerId,
        range_days: i64,
        payload_version: i64,
        view: &ActivityPageView,
    ) -> Result<()> {
        Ok(activity_page::write_cached_page(
            self.db,
            owner,
            range_days,
            payload_version,
            view,
        )?)
    }
    fn read_instance_spans(
        &self,
        owner: &OwnerId,
        from_ms: Option<i64>,
        to_ms: i64,
    ) -> Result<Vec<ActivityLocationSpan>> {
        Ok(activity_page::read_instance_spans(
            self.db, owner, from_ms, to_ms,
        )?)
    }
    fn first_source_created_at(&self, owner: &OwnerId) -> Result<String> {
        Ok(activity_page::first_source_created_at(self.db, owner)?)
    }
    fn world_ids_before(&self, owner: &OwnerId, before_ms: i64) -> Result<BTreeSet<String>> {
        Ok(activity_page::world_ids_before(self.db, owner, before_ms)?)
    }
    fn encountered_user_ids(
        &self,
        owner: &OwnerId,
        from_ms: Option<i64>,
        to_ms: Option<i64>,
    ) -> Result<BTreeSet<String>> {
        Ok(activity_page::encountered_user_ids(
            self.db, owner, from_ms, to_ms,
        )?)
    }
    fn copresence_summary(&self, input: CopresenceSummaryInput) -> Result<CopresenceSummaryOutput> {
        Ok(social_aggregates::get_copresence_summary(self.db, input)?)
    }
    fn fading_friends(&self, input: FadingFriendsInput) -> Result<FadingFriendsOutput> {
        Ok(social_aggregates::get_fading_friends(self.db, input)?)
    }
}
