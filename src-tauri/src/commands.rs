use crate::backup::{backup_paths, make_archive_path, restore_archive};
use crate::compressor::{compress_shader_target, decompress_shader_target, get_vault_directory};
use crate::db::{Database, TrashRecord};
use crate::everything::{find_everything_install, EverythingClient};
use crate::libraries::epic::EpicLibrary;
use crate::libraries::gog::GogLibrary;
use crate::libraries::steam::SteamLibrary;
use crate::libraries::GameLibrary;
use crate::matcher::Matcher;
use crate::scanners::dxvk::DxvkScanner;
use crate::scanners::exe_scanner::ExeScanner;
use crate::scanners::gpu_drivers::{AmdScanner, IntelScanner, NvidiaScanner};
use crate::scanners::steam_cache::SteamCacheScanner;
use crate::scanners::CacheScanner;
use crate::steam_api::SteamApiClient;
use crate::types::*;
use crate::utils::{is_path_locked, validate_path_allowed};

use chrono::Utc;
use log::{error, info};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone)]
pub struct ActiveSessionInfo {
    pub game_id: String,
    pub started_at: Instant,
}

pub struct AppState {
    pub db: Mutex<Database>,
    pub active_session: Mutex<HashMap<String, ActiveSessionInfo>>,
}

#[cfg(windows)]
pub fn is_exe_running(exe_name: &str) -> bool {
    use std::ffi::c_void;
    type HANDLE = *mut c_void;
    type DWORD = u32;
    type BOOL = i32;

    #[repr(C)]
    struct PROCESSENTRY32W {
        dw_size: DWORD,
        cnt_usage: DWORD,
        th32_process_id: DWORD,
        th32_default_heap_id: usize,
        th32_module_id: DWORD,
        cnt_threads: DWORD,
        th32_parent_process_id: DWORD,
        pc_pri_class_base: i32,
        dw_flags: DWORD,
        sz_exe_file: [u16; 260],
    }

    extern "system" {
        fn CreateToolhelp32Snapshot(dw_flags: DWORD, th32_process_id: DWORD) -> HANDLE;
        fn Process32FirstW(h_snapshot: HANDLE, lppe: *mut PROCESSENTRY32W) -> BOOL;
        fn Process32NextW(h_snapshot: HANDLE, lppe: *mut PROCESSENTRY32W) -> BOOL;
        fn CloseHandle(h_object: HANDLE) -> BOOL;
    }

    const TH32CS_SNAPPROCESS: DWORD = 0x00000002;
    let target = exe_name.to_lowercase();

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot.is_null() || snapshot == -1isize as HANDLE {
            return false;
        }

        let mut entry = PROCESSENTRY32W {
            dw_size: std::mem::size_of::<PROCESSENTRY32W>() as DWORD,
            cnt_usage: 0,
            th32_process_id: 0,
            th32_default_heap_id: 0,
            th32_module_id: 0,
            cnt_threads: 0,
            th32_parent_process_id: 0,
            pc_pri_class_base: 0,
            dw_flags: 0,
            sz_exe_file: [0; 260],
        };

        let mut found = false;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let len = entry
                    .sz_exe_file
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(260);
                let name = String::from_utf16_lossy(&entry.sz_exe_file[..len]);
                if name.to_lowercase() == target {
                    found = true;
                    break;
                }
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
        found
    }
}

#[cfg(not(windows))]
pub fn is_exe_running(_exe_name: &str) -> bool {
    false
}

