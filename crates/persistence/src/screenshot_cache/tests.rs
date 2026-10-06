use super::*;

struct TestDir {
    path: PathBuf,
}

impl TestDir {
    fn new(name: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "vrcx-0-screenshot-cache-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn insert_thumbnail_record(db_path: &Path, thumb_path: &Path, last_used_at: i64) {
    let conn = Connection::open(db_path).unwrap();
    conn.execute(
        "INSERT INTO screenshot_thumbnail_cache (
                thumb_path, source_path, cache_key, size_bytes, modified_at, created_at, last_used_at
             ) VALUES (?1, 'source.png', 'cache-key', 10, 20, 30, ?2)",
        rusqlite::params![path_string(thumb_path), last_used_at],
    )
    .unwrap();
}

fn open_cache(dir: &TestDir) -> MetadataCacheDb {
    MetadataCacheDb::new(&dir.path.join("metadataCache.db")).unwrap()
}

fn store_entries(
    cache: &MetadataCacheDb,
    root: &str,
    entries: &[ScreenshotLibraryEntry],
) -> Result<()> {
    let seen: HashSet<String> = entries.iter().map(|entry| entry.path.clone()).collect();
    cache.replace_library_entries(root, &seen, entries, false)?;
    Ok(())
}

fn library_entry(
    root: &str,
    path: &str,
    folder_path: &str,
    file_name: &str,
) -> ScreenshotLibraryEntry {
    ScreenshotLibraryEntry {
        scan_root: root.into(),
        path: path.into(),
        folder_path: folder_path.into(),
        file_name: file_name.into(),
        size_bytes: 100,
        modified_at: 1000,
        created_at: None,
        width: Some(1920),
        height: Some(1080),
        world_id: None,
        world_name: None,
        captured_at: None,
        captured_at_ms: 1000,
        metadata_json: None,
        error: None,
    }
}

#[test]
fn opening_cache_normalizes_current_absolute_thumbnail_paths() -> Result<()> {
    let dir = TestDir::new("normalize-current");
    let db_path = dir.path.join("metadataCache.db");
    drop(MetadataCacheDb::new(&db_path)?);
    let absolute_path = dir.path.join("ScreenshotThumbs").join("cached.webp");
    insert_thumbnail_record(&db_path, &absolute_path, 42);

    let cache = MetadataCacheDb::new(&db_path)?;
    let entries = cache.thumbnail_cache_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].thumb_path, "cached.webp");
    assert_eq!(entries[0].last_used_at, 42);
    Ok(())
}

#[test]
fn opening_cache_removes_absolute_thumbnail_paths_from_another_directory() -> Result<()> {
    let dir = TestDir::new("normalize-mismatched");
    let db_path = dir.path.join("metadataCache.db");
    drop(MetadataCacheDb::new(&db_path)?);
    let absolute_path = dir.path.join("old-thumbnails").join("cached.webp");
    insert_thumbnail_record(&db_path, &absolute_path, 42);

    let cache = MetadataCacheDb::new(&db_path)?;
    assert!(cache.thumbnail_cache_entries().is_empty());
    Ok(())
}

#[test]
fn folder_tree_for_empty_root_path_is_empty() -> Result<()> {
    let dir = TestDir::new("folder-tree-empty-root");
    let cache = open_cache(&dir);

    let tree = cache.screenshot_folder_tree_for_root("")?;

    assert_eq!(tree.root_path, "");
    assert!(tree.folders.is_empty());
    Ok(())
}

#[test]
fn folder_tree_aggregates_nested_folder_counts_and_keeps_direct_latest_modified() -> Result<()> {
    let dir = TestDir::new("folder-tree-nested");
    let cache = open_cache(&dir);
    let root = dir.path.join("Screenshots");
    let subfolder = root.join("2026-01");
    let root_str = path_string(&root);
    let subfolder_str = path_string(&subfolder);

    let mut entry_root_a = library_entry(
        &root_str,
        &path_string(&root.join("root-a.png")),
        &root_str,
        "root-a.png",
    );
    entry_root_a.modified_at = 1000;
    let mut entry_root_b = library_entry(
        &root_str,
        &path_string(&root.join("root-b.png")),
        &root_str,
        "root-b.png",
    );
    entry_root_b.modified_at = 2000;
    let mut entry_sub_a = library_entry(
        &root_str,
        &path_string(&subfolder.join("sub-a.png")),
        &subfolder_str,
        "sub-a.png",
    );
    entry_sub_a.modified_at = 5000;
    store_entries(
        &cache,
        &root_str,
        &[entry_root_a, entry_root_b, entry_sub_a],
    )?;

    let tree = cache.screenshot_folder_tree_for_root(&root_str)?;
    assert_eq!(tree.folders.len(), 2);

    let root_info = tree
        .folders
        .iter()
        .find(|folder| folder.path == root_str)
        .expect("root folder present");
    assert_eq!(root_info.image_count, 2);
    assert_eq!(root_info.total_image_count, 3);
    assert_eq!(root_info.latest_modified_at, Some(2000));
    assert_eq!(root_info.parent_path, None);

    let sub_info = tree
        .folders
        .iter()
        .find(|folder| folder.path == subfolder_str)
        .expect("subfolder present");
    assert_eq!(sub_info.image_count, 1);
    assert_eq!(sub_info.total_image_count, 1);
    assert_eq!(sub_info.latest_modified_at, Some(5000));
    assert_eq!(sub_info.parent_path, Some(root_str.clone()));
    assert_eq!(sub_info.name, "2026-01");
    Ok(())
}

