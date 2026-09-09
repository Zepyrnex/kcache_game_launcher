use std::path::{Path, PathBuf};
use crate::types::{AppError, AppResult, CacheEntry, CacheSource};
use uuid::Uuid;
use walkdir::WalkDir;

pub fn dir_size_and_mtime(path: &Path) -> (u64, i64) {
    const MAX_FILES: usize = 50_000;
    let mut total = 0u64;
    let mut latest: i64 = 0;
    let mut count = 0usize;
    for entry in WalkDir::new(path).min_depth(1).max_depth(1).into_iter().flatten() {
        if count >= MAX_FILES { break; }
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                count += 1;
                total += meta.len();
                if let Ok(modified) = meta.modified() {
                    let ts = modified
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    if ts > latest { latest = ts; }
                }
            }
        }
    }
    (total, latest)
}

pub fn scan_dir(
    source: CacheSource,
    path: PathBuf,
) -> Option<CacheEntry> {
    if !path.exists() {
        return None;
    }
    let (size_bytes, last_modified) = dir_size_and_mtime(&path);
    Some(CacheEntry {
        id: Uuid::new_v4().to_string(),
        source,
        path: path.to_string_lossy().to_string(),
        size_bytes,
        last_modified,
        associated_game_id: None,
        associated_game_guess: None,
        confidence: 0.0,
    })
}

pub fn validate_path_allowed(path: &Path) -> AppResult<()> {
    let allowed_roots: Vec<PathBuf> = {
        let mut roots = vec![];

        if let Some(local) = dirs::data_local_dir() {
            roots.push(local.join("NVIDIA").join("DXCache"));
            roots.push(local.join("NVIDIA").join("GLCache"));
            roots.push(local.join("AMD").join("DxCache"));
            roots.push(local.join("AMD").join("DxcCache"));
            roots.push(local.join("Intel").join("ShaderCache"));
        }

        roots
    };

    let path_str = path.to_string_lossy().to_lowercase();

    for root in &allowed_roots {
        if path.starts_with(root) {
            return Ok(());
        }
    }

    if path_str.contains("steamapps\\shadercache") || path_str.contains("steamapps/shadercache") {
        return Ok(());
    }

    if let Some(ext) = path.extension() {
        let ext = ext.to_string_lossy().to_lowercase();
        if ext == "dxvk-cache" || ext == "vkd3d-cache" {
            return Ok(());
        }
    }

    if let Some(app_data) = dirs::data_dir() {
        if path.starts_with(app_data.join("Kcache")) || path.starts_with(app_data.join("ShaderVault")) {
            return Ok(());
        }
    }

    Err(AppError::PathNotAllowed(
        path.to_string_lossy().to_string(),
    ))
}

pub fn is_path_locked(path: &Path) -> bool {
    if path.is_file() {
        std::fs::OpenOptions::new()
            .write(true)
            .open(path)
            .is_err()
    } else if path.is_dir() {

        for entry in WalkDir::new(path).min_depth(1).max_depth(2).into_iter().flatten() {
            if entry.path().is_file() {
                if let Err(e) = std::fs::OpenOptions::new().write(true).open(entry.path()) {
                    let code = e.raw_os_error().unwrap_or(0);

                    if code == 32 || code == 33 {
                        return true;
                    }
                }
            }
        }
        false
    } else {
        false
    }
}

pub fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.0} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}