static SCAN_RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub async fn run_scan(app: AppHandle, state: State<'_, AppState>) -> Result<ScanResult, AppError> {
    if SCAN_RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Err(AppError::Other("A scan is already in progress".into()));
    }

    struct ScanGuard;
    impl Drop for ScanGuard {
        fn drop(&mut self) {
            SCAN_RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let _guard = ScanGuard;

    let start = Instant::now();
    eprintln!("[CMD] >>> run_scan received! <<<");
    info!("[cmd] run_scan started");

    let emit = {
        let app = app.clone();
        move |stage: &str, found: usize, bytes: u64| {
            eprintln!("[PROGRESS] {stage} (found: {found}, bytes: {bytes})");
            let _ = app.emit(
                "scan-progress",
                ScanProgress {
                    stage: stage.to_string(),
                    current_path: None,
                    items_found: found,
                    bytes_found: bytes,
                },
            );
        }
    };

    emit("Detecting game libraries…", 0, 0);
    let mut all_games: Vec<DetectedGame> = tokio::task::spawn_blocking(|| {
        eprintln!("[Phase 1] Starting game library detection...");
        let mut games = Vec::new();
        games.extend(SteamLibrary.detect());
        games.extend(EpicLibrary.detect());
        games.extend(GogLibrary.detect());
        eprintln!("[Phase 1] Game detection done: {} games found", games.len());
        games
    })
    .await
    .map_err(|e| AppError::Other(format!("Library scan panic: {e}")))?;

    {
        if let Ok(db) = state.db.lock() {
            if let Ok(saved_games) = db.get_all_games() {
                for saved in saved_games {
                    if saved.platform == GamePlatform::Custom {
                        all_games.push(saved);
                    } else if let Some(existing) = all_games.iter_mut().find(|g| g.id == saved.id) {
                        if existing.cover_url.is_none() && saved.cover_url.is_some() {
                            existing.cover_url = saved.cover_url;
                        }
                        if existing.hero_url.is_none() && saved.hero_url.is_some() {
                            existing.hero_url = saved.hero_url;
                        }
                        if existing.logo_url.is_none() && saved.logo_url.is_some() {
                            existing.logo_url = saved.logo_url;
                        }
                        if existing.description.is_none() && saved.description.is_some() {
                            existing.description = saved.description;
                        }
                        if existing.genres.is_empty() && !saved.genres.is_empty() {
                            existing.genres = saved.genres;
                        }
                    }
                }
            }
        }
    }

    deduplicate_games(&mut all_games);

    if let Ok(db) = state.db.lock() {
        if let Ok(excluded) = db.get_excluded_game_ids() {
            if !excluded.is_empty() {
                all_games.retain(|g| {
                    if excluded.contains(&g.id) {
                        return false;
                    }
                    if let Some(ref app_id) = g.app_id {
                        if !app_id.is_empty() && excluded.contains(app_id) {
                            return false;
                        }
                    }
                    if let Some(ref exe_path) = g.exe_path {
                        let norm = exe_path.to_lowercase().replace('/', "\\");
                        if excluded.contains(&norm) {
                            return false;
                        }
                    }
                    true
                });
            }
        }
    }

    for game in &mut all_games {
        if let Some(app_id) = &game.app_id {
            if game.cover_url.is_none()
                || game
                    .cover_url
                    .as_ref()
                    .map(|s| s.is_empty())
                    .unwrap_or(true)
            {
                game.cover_url = Some(SteamApiClient::get_cdn_cover_url(app_id));
            }
            if game.hero_url.is_none()
                || game.hero_url.as_ref().map(|s| s.is_empty()).unwrap_or(true)
            {
                game.hero_url = Some(SteamApiClient::get_cdn_hero_url(app_id));
            }
            if game.logo_url.is_none()
                || game.logo_url.as_ref().map(|s| s.is_empty()).unwrap_or(true)
            {
                game.logo_url = Some(SteamApiClient::get_cdn_logo_url(app_id));
            }
        }
    }

    emit(
        &format!("Game libraries scanned ({} games)", all_games.len()),
        all_games.len(),
        0,
    );

    emit("Scanning GPU driver caches…", all_games.len(), 0);
    let gpu_caches: Vec<CacheEntry> = tokio::task::spawn_blocking(|| {
        eprintln!("[Phase 2] Scanning GPU caches...");
        let mut entries = Vec::new();
        entries.extend(NvidiaScanner.scan());
        entries.extend(AmdScanner.scan());
        entries.extend(IntelScanner.scan());
        eprintln!("[Phase 2] GPU caches done: {} found", entries.len());
        entries
    })
    .await
    .map_err(|e| AppError::Other(format!("GPU scan panic: {e}")))?;

    emit("GPU driver caches scanned", gpu_caches.len(), 0);

    emit("Scanning Steam shader caches…", gpu_caches.len(), 0);
    let steam_paths = tokio::task::spawn_blocking(SteamLibrary::get_library_paths)
        .await
        .unwrap_or_default();
    let steam_paths_clone = steam_paths.clone();
    let steam_caches: Vec<CacheEntry> = tokio::task::spawn_blocking(move || {
        eprintln!("[Phase 3] Scanning Steam shader caches...");
        let entries = SteamCacheScanner {
            steam_libraries: steam_paths_clone,
        }
        .scan();
        eprintln!("[Phase 3] Steam caches done: {} found", entries.len());
        entries
    })
    .await
    .map_err(|e| AppError::Other(format!("Steam cache scan panic: {e}")))?;

    emit(
        "Scanning DXVK/VKD3D caches…",
        gpu_caches.len() + steam_caches.len(),
        0,
    );
    let install_dirs: Vec<PathBuf> = all_games
        .iter()
        .map(|g| PathBuf::from(&g.install_path))
        .filter(|p| p.exists())
        .collect();
    let dxvk_caches: Vec<CacheEntry> = tokio::task::spawn_blocking(move || {
        eprintln!(
            "[Phase 4] Scanning DXVK/VKD3D in {} dirs...",
            install_dirs.len()
        );
        let entries = DxvkScanner {
            game_install_dirs: install_dirs,
        }
        .scan();
        eprintln!("[Phase 4] DXVK done: {} found", entries.len());
        entries
    })
    .await
    .map_err(|e| AppError::Other(format!("DXVK scan panic: {e}")))?;

    let mut all_caches = Vec::new();
    all_caches.extend(gpu_caches);
    all_caches.extend(steam_caches);
    all_caches.extend(dxvk_caches);

    emit(
        &format!("Cache scan complete ({} entries)", all_caches.len()),
        all_caches.len(),
        0,
    );

    emit("Matching caches to games…", all_caches.len(), 0);
    let games_for_match = all_games.clone();
    let mut caches_for_match = all_caches.clone();
    let (grouped, unmatched) = tokio::task::spawn_blocking(move || {
        eprintln!("[Phase 5] Matching caches to games...");
        let res = Matcher::new().associate(&games_for_match, &mut caches_for_match);
        eprintln!("[Phase 5] Matching done");
        res
    })
    .await
    .map_err(|e| AppError::Other(format!("Matcher panic: {e}")))?;

    emit("Saving results…", all_caches.len(), 0);
    {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        for game in &all_games {
            db.upsert_game(game)
                .unwrap_or_else(|e| error!("[DB] upsert_game: {e}"));
        }
        for cache in &all_caches {
            db.upsert_cache_entry(cache)
                .unwrap_or_else(|e| error!("[DB] upsert_cache: {e}"));
        }
    }

    let gpu_sources = [
        CacheSource::NvidiaDx,
        CacheSource::NvidiaGl,
        CacheSource::AmdDx,
        CacheSource::AmdDxc,
        CacheSource::IntelShader,
    ];
    let gpu_cache_size: u64 = all_caches
        .iter()
        .filter(|c| gpu_sources.contains(&c.source))
        .map(|c| c.size_bytes)
        .sum();
    let game_cache_size: u64 = all_caches
        .iter()
        .filter(|c| !gpu_sources.contains(&c.source))
        .map(|c| c.size_bytes)
        .sum();
    let total_size_bytes = gpu_cache_size + game_cache_size;
    let scan_duration_ms = start.elapsed().as_millis() as u64;

    emit("Scan complete!", all_caches.len(), total_size_bytes);
    info!(
        "[cmd] run_scan done in {}ms: {} games, {} caches, {} total",
        scan_duration_ms,
        all_games.len(),
        all_caches.len(),
        total_size_bytes
    );

    Ok(ScanResult {
        games: all_games,
        caches: all_caches,
        grouped,
        unmatched,
        total_size_bytes,
        gpu_cache_size,
        game_cache_size,
        scan_duration_ms,
    })
}

fn move_dir_contents(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    if let Ok(entries) = std::fs::read_dir(src) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let target = dst.join(entry.file_name());
            if entry_path.is_dir() {
                let _ = move_dir_contents(&entry_path, &target);
                let _ = std::fs::remove_dir(&entry_path);
            } else {
                if std::fs::rename(&entry_path, &target).is_err() {
                    if std::fs::copy(&entry_path, &target).is_ok() {
                        let _ = std::fs::remove_file(&entry_path);
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_cache(
    cache_path: String,
    game_id: Option<String>,
    game_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<TrashRecord, AppError> {
    let path = PathBuf::from(&cache_path);

    validate_path_allowed(&path)?;

    if !path.exists() {
        return Err(AppError::Other(format!(
            "Cache path does not exist: {cache_path}"
        )));
    }

    let trash_dir = {
        let base =
            dirs::data_dir().unwrap_or_else(|| PathBuf::from(r"C:\Users\Public\AppData\Roaming"));
        base.join("Kcache").join("Trash")
    };
    std::fs::create_dir_all(&trash_dir)?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S%.3f");
    let original_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("cache");
    let trash_name = format!("{timestamp}_{original_name}");
    let trash_path = trash_dir.join(&trash_name);

    if path.is_file() {
        if is_path_locked(&path) {
            return Err(AppError::FileLocked(format!(
                "The file is in use by a running game or process: {cache_path}"
            )));
        }
        info!(
            "[cmd] Moving file to trash: {} → {}",
            path.display(),
            trash_path.display()
        );
        if std::fs::rename(&path, &trash_path).is_err() {
            std::fs::copy(&path, &trash_path)?;
            let _ = std::fs::remove_file(&path);
        }
    } else if path.is_dir() {
        std::fs::create_dir_all(&trash_path)?;

        let mut moved_count = 0usize;
        let mut skipped_count = 0usize;

        if let Ok(entries) = std::fs::read_dir(&path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let file_name = entry.file_name();
                let target_entry = trash_path.join(file_name);

                let rename_res = std::fs::rename(&entry_path, &target_entry);
                if rename_res.is_ok() {
                    moved_count += 1;
                } else if entry_path.is_dir() {
                    if move_dir_contents(&entry_path, &target_entry).is_ok() {
                        moved_count += 1;
                        let _ = std::fs::remove_dir(&entry_path);
                    } else {
                        skipped_count += 1;
                    }
                } else {
                    if std::fs::copy(&entry_path, &target_entry).is_ok() {
                        if std::fs::remove_file(&entry_path).is_ok() {
                            moved_count += 1;
                            continue;
                        } else {
                            let _ = std::fs::remove_file(&target_entry);
                        }
                    }
                    skipped_count += 1;
                    info!("[cmd] Skipped in-use file: {}", entry_path.display());
                }
            }
        }

        info!(
            "[cmd] Cleaned cache folder {}: moved {} items to trash, {} in-use items skipped",
            path.display(),
            moved_count,
            skipped_count
        );

        if moved_count == 0 && skipped_count > 0 {
            return Err(AppError::FileLocked(format!(
                "All cache files in {} are currently in use by running processes or games. Please close them and try again.",
                cache_path
            )));
        }
    }

    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    db.delete_cache_entry_by_path(&cache_path)?;
    let trash_id = db.add_to_trash(
        &cache_path,
        &trash_path.to_string_lossy(),
        game_id.as_deref(),
        game_name.as_deref(),
    )?;

    Ok(TrashRecord {
        id: trash_id,
        original_path: cache_path,
        trash_path: trash_path.to_string_lossy().to_string(),
        game_id,
        game_name,
        deleted_at: Utc::now().timestamp(),
    })
}

#[tauri::command]
pub async fn restore_from_trash(
    trash_id: i64,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;

    let items = db.get_trash_items()?;
    let item = items
        .iter()
        .find(|i| i.id == trash_id)
        .ok_or(AppError::Other(format!("Trash item #{trash_id} not found")))?;

    let trash_path = PathBuf::from(&item.trash_path);
    let original_path = PathBuf::from(&item.original_path);

    if !trash_path.exists() {
        return Err(AppError::Other(format!(
            "Trash file no longer exists: {}",
            trash_path.display()
        )));
    }

    if let Some(parent) = original_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    if trash_path.is_file() {
        if std::fs::rename(&trash_path, &original_path).is_err() {
            std::fs::copy(&trash_path, &original_path)?;
            let _ = std::fs::remove_file(&trash_path);
        }
    } else if trash_path.is_dir() {
        std::fs::create_dir_all(&original_path)?;
        let _ = move_dir_contents(&trash_path, &original_path);
        let _ = std::fs::remove_dir_all(&trash_path);
    }

    db.remove_from_trash(trash_id)?;

    info!("[cmd] Restored from trash: {}", original_path.display());
    Ok(original_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn backup_game_cache(
    game_id: String,
    game_name: String,
    cache_paths: Vec<String>,
    notes: Option<String>,
    state: State<'_, AppState>,
) -> Result<BackupRecord, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;

    let backup_dir = {
        let setting = db.get_setting("backup_dir")?.unwrap_or_default();
        if setting.is_empty() {
            dirs::document_dir().unwrap_or_else(|| PathBuf::from(r"C:\Users\Public\Documents"))
        } else {
            PathBuf::from(setting)
        }
    };

    let archive_path = make_archive_path(&backup_dir, &game_name);
    let source_paths: Vec<PathBuf> = cache_paths.iter().map(PathBuf::from).collect();

    let archive_size = backup_paths(&source_paths, &archive_path)?;

    let record = BackupRecord {
        id: 0,
        game_id: game_id.clone(),
        game_name: game_name.clone(),
        archive_path: archive_path.to_string_lossy().to_string(),
        created_at: Utc::now().timestamp(),
        size_bytes: archive_size,
        notes,
        original_paths: cache_paths,
    };

    let id = db.add_backup(&record)?;
    info!("[cmd] Backup created: #{id} for {game_name}");

    Ok(BackupRecord { id, ..record })
}

#[tauri::command]
pub async fn restore_game_cache(
    _backup_id: i64,
    _state: State<'_, AppState>,
) -> Result<Vec<String>, AppError> {
    Err(AppError::Other(
        "Use restore_cache_from_archive with the archive_path from get_backups.".into(),
    ))
}

#[tauri::command]
pub async fn restore_cache_from_archive(
    archive_path: String,
    restore_to: String,
) -> Result<Vec<String>, AppError> {
    let archive = PathBuf::from(&archive_path);
    let restore_root = PathBuf::from(&restore_to);

    validate_path_allowed(&restore_root)?;

    let restored = restore_archive(&archive, &restore_root)?;
    Ok(restored
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

#[tauri::command]
pub async fn get_backups(
    game_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<BackupRecord>, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    Ok(db.get_backups_for_game(&game_id)?)
}

#[tauri::command]
pub async fn get_trash(state: State<'_, AppState>) -> Result<Vec<TrashRecord>, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    Ok(db.get_trash_items()?)
}

#[tauri::command]
pub async fn get_settings(
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, String>, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    Ok(db.get_all_settings()?)
}

#[tauri::command]
pub async fn set_setting(
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    Ok(db.set_setting(&key, &value)?)
}

#[derive(serde::Serialize)]
pub struct EverythingStatus {
    pub installed: bool,
    pub install_path: Option<String>,
    pub http_available: bool,
    pub http_port: Option<u16>,
}

#[tauri::command]
pub async fn get_everything_status() -> EverythingStatus {
    let install_path = find_everything_install();
    let installed = install_path.is_some();

    let (http_available, http_port) = if installed {
        let mut client = crate::everything::EverythingClient::new();
        let available = client.is_available();
        (available, Some(80u16))
    } else {
        (false, None)
    };

    EverythingStatus {
        installed,
        install_path: install_path.map(|p| p.to_string_lossy().to_string()),
        http_available,
        http_port,
    }
}

#[tauri::command]
pub async fn get_scan_folders(state: State<'_, AppState>) -> Result<Vec<ScanFolder>, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    Ok(db.get_scan_folders()?)
}

#[tauri::command]
pub async fn add_scan_folder(
    path: String,
    state: State<'_, AppState>,
) -> Result<ScanFolder, AppError> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::Other(format!("Folder does not exist: {path}")));
    }
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    Ok(db.add_scan_folder(&path)?)
}

#[tauri::command]
pub async fn remove_scan_folder(id: i64, state: State<'_, AppState>) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    Ok(db.remove_scan_folder(id)?)
}

#[tauri::command]
pub async fn toggle_scan_folder(
    id: i64,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    Ok(db.toggle_scan_folder(id, enabled)?)
}

#[tauri::command]
pub async fn scan_custom_folders(
    state: State<'_, AppState>,
) -> Result<Vec<DiscoveredProgram>, AppError> {
    let folders: Vec<PathBuf> = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        let saved = db.get_scan_folders()?;
        let enabled: Vec<PathBuf> = saved
            .into_iter()
            .filter(|f| f.enabled)
            .map(|f| PathBuf::from(f.path))
            .collect();

        if !enabled.is_empty() {
            enabled
        } else {
            let mut defaults = crate::libraries::steam::SteamLibrary::get_library_paths();
            for candidate in &[r"C:\Games", r"D:\Games", r"E:\Games", r"F:\Games"] {
                let p = PathBuf::from(candidate);
                if p.exists() && !defaults.contains(&p) {
                    defaults.push(p);
                }
            }
            defaults
        }
    };

    if folders.is_empty() {
        return Ok(Vec::new());
    }

    tokio::task::spawn_blocking(move || {
        let mut client = EverythingClient::new();
        let everything_opt = if client.is_available() {
            Some(&client)
        } else {
            None
        };
        Ok(ExeScanner::scan_folders(&folders, everything_opt))
    })
    .await
    .map_err(|e| AppError::Other(format!("Executable scan task panic: {e}")))?
}

#[tauri::command]
pub async fn add_custom_games(
    programs: Vec<DiscoveredProgram>,
    state: State<'_, AppState>,
) -> Result<Vec<DetectedGame>, AppError> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    let existing_games = db.get_all_games()?;
    let mut added = Vec::new();

    for prog in programs {
        let normalized_new_exe = prog.exe_path.to_lowercase().replace('/', "\\");
        let normalized_new_folder = prog.folder_path.to_lowercase().replace('/', "\\");

        let existing_match = existing_games.iter().find(|g| {
            if let Some(ref ep) = g.exe_path {
                if !ep.is_empty() && ep.to_lowercase().replace('/', "\\") == normalized_new_exe {
                    return true;
                }
            }
            if let (Some(ref matched_id), Some(ref game_appid)) = (&prog.matched_app_id, &g.app_id)
            {
                if !matched_id.is_empty() && matched_id == game_appid {
                    return true;
                }
            }
            if !g.install_path.is_empty()
                && g.install_path.to_lowercase().replace('/', "\\") == normalized_new_folder
            {
                return true;
            }
            false
        });

        let (game_id, platform) = if let Some(existing) = existing_match {
            (existing.id.clone(), existing.platform.clone())
        } else {
            let mut hasher = DefaultHasher::new();
            normalized_new_exe.hash(&mut hasher);
            let hash = hasher.finish();
            (format!("custom_{hash:016x}"), GamePlatform::Custom)
        };

        let hero_url = prog
            .matched_app_id
            .as_ref()
            .map(|id| SteamApiClient::get_cdn_hero_url(id));
        let logo_url = prog
            .matched_app_id
            .as_ref()
            .map(|id| SteamApiClient::get_cdn_logo_url(id));

        let game = DetectedGame {
            id: game_id,
            name: prog.name,
            platform,
            install_path: prog.folder_path,
            exe_path: Some(prog.exe_path),
            app_id: prog.matched_app_id,
            last_played: None,
            icon_url: None,
            cover_url: prog.matched_cover_url,
            hero_url,
            logo_url,
            description: None,
            genres: Vec::new(),
            developer: None,
            publisher: None,
            release_date: None,
            playtime_seconds: 0,
            install_size_bytes: 0,
        };

        db.upsert_game(&game)?;
        let _ = db.restore_excluded_game(&game.id);
        if let Some(ref aid) = game.app_id {
            let _ = db.restore_excluded_game(aid);
        }
        added.push(game);
    }

    Ok(added)
}

#[tauri::command]
pub async fn launch_game(
    game_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let (game, initial_playtime) = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        let g = db
            .get_game_by_id(&game_id)?
            .ok_or_else(|| AppError::Other(format!("Game #{game_id} not found")))?;
        let p = db.get_game_playtime(&game_id).unwrap_or(0);
        (g, p)
    };

    {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        if let Ok(entries) = db.get_vault_entries_for_game(&game_id) {
            for entry in entries {
                if entry.status == "compressed" {
                    let comp_path = PathBuf::from(&entry.compressed_path);
                    let orig_path = PathBuf::from(&entry.original_path);
                    if let Err(e) = decompress_shader_target(
                        &app,
                        &comp_path,
                        &orig_path,
                        &entry.algorithm,
                        &entry.cache_id,
                        &entry.game_name,
                    ) {
                        error!(
                            "[Launcher] Auto-decompress failed for {}: {:?}",
                            comp_path.display(),
                            e
                        );
                    } else {
                        let _ = db.update_vault_entry_status(&entry.id, "decompressed");
                    }
                }
            }
        }
    }

    let mut launched_child: Option<std::process::Child> = None;
    let mut exe_filename: Option<String> = None;

    if let Some(ref exe_path) = game.exe_path {
        if !exe_path.is_empty() {
            let p = PathBuf::from(exe_path);
            if p.exists() {
                let work_dir = p.parent().unwrap_or(&p);
                info!(
                    "[Launcher] Launching executable {} in {}",
                    p.display(),
                    work_dir.display()
                );
                let child = std::process::Command::new(&p)
                    .current_dir(work_dir)
                    .spawn()
                    .map_err(|e| AppError::Other(format!("Failed to launch executable: {e}")))?;

                exe_filename = p.file_name().map(|n| n.to_string_lossy().to_string());
                launched_child = Some(child);
            }
        }
    }

    if launched_child.is_none() && game.platform == GamePlatform::Steam && game.app_id.is_some() {
        let app_id = game.app_id.as_ref().unwrap();
        info!("[Launcher] Launching Steam game {app_id} via steam://rungameid/{app_id}");
        std::process::Command::new("cmd")
            .args(["/C", "start", &format!("steam://rungameid/{app_id}")])
            .spawn()
            .map_err(|e| AppError::Other(format!("Failed to start Steam game: {e}")))?;

        if !game.install_path.is_empty() {
            let p = PathBuf::from(&game.install_path);
            if p.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&p) {
                    let mut best: Option<(String, u64)> = None;
                    for entry in entries.flatten() {
                        let ep = entry.path();
                        if ep
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.eq_ignore_ascii_case("exe"))
                            .unwrap_or(false)
                        {
                            let n = ep
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            let nl = n.to_lowercase();
                            if !nl.starts_with("unins")
                                && !nl.contains("crash")
                                && !nl.contains("report")
                            {
                                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                                if best.as_ref().map(|(_, s)| size > *s).unwrap_or(true) {
                                    best = Some((n, size));
                                }
                            }
                        }
                    }
                    if let Some((best_name, _)) = best {
                        exe_filename = Some(best_name);
                    }
                }
            }
        }
    } else if launched_child.is_none() {
        if let Some(ref exe_path) = game.exe_path {
            if !exe_path.is_empty() {
                return Err(AppError::Other(format!(
                    "Configured executable not found on disk: {exe_path}"
                )));
            }
        }
        return Err(AppError::Other("No valid executable path configured for this game. Use 'Change .exe' to select the game file.".into()));
    }

    let now = Utc::now().timestamp();
    {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        let _ = db.update_last_played(&game_id, now);
    }

    let start_time = Instant::now();
    {
        let mut session = state
            .active_session
            .lock()
            .map_err(|_| AppError::Other("Session lock poisoned".into()))?;
        session.insert(
            game_id.clone(),
            ActiveSessionInfo {
                game_id: game_id.clone(),
                started_at: start_time,
            },
        );
    }

    let _ = app.emit(
        "game-status-changed",
        PlaytimeInfo {
            game_id: game_id.clone(),
            total_playtime_secs: initial_playtime,
            is_running: true,
            session_duration_secs: 0,
        },
    );

    let app_clone = app.clone();
    let task_game_id = game_id.clone();

    tokio::spawn(async move {
        info!(
            "[PlaytimeMonitor] Starting monitor for game: {} (exe: {:?})",
            task_game_id, exe_filename
        );
        let mut uncommitted_secs: u64 = 0;
        let mut last_checkpoint = Instant::now();
        let mut child = launched_child;

        if child.is_none() {
            tokio::time::sleep(tokio::time::Duration::from_secs(4)).await;
        }

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

            let is_alive = if let Some(ref mut c) = child {
                match c.try_wait() {
                    Ok(None) => true,
                    Ok(Some(_)) => {
                        if let Some(ref name) = exe_filename {
                            is_exe_running(name)
                        } else {
                            false
                        }
                    }
                    Err(_) => false,
                }
            } else if let Some(ref name) = exe_filename {
                is_exe_running(name)
            } else {
                false
            };

            let total_elapsed = start_time.elapsed().as_secs();

            if is_alive {
                if last_checkpoint.elapsed().as_secs() >= 60 {
                    let delta = total_elapsed.saturating_sub(uncommitted_secs);
                    if delta > 0 {
                        if let Some(state) = app_clone.try_state::<AppState>() {
                            if let Ok(db) = state.db.lock() {
                                let cur_time = Utc::now().timestamp();
                                let _ = db.add_game_playtime(&task_game_id, delta, cur_time);
                            }
                        }
                        uncommitted_secs = total_elapsed;
                    }
                    last_checkpoint = Instant::now();
                }

                let _ = app_clone.emit(
                    "game-status-changed",
                    PlaytimeInfo {
                        game_id: task_game_id.clone(),
                        total_playtime_secs: initial_playtime + total_elapsed,
                        is_running: true,
                        session_duration_secs: total_elapsed,
                    },
                );
            } else {
                let remaining_delta = total_elapsed.saturating_sub(uncommitted_secs);
                let final_total = if let Some(state) = app_clone.try_state::<AppState>() {
                    let mut total = initial_playtime + total_elapsed;
                    if let Ok(db) = state.db.lock() {
                        let cur_time = Utc::now().timestamp();
                        if remaining_delta > 0 {
                            if let Ok(t) =
                                db.add_game_playtime(&task_game_id, remaining_delta, cur_time)
                            {
                                total = t;
                            }
                        }
                    }
                    if let Ok(mut session) = state.active_session.lock() {
                        session.remove(&task_game_id);
                    }
                    total
                } else {
                    initial_playtime + total_elapsed
                };

                info!(
                    "[PlaytimeMonitor] Game {} exited. Session: {}s, Total: {}s",
                    task_game_id, total_elapsed, final_total
                );

                let _ = app_clone.emit(
                    "game-status-changed",
                    PlaytimeInfo {
                        game_id: task_game_id,
                        total_playtime_secs: final_total,
                        is_running: false,
                        session_duration_secs: 0,
                    },
                );
                break;
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn get_game_playtime(
    game_id: String,
    state: State<'_, AppState>,
) -> Result<PlaytimeInfo, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    let total_secs = db.get_game_playtime(&game_id).unwrap_or(0);
    let session = state
        .active_session
        .lock()
        .map_err(|_| AppError::Other("Session lock poisoned".into()))?;
    if let Some(s) = session.get(&game_id) {
        let elapsed = s.started_at.elapsed().as_secs();
        return Ok(PlaytimeInfo {
            game_id,
            total_playtime_secs: total_secs + elapsed,
            is_running: true,
            session_duration_secs: elapsed,
        });
    }
    Ok(PlaytimeInfo {
        game_id,
        total_playtime_secs: total_secs,
        is_running: false,
        session_duration_secs: 0,
    })
}

#[tauri::command]
pub async fn get_game_disk_size(
    game_id: String,
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
) -> Result<GameDiskSize, AppError> {
    let (install_path, exe_path, cached_size) = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        let game = db
            .get_game_by_id(&game_id)?
            .ok_or_else(|| AppError::Other(format!("Game #{game_id} not found")))?;
        (game.install_path, game.exe_path, game.install_size_bytes)
    };

    let cache_size = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        let entries = db.get_caches_for_game(&game_id).unwrap_or_default();
        entries.iter().map(|e| e.size_bytes).sum::<u64>()
    };

    let force = force_refresh.unwrap_or(false);
    if cached_size > 0 && !force {
        return Ok(GameDiskSize {
            install_size_bytes: cached_size,
            cache_size_bytes: cache_size,
            total_size_bytes: cached_size + cache_size,
        });
    }

    let target_dir = if !install_path.is_empty() && PathBuf::from(&install_path).is_dir() {
        Some(PathBuf::from(&install_path))
    } else if let Some(ref ep) = exe_path {
        let p = PathBuf::from(ep);

        if let Some(parent) = p.parent() {
            if parent
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .as_deref()
                == Some("win64")
            {
                if let Some(grandparent) = parent.parent() {
                    if grandparent
                        .file_name()
                        .map(|n| n.to_string_lossy().to_lowercase())
                        .as_deref()
                        == Some("binaries")
                    {
                        if let Some(game_root) = grandparent.parent().and_then(|p| p.parent()) {
                            Some(game_root.to_path_buf())
                        } else {
                            Some(grandparent.to_path_buf())
                        }
                    } else {
                        Some(grandparent.to_path_buf())
                    }
                } else {
                    Some(parent.to_path_buf())
                }
            } else {
                Some(parent.to_path_buf())
            }
        } else {
            None
        }
    } else {
        None
    };

    let install_size = if let Some(dir) = target_dir {
        if dir.exists() {
            tokio::task::spawn_blocking(move || {
                let mut total: u64 = 0;
                for entry in walkdir::WalkDir::new(&dir)
                    .follow_links(false)
                    .into_iter()
                    .filter_map(|e| e.ok())
                {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            total = total.saturating_add(meta.len());
                        }
                    }
                }
                total
            })
            .await
            .unwrap_or(0)
        } else {
            0
        }
    } else {
        0
    };

    if install_size > 0 {
        if let Ok(db) = state.db.lock() {
            let _ = db.update_game_install_size(&game_id, install_size);
        }
    }

    Ok(GameDiskSize {
        install_size_bytes: install_size,
        cache_size_bytes: cache_size,
        total_size_bytes: install_size + cache_size,
    })
}