#[test]
fn folder_tree_includes_root_with_zero_own_images_when_only_subfolders_have_files() -> Result<()> {
    let dir = TestDir::new("folder-tree-empty-direct");
    let cache = open_cache(&dir);
    let root = dir.path.join("Screenshots");
    let subfolder = root.join("2026-02");
    let root_str = path_string(&root);
    let subfolder_str = path_string(&subfolder);

    let entry = library_entry(
        &root_str,
        &path_string(&subfolder.join("only.png")),
        &subfolder_str,
        "only.png",
    );
    store_entries(&cache, &root_str, &[entry])?;

    let tree = cache.screenshot_folder_tree_for_root(&root_str)?;
    let root_info = tree
        .folders
        .iter()
        .find(|folder| folder.path == root_str)
        .expect("root folder present even without direct images");
    assert_eq!(root_info.image_count, 0);
    assert_eq!(root_info.total_image_count, 1);
    assert_eq!(root_info.latest_modified_at, None);
    Ok(())
}

#[test]
fn replace_library_entries_prunes_files_missing_from_seen_when_enabled() -> Result<()> {
    let dir = TestDir::new("replace-prune-enabled");
    let cache = open_cache(&dir);
    let root_str = path_string(&dir.path.join("Screenshots"));
    let entry_a = library_entry(&root_str, "a.png", &root_str, "a.png");
    let entry_b = library_entry(&root_str, "b.png", &root_str, "b.png");
    let full_seen: HashSet<String> = ["a.png".to_string(), "b.png".to_string()]
        .into_iter()
        .collect();
    cache.replace_library_entries(&root_str, &full_seen, &[entry_a.clone(), entry_b], true)?;
    assert_eq!(cache.library_file_states(&root_str).len(), 2);

    let remaining_seen: HashSet<String> = ["a.png".to_string()].into_iter().collect();
    let deleted = cache.replace_library_entries(&root_str, &remaining_seen, &[entry_a], true)?;

    assert_eq!(deleted, 1);
    let states = cache.library_file_states(&root_str);
    assert_eq!(states.len(), 1);
    assert!(states.contains_key("a.png"));
    Ok(())
}

#[test]
fn replace_library_entries_keeps_missing_files_when_pruning_disabled() -> Result<()> {
    let dir = TestDir::new("replace-prune-disabled");
    let cache = open_cache(&dir);
    let root_str = path_string(&dir.path.join("Screenshots"));
    let entry_a = library_entry(&root_str, "a.png", &root_str, "a.png");
    let entry_b = library_entry(&root_str, "b.png", &root_str, "b.png");
    let full_seen: HashSet<String> = ["a.png".to_string(), "b.png".to_string()]
        .into_iter()
        .collect();
    cache.replace_library_entries(&root_str, &full_seen, &[entry_a.clone(), entry_b], true)?;

    let partial_seen: HashSet<String> = ["a.png".to_string()].into_iter().collect();
    let deleted = cache.replace_library_entries(&root_str, &partial_seen, &[entry_a], false)?;

    assert_eq!(deleted, 0);
    assert_eq!(cache.library_file_states(&root_str).len(), 2);
    Ok(())
}

#[test]
fn replace_library_entries_is_idempotent_for_unchanged_entries() -> Result<()> {
    let dir = TestDir::new("replace-idempotent");
    let cache = open_cache(&dir);
    let root_str = path_string(&dir.path.join("Screenshots"));
    let entry = library_entry(&root_str, "a.png", &root_str, "a.png");
    let seen: HashSet<String> = ["a.png".to_string()].into_iter().collect();

    cache.replace_library_entries(&root_str, &seen, std::slice::from_ref(&entry), true)?;
    let deleted = cache.replace_library_entries(&root_str, &seen, &[entry], true)?;

    assert_eq!(deleted, 0);
    let states = cache.library_file_states(&root_str);
    assert_eq!(states.len(), 1);
    let state = states.get("a.png").expect("entry present");
    assert_eq!(state.size_bytes, 100);
    assert_eq!(state.modified_at, 1000);
    assert_eq!(state.index_version, SCREENSHOT_LIBRARY_INDEX_VERSION);
    Ok(())
}

