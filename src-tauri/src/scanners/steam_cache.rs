use crate::scanners::CacheScanner;
use crate::types::{CacheEntry, CacheSource};
use crate::utils::dir_size_and_mtime;
use std::path::PathBuf;
use uuid::Uuid;

pub struct SteamCacheScanner {
    pub steam_libraries: Vec<PathBuf>,
}

impl CacheScanner for SteamCacheScanner {
    fn name(&self) -> &'static str {
        "Steam Shader Pre-Cache"
    }

    fn scan(&self) -> Vec<CacheEntry> {
        let mut results = Vec::new();

        for lib_path in &self.steam_libraries {
            let cache_root = lib_path.join("steamapps").join("shadercache");
            if !cache_root.exists() {
                continue;
            }

            let read_dir = match std::fs::read_dir(&cache_root) {
                Ok(rd) => rd,
                Err(_) => continue,
            };
            for entry in read_dir.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let app_id = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string());

                let (size_bytes, last_modified) = dir_size_and_mtime(&path);
                if size_bytes == 0 {
                    continue;
                }

                results.push(CacheEntry {
                    id: Uuid::new_v4().to_string(),
                    source: CacheSource::SteamShaderPrecache,
                    path: path.to_string_lossy().to_string(),
                    size_bytes,
                    last_modified,
                    associated_game_id: app_id.clone(),
                    associated_game_guess: None,
                    confidence: if app_id.is_some() { 1.0 } else { 0.0 },
                });
            }
        }

        results
    }
}