#[tauri::command]
pub async fn update_game_exe(
    game_id: String,
    exe_path: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    db.update_game_exe_path(&game_id, &exe_path)?;
    info!("[cmd] Updated game {} executable to {}", game_id, exe_path);
    Ok(())
}

#[tauri::command]
pub async fn open_game_folder(path: String) -> Result<(), AppError> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::Other(format!("Path does not exist: {path}")));
    }
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| AppError::Other(format!("Failed to open folder: {e}")))?;
    Ok(())
}

#[tauri::command]
pub async fn fetch_steam_metadata(
    app_id: String,
    state: State<'_, AppState>,
) -> Result<SteamAppDetails, AppError> {
    {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        if let Ok(Some(cached_json)) = db.get_cached_metadata(&app_id) {
            if let Ok(details) = serde_json::from_str::<SteamAppDetails>(&cached_json) {
                return Ok(details);
            }
        }
    }

    let app_id_clone = app_id.clone();
    let details = tokio::task::spawn_blocking(move || {
        let client = SteamApiClient::new();
        client.fetch_app_details(&app_id_clone)
    })
    .await
    .map_err(|e| AppError::Other(format!("Steam fetch task panic: {e}")))??;

    if let Ok(serialized) = serde_json::to_string(&details) {
        if let Ok(db) = state.db.lock() {
            let _ = db.cache_metadata(&app_id, &serialized);
        }
    }

    Ok(details)
}

