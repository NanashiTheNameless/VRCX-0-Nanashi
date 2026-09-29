use std::collections::BTreeSet;
use vrcx_0_application_core::Result;
use vrcx_0_contracts::activity_page::{ActivityLocationSpan, ActivityPageView, CachedActivityPage};
use vrcx_0_contracts::social_aggregates::{
    CopresenceSummaryInput, CopresenceSummaryOutput, FadingFriendsInput, FadingFriendsOutput,
};
use vrcx_0_core::OwnerId;

pub trait ActivityPageStore {
    fn with_build_lock<T>(
        &self,
        owner: &OwnerId,
        operation: impl FnOnce() -> Result<T>,
    ) -> Result<T>;
    fn source_cursor(&self, owner: &OwnerId) -> Result<String>;
    fn read_cached_page(
        &self,
        owner: &OwnerId,
        range_days: i64,
    ) -> Result<Option<CachedActivityPage>>;
    fn write_cached_page(
        &self,
        owner: &OwnerId,
        range_days: i64,
        payload_version: i64,
        view: &ActivityPageView,
    ) -> Result<()>;
    fn read_instance_spans(
        &self,
        owner: &OwnerId,
        from_ms: Option<i64>,
        to_ms: i64,
    ) -> Result<Vec<ActivityLocationSpan>>;
    fn first_source_created_at(&self, owner: &OwnerId) -> Result<String>;
    fn world_ids_before(&self, owner: &OwnerId, before_ms: i64) -> Result<BTreeSet<String>>;
    fn encountered_user_ids(
        &self,
        owner: &OwnerId,
        from_ms: Option<i64>,
        to_ms: Option<i64>,
    ) -> Result<BTreeSet<String>>;
    fn copresence_summary(&self, input: CopresenceSummaryInput) -> Result<CopresenceSummaryOutput>;
    fn fading_friends(&self, input: FadingFriendsInput) -> Result<FadingFriendsOutput>;
}
