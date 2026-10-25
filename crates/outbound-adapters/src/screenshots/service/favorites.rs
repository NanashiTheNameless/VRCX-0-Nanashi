use std::collections::HashSet;

use vrcx_0_core::screenshots::FavoriteScreenshots;
use vrcx_0_media::media_files::file_sha256_hex;
use vrcx_0_persistence::screenshot_favorites as store;
use vrcx_0_persistence::DatabaseService;

use super::{Error, MetadataCacheDb, Path, Result};
use crate::map_persistence_error;

fn file_fingerprint(path: &Path) -> Result<(i64, String)> {
    let size_bytes = std::fs::metadata(path).map_err(Error::Io)?.len() as i64;
    let sha256 = file_sha256_hex(path).map_err(|error| match error {
        vrcx_0_media::Error::Io(error) => Error::Io(error),
        vrcx_0_media::Error::Custom(message) => Error::Custom(message),
    })?;
    Ok((size_bytes, sha256))
}

pub fn set_screenshot_favorite(db: &DatabaseService, path: &str, favorite: bool) -> Result<()> {
    if !favorite {
        return store::remove_screenshot_favorite(db, path).map_err(map_persistence_error);
    }
    let (size_bytes, sha256) = file_fingerprint(Path::new(path))?;
    store::add_screenshot_favorite(db, path, size_bytes, &sha256).map_err(map_persistence_error)
}

pub fn forget_screenshot_favorite(db: &DatabaseService, path: &str) -> Result<()> {
    store::remove_screenshot_favorite(db, path).map_err(map_persistence_error)
}

pub fn forget_missing_screenshot_favorites(db: &DatabaseService) -> Result<u32> {
    let mut removed = 0u32;
    for favorite in store::list_screenshot_favorites(db).map_err(map_persistence_error)? {
        if Path::new(&favorite.path).is_file() {
            continue;
        }
        store::remove_screenshot_favorite(db, &favorite.path).map_err(map_persistence_error)?;
        removed = removed.saturating_add(1);
    }
    Ok(removed)
}

pub fn refresh_screenshot_favorite(db: &DatabaseService, path: &str) -> Result<()> {
    let Some(favorite) = store::get_screenshot_favorite(db, path).map_err(map_persistence_error)?
    else {
        return Ok(());
    };
    let (size_bytes, sha256) = file_fingerprint(Path::new(path))?;
    store::update_screenshot_favorite_file(db, favorite.id, path, size_bytes, &sha256)
        .map_err(map_persistence_error)
}

pub fn refresh_all_screenshot_favorites(db: &DatabaseService) -> Result<()> {
    for favorite in store::list_screenshot_favorites(db).map_err(map_persistence_error)? {
        let Ok((size_bytes, sha256)) = file_fingerprint(Path::new(&favorite.path)) else {
            continue;
        };
        store::update_screenshot_favorite_file(
            db,
            favorite.id,
            &favorite.path,
            size_bytes,
            &sha256,
        )
        .map_err(map_persistence_error)?;
    }
    Ok(())
}

pub fn list_favorite_screenshots(
    db: &DatabaseService,
    cache: &MetadataCacheDb,
    root_path: &str,
) -> Result<FavoriteScreenshots> {
    let favorites = store::list_screenshot_favorites(db).map_err(map_persistence_error)?;
    let paths = favorites
        .iter()
        .map(|favorite| favorite.path.clone())
        .collect::<Vec<_>>();
    let images = cache.list_library_images_by_paths_for_root(root_path, &paths)?;
    let missing_count = paths
        .iter()
        .filter(|path| !Path::new(path).is_file())
        .count();
    Ok(FavoriteScreenshots {
        missing_count: u32::try_from(missing_count).unwrap_or(u32::MAX),
        paths,
        images,
    })
}

pub fn relink_missing_screenshot_favorites(
    db: &DatabaseService,
    cache: &MetadataCacheDb,
    root_path: &str,
) -> Result<usize> {
    let favorites = store::list_screenshot_favorites(db).map_err(map_persistence_error)?;
    let favorite_paths = favorites
        .iter()
        .map(|favorite| favorite.path.clone())
        .collect::<HashSet<_>>();
    let mut claimed_paths = HashSet::new();
    let mut relinked = 0;

    for favorite in favorites
        .iter()
        .filter(|favorite| !Path::new(&favorite.path).is_file())
    {
        for candidate in
            cache.list_library_paths_with_size_for_root(root_path, favorite.size_bytes)?
        {
            if favorite_paths.contains(&candidate) || claimed_paths.contains(&candidate) {
                continue;
            }
            let Ok((size_bytes, sha256)) = file_fingerprint(Path::new(&candidate)) else {
                continue;
            };
            if size_bytes != favorite.size_bytes || sha256 != favorite.sha256 {
                continue;
            }
            store::update_screenshot_favorite_file(
                db,
                favorite.id,
                &candidate,
                size_bytes,
                &sha256,
            )
            .map_err(map_persistence_error)?;
            claimed_paths.insert(candidate);
            relinked += 1;
            break;
        }
    }

    Ok(relinked)
}

#[cfg(test)]
mod tests;