#[tauri::command]
pub async fn search_steam_games(query: String) -> Result<Vec<SteamSearchResult>, AppError> {
    tokio::task::spawn_blocking(move || {
        let client = SteamApiClient::new();
        client.search_store(&query)
    })
    .await
    .map_err(|e| AppError::Other(format!("Steam search task panic: {e}")))?
}

#[tauri::command]
pub async fn update_game_metadata(
    game_id: String,
    name: Option<String>,
    app_id: Option<String>,
    cover_url: Option<String>,
    hero_url: Option<String>,
    logo_url: Option<String>,
    description: Option<String>,
    genres: Option<Vec<String>>,
    developer: Option<String>,
    publisher: Option<String>,
    release_date: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    db.update_game_metadata(
        &game_id,
        name.as_deref(),
        app_id.as_deref(),
        cover_url.as_deref(),
        hero_url.as_deref(),
        logo_url.as_deref(),
        description.as_deref(),
        genres.as_deref(),
        developer.as_deref(),
        publisher.as_deref(),
        release_date.as_deref(),
    )?;
    Ok(())
}

#[tauri::command]
pub async fn detect_steam_id() -> Result<Option<String>, AppError> {
    Ok(SteamApiClient::detect_local_steam_id())
}

#[tauri::command]
pub async fn sync_steam_web_api(
    api_key: String,
    steam_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<usize, AppError> {
    let final_api_key = if api_key.trim().is_empty() {
        crate::utils::get_steam_api_key()
            .ok_or_else(|| AppError::Other("Please enter a Steam Web API Key first.".into()))?
    } else {
        api_key
    };

    let final_steam_id = if let Some(id) = steam_id.filter(|s| !s.trim().is_empty()) {
        id
    } else {
        SteamApiClient::detect_local_steam_id().ok_or_else(|| {
            AppError::Other("No Steam ID provided and none found in loginusers.vdf".into())
        })?
    };

    let owned_games = tokio::task::spawn_blocking(move || {
        let client = SteamApiClient::new();
        client.fetch_owned_games(&final_api_key, &final_steam_id)
    })
    .await
    .map_err(|e| AppError::Other(format!("Steam Web API sync panic: {e}")))??;

    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    let mut updated_count = 0;

    for g in owned_games {
        let app_id_str = g.appid.to_string();
        let game_id = format!("steam_{app_id_str}");
        let cover_url = SteamApiClient::get_cdn_cover_url(&app_id_str);
        let hero_url = SteamApiClient::get_cdn_hero_url(&app_id_str);
        let logo_url = SteamApiClient::get_cdn_logo_url(&app_id_str);

        let game = DetectedGame {
            id: game_id,
            name: g.name.unwrap_or_else(|| format!("Steam Game {app_id_str}")),
            platform: GamePlatform::Steam,
            install_path: String::new(),
            exe_path: None,
            app_id: Some(app_id_str),
            last_played: if g.playtime_forever > 0 {
                Some(g.playtime_forever as i64 * 60)
            } else {
                None
            },
            icon_url: g.img_icon_url,
            cover_url: Some(cover_url),
            hero_url: Some(hero_url),
            logo_url: Some(logo_url),
            description: None,
            genres: Vec::new(),
            developer: None,
            publisher: None,
            release_date: None,
            playtime_seconds: 0,
            install_size_bytes: 0,
        };

        if db.upsert_game(&game).is_ok() {
            updated_count += 1;
        }
    }

    Ok(updated_count)
}

#[tauri::command]
pub async fn delete_game(game_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    if let Ok(Some(game)) = db.get_game_by_id(&game_id) {
        let _ = db.exclude_game(&game);
    } else {
        let fallback = DetectedGame {
            id: game_id.clone(),
            name: game_id.clone(),
            platform: GamePlatform::Unknown,
            install_path: "".into(),
            exe_path: None,
            app_id: None,
            last_played: None,
            icon_url: None,
            cover_url: None,
            hero_url: None,
            logo_url: None,
            description: None,
            genres: vec![],
            developer: None,
            publisher: None,
            release_date: None,
            playtime_seconds: 0,
            install_size_bytes: 0,
        };
        let _ = db.exclude_game(&fallback);
    }
    db.delete_game(&game_id)?;
    info!(
        "[cmd] delete_game: {} excluded and deleted from DB",
        game_id
    );
    Ok(())
}

#[tauri::command]
pub async fn get_excluded_games(
    state: State<'_, AppState>,
) -> Result<Vec<crate::db::ExcludedGame>, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    let games = db.get_excluded_games()?;
    Ok(games)
}