#[test]
fn list_screenshot_folder_images_for_root_filters_by_folder_and_orders_by_file_name() -> Result<()>
{
    let dir = TestDir::new("list-folder-images");
    let cache = open_cache(&dir);
    let root = dir.path.join("Screenshots");
    let folder_a = root.join("A");
    let folder_b = root.join("B");
    let root_str = path_string(&root);
    let folder_a_str = path_string(&folder_a);
    let folder_b_str = path_string(&folder_b);

    let entries = vec![
        library_entry(
            &root_str,
            &path_string(&folder_a.join("b.png")),
            &folder_a_str,
            "b.png",
        ),
        library_entry(
            &root_str,
            &path_string(&folder_a.join("a.png")),
            &folder_a_str,
            "a.png",
        ),
        library_entry(
            &root_str,
            &path_string(&folder_b.join("c.png")),
            &folder_b_str,
            "c.png",
        ),
    ];
    store_entries(&cache, &root_str, &entries)?;

    let images = cache.list_screenshot_folder_images_for_root(&root_str, &folder_a_str)?;

    assert_eq!(images.len(), 2);
    assert_eq!(images[0].file_name, "a.png");
    assert_eq!(images[1].file_name, "b.png");
    Ok(())
}

#[test]
fn screenshot_library_navigation_crosses_folders_without_wrapping() -> Result<()> {
    let dir = TestDir::new("library-navigation");
    let cache = open_cache(&dir);
    let root = dir.path.join("Screenshots");
    let folder_a = root.join("A");
    let folder_b = root.join("B");
    let root_str = path_string(&root);
    let folder_a_str = path_string(&folder_a);
    let folder_b_str = path_string(&folder_b);
    let a = path_string(&folder_a.join("a.png"));
    let b = path_string(&folder_a.join("b.png"));
    let c = path_string(&folder_b.join("c.png"));
    let d = path_string(&folder_b.join("d.png"));
    let entries = vec![
        library_entry(&root_str, &d, &folder_b_str, "d.png"),
        library_entry(&root_str, &b, &folder_a_str, "b.png"),
        library_entry(&root_str, &c, &folder_b_str, "c.png"),
        library_entry(&root_str, &a, &folder_a_str, "a.png"),
    ];
    store_entries(&cache, &root_str, &entries)?;

    let first = cache.screenshot_library_navigation_for_root(&root_str, &a)?;
    assert_eq!(first.as_ref().and_then(|item| item.previous.as_ref()), None);
    assert_eq!(
        first
            .as_ref()
            .and_then(|item| item.next.as_ref())
            .map(|item| item.path.as_str()),
        Some(b.as_str())
    );

    let boundary = cache.screenshot_library_navigation_for_root(&root_str, &c)?;
    assert_eq!(
        boundary.and_then(|item| item.previous),
        Some(ScreenshotLibraryNeighbor {
            path: b,
            folder_path: folder_a_str,
        })
    );

    let last = cache.screenshot_library_navigation_for_root(&root_str, &d)?;
    assert_eq!(last.and_then(|item| item.next), None);
    assert_eq!(
        cache.screenshot_library_navigation_for_root(&root_str, "missing.png")?,
        None
    );
    Ok(())
}

#[test]
fn list_world_screenshots_for_root_filters_by_world_id() -> Result<()> {
    let dir = TestDir::new("list-world-screenshots");
    let cache = open_cache(&dir);
    let root_str = path_string(&dir.path.join("Screenshots"));

    let mut entry_world_a = library_entry(&root_str, "a.png", &root_str, "a.png");
    entry_world_a.world_id = Some("wrld_a".into());
    let mut entry_world_b = library_entry(&root_str, "b.png", &root_str, "b.png");
    entry_world_b.world_id = Some("wrld_b".into());
    store_entries(&cache, &root_str, &[entry_world_a, entry_world_b])?;

    let images = cache.list_world_screenshots_for_root(&root_str, "wrld_a")?;

    assert_eq!(images.len(), 1);
    assert_eq!(images[0].path, "a.png");
    assert_eq!(images[0].world_id.as_deref(), Some("wrld_a"));
    Ok(())
}

