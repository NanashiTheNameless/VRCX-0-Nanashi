use futures_util::future::BoxFuture;

use vrcx_0_application_core::Result;
use vrcx_0_contracts::world_collections::WorldCollectionSnapshotResponse;

pub type WorldCollectionFuture<'a, T> = BoxFuture<'a, Result<T>>;

pub trait WorldCollectionRemote: Send + Sync {
    fn fetch_collection<'a>(
        &'a self,
        id: &'a str,
    ) -> WorldCollectionFuture<'a, WorldCollectionSnapshotResponse>;
}