#[tauri::command]
pub async fn restore_game(game_id: String, state: State<'_, AppState>) -> Result<(), AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    db.restore_excluded_game(&game_id)?;
    info!("[cmd] restore_game: {} un-excluded", game_id);
    Ok(())
}

pub fn deduplicate_games(games: &mut Vec<DetectedGame>) {
    let mut seen_ids = std::collections::HashSet::new();
    let mut seen_apps = std::collections::HashSet::new();
    let mut seen_paths = std::collections::HashSet::new();

    games.retain(|game| {
        let id_lower = game.id.to_lowercase();
        if !seen_ids.insert(id_lower) {
            return false;
        }

        if let Some(ref app_id) = game.app_id {
            if !app_id.is_empty() {
                let key = format!("{:?}:{}", game.platform, app_id.to_lowercase());
                if !seen_apps.insert(key) {
                    return false;
                }
            }
        }

        if let Some(ref exe) = game.exe_path {
            let exe_norm = exe.trim().to_lowercase().replace('/', "\\");
            if !exe_norm.is_empty() && !seen_paths.insert(exe_norm) {
                return false;
            }
        }

        let folder_norm = game.install_path.trim().to_lowercase().replace('/', "\\");
        if !folder_norm.is_empty() && !seen_paths.insert(folder_norm) {
            return false;
        }

        true
    });
}