#[test]
fn list_screenshots_in_windows_counts_and_limits_each_window() -> Result<()> {
    let dir = TestDir::new("list-window-screenshots");
    let cache = open_cache(&dir);
    let root_str = path_string(&dir.path.join("Screenshots"));
    let entries = [100, 200, 300, 900]
        .into_iter()
        .map(|captured_at_ms| {
            let name = format!("{captured_at_ms}.png");
            let mut entry = library_entry(&root_str, &name, &root_str, &name);
            entry.captured_at_ms = captured_at_ms;
            entry
        })
        .collect::<Vec<_>>();
    store_entries(&cache, &root_str, &entries)?;

    let windows = cache.list_screenshots_in_windows_for_root(
        &root_str,
        &[
            ScreenshotTimeWindow {
                from_ms: 100,
                to_ms: 300,
            },
            ScreenshotTimeWindow {
                from_ms: 400,
                to_ms: 800,
            },
        ],
        2,
    )?;

    assert_eq!(windows[0].total, 3);
    assert_eq!(
        windows[0]
            .images
            .iter()
            .map(|image| image.captured_at_ms)
            .collect::<Vec<_>>(),
        vec![100, 200]
    );
    assert_eq!(windows[1].total, 0);
    assert!(windows[1].images.is_empty());
    Ok(())
}

#[test]
fn record_thumbnail_cache_upserts_existing_entry_by_thumb_path() {
    let dir = TestDir::new("thumbnail-upsert");
    let cache = open_cache(&dir);

    cache.record_thumbnail_cache("source-1.png", "thumb.webp", "key-1", 100, 1000);
    cache.record_thumbnail_cache("source-2.png", "thumb.webp", "key-2", 200, 2000);

    let entries = cache.thumbnail_cache_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].source_path, "source-2.png");
    assert_eq!(entries[0].cache_key, "key-2");
    assert_eq!(entries[0].size_bytes, 200);
    assert_eq!(entries[0].modified_at, 2000);
}

#[test]
fn thumbnail_cache_entries_for_source_filters_by_source_path() {
    let dir = TestDir::new("thumbnail-by-source");
    let cache = open_cache(&dir);
    cache.record_thumbnail_cache("source-1.png", "thumb-1.webp", "key-1", 100, 1000);
    cache.record_thumbnail_cache("source-1.png", "thumb-1-alt.webp", "key-1", 100, 1000);
    cache.record_thumbnail_cache("source-2.png", "thumb-2.webp", "key-2", 100, 1000);

    let entries = cache.thumbnail_cache_entries_for_source("source-1.png");

    assert_eq!(entries.len(), 2);
    assert!(entries
        .iter()
        .all(|entry| entry.source_path == "source-1.png"));
}

#[test]
fn delete_thumbnail_cache_record_removes_only_matching_entry() {
    let dir = TestDir::new("thumbnail-delete");
    let cache = open_cache(&dir);
    cache.record_thumbnail_cache("source-1.png", "thumb-1.webp", "key-1", 100, 1000);
    cache.record_thumbnail_cache("source-2.png", "thumb-2.webp", "key-2", 100, 1000);

    cache.delete_thumbnail_cache_record("thumb-1.webp");

    let entries = cache.thumbnail_cache_entries();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].thumb_path, "thumb-2.webp");
}

#[test]
fn clear_all_removes_metadata_library_and_thumbnail_records() -> Result<()> {
    let dir = TestDir::new("clear-all");
    let cache = open_cache(&dir);
    let root_str = path_string(&dir.path.join("Screenshots"));
    cache.bulk_add(&[("file.png".to_string(), Some("{}".to_string()))]);
    let entry = library_entry(&root_str, "a.png", &root_str, "a.png");
    store_entries(&cache, &root_str, &[entry])?;
    cache.record_thumbnail_cache("a.png", "thumb.webp", "key", 100, 1000);

    cache.clear_all();

    assert!(!cache.is_cached("file.png"));
    assert!(cache.library_file_states(&root_str).is_empty());
    assert!(cache.thumbnail_cache_entries().is_empty());
    Ok(())
}

#[test]
fn delete_screenshot_entry_removes_index_and_metadata_cache_rows() -> Result<()> {
    let dir = TestDir::new("delete-entry");
    let cache = open_cache(&dir);
    let root_str = path_string(&dir.path.join("Screenshots"));
    cache.bulk_add(&[
        ("a.png".to_string(), Some("{}".to_string())),
        ("b.png".to_string(), Some("{}".to_string())),
    ]);
    store_entries(
        &cache,
        &root_str,
        &[
            library_entry(&root_str, "a.png", &root_str, "a.png"),
            library_entry(&root_str, "b.png", &root_str, "b.png"),
        ],
    )?;

    cache.delete_screenshot_entry("a.png")?;

    assert!(!cache.is_cached("a.png"));
    assert!(cache.is_cached("b.png"));
    let states = cache.library_file_states(&root_str);
    assert_eq!(states.len(), 1);
    assert!(states.contains_key("b.png"));
    Ok(())
}