#[tauri::command]
pub async fn compress_shader_cache(
    app: AppHandle,
    source_path: String,
    game_id: Option<String>,
    game_name: String,
    cache_id: String,
    algorithm: CompressionAlgorithm,
    state: State<'_, AppState>,
) -> Result<CompressedVaultEntry, AppError> {
    let p = PathBuf::from(&source_path);
    let app_clone = app.clone();
    let gid = game_id.clone();
    let gname = game_name.clone();
    let cid = cache_id.clone();
    let entry = tokio::task::spawn_blocking(move || {
        compress_shader_target(&app_clone, &p, gid, &gname, &cid, algorithm)
    })
    .await
    .map_err(|e| AppError::Other(format!("Compression thread error: {e}")))??;

    {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        db.insert_vault_entry(&entry)?;
    }
    Ok(entry)
}

#[tauri::command]
pub async fn decompress_shader_cache(
    app: AppHandle,
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let vault_entry = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        db.get_vault_entry_by_id(&vault_id)?
            .ok_or_else(|| AppError::Other(format!("Vault entry #{vault_id} not found")))?
    };

    let comp_path = PathBuf::from(&vault_entry.compressed_path);
    let orig_path = PathBuf::from(&vault_entry.original_path);
    let app_clone = app.clone();
    let algo = vault_entry.algorithm.clone();
    let cid = vault_entry.cache_id.clone();
    let gname = vault_entry.game_name.clone();

    tokio::task::spawn_blocking(move || {
        decompress_shader_target(&app_clone, &comp_path, &orig_path, &algo, &cid, &gname)
    })
    .await
    .map_err(|e| AppError::Other(format!("Decompression thread error: {e}")))??;

    {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        db.update_vault_entry_status(&vault_id, "decompressed")?;
    }

    Ok(())
}

#[tauri::command]
pub async fn get_vault_entries(
    state: State<'_, AppState>,
) -> Result<Vec<CompressedVaultEntry>, AppError> {
    let db = state
        .db
        .lock()
        .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
    Ok(db.get_all_vault_entries()?)
}

#[tauri::command]
pub async fn delete_vault_entry(
    vault_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let entry = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        db.get_vault_entry_by_id(&vault_id)?
    };
    if let Some(e) = entry {
        let comp_path = PathBuf::from(&e.compressed_path);
        if comp_path.exists() {
            let _ = std::fs::remove_file(&comp_path);
        }
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        db.delete_vault_entry(&vault_id)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn open_vault_folder() -> Result<(), AppError> {
    let dir = get_vault_directory();
    std::fs::create_dir_all(&dir)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| AppError::Other(format!("Failed to open folder: {e}")))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_library_statistics(
    state: State<'_, AppState>,
) -> Result<LibraryStatistics, AppError> {
    let (games, active_sessions) = {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;
        let g = db.get_all_games()?;
        let session = state
            .active_session
            .lock()
            .map_err(|_| AppError::Other("Session lock poisoned".into()))?;
        let active: std::collections::HashMap<String, u64> = session
            .iter()
            .map(|(gid, s)| (gid.clone(), s.started_at.elapsed().as_secs()))
            .collect();
        (g, active)
    };

    let total_games = games.len();
    let mut installed_games = 0;
    let mut not_installed_games = 0;
    let mut played_games = 0;
    let mut not_played_games = 0;
    let mut total_playtime_seconds: u64 = 0;
    let mut total_install_size_bytes: u64 = 0;
    let mut total_shader_cache_size_bytes: u64 = 0;
    let mut platform_counts: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut all_game_stats: Vec<GameStorageStat> = Vec::new();

    {
        let db = state
            .db
            .lock()
            .map_err(|_| AppError::Other("DB lock poisoned".into()))?;

        for game in games {
            let mut playtime = game.playtime_seconds;
            if let Some(&active_elapsed) = active_sessions.get(&game.id) {
                playtime += active_elapsed;
            }

            let is_installed = if !game.install_path.is_empty() {
                std::path::Path::new(&game.install_path).exists()
            } else if let Some(ref ep) = game.exe_path {
                std::path::Path::new(ep).exists()
            } else {
                false
            };

            if is_installed {
                installed_games += 1;
            } else {
                not_installed_games += 1;
            }

            if playtime > 0 {
                played_games += 1;
            } else {
                not_played_games += 1;
            }

            total_playtime_seconds += playtime;
            total_install_size_bytes += game.install_size_bytes;

            let cache_size = db
                .get_caches_for_game(&game.id)
                .unwrap_or_default()
                .iter()
                .map(|c| c.size_bytes)
                .sum::<u64>();
            total_shader_cache_size_bytes += cache_size;

            let plat_str = format!("{:?}", game.platform);
            *platform_counts.entry(plat_str.clone()).or_insert(0) += 1;

            all_game_stats.push(GameStorageStat {
                id: game.id,
                name: game.name,
                platform: plat_str,
                cover_url: game.cover_url,
                hero_url: game.hero_url,
                icon_url: game.icon_url,
                install_size_bytes: game.install_size_bytes,
                cache_size_bytes: cache_size,
                total_size_bytes: game.install_size_bytes + cache_size,
                playtime_seconds: playtime,
                last_played: game.last_played,
                is_installed,
                install_path: game.install_path,
            });
        }
    }

    let total_backup_size_bytes = {
        let backup_dir = dirs::document_dir()
            .or_else(dirs::data_local_dir)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Kcache")
            .join("SaveBackups");
        if backup_dir.exists() {
            walkdir::WalkDir::new(&backup_dir)
                .into_iter()
                .flatten()
                .filter(|e| e.path().is_file())
                .filter_map(|e| e.metadata().ok())
                .map(|m| m.len())
                .sum::<u64>()
        } else {
            0
        }
    };

    let total_storage_used_bytes =
        total_install_size_bytes + total_shader_cache_size_bytes + total_backup_size_bytes;
    let average_playtime_seconds = if total_games > 0 {
        total_playtime_seconds / total_games as u64
    } else {
        0
    };

    let mut top_played_games = all_game_stats.clone();
    top_played_games.sort_by(|a, b| b.playtime_seconds.cmp(&a.playtime_seconds));
    top_played_games.retain(|g| g.playtime_seconds > 0);
    top_played_games.truncate(15);

    Ok(LibraryStatistics {
        total_games,
        installed_games,
        not_installed_games,
        played_games,
        not_played_games,
        total_playtime_seconds,
        average_playtime_seconds,
        total_install_size_bytes,
        total_shader_cache_size_bytes,
        total_backup_size_bytes,
        total_storage_used_bytes,
        platform_counts,
        top_played_games,
        all_games: all_game_stats,
    })
}
