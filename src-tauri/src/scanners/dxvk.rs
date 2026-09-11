use crate::everything::{make_client_from_install, EverythingClient};
use crate::scanners::CacheScanner;
use crate::types::{CacheEntry, CacheSource};
use log::info;
use std::path::PathBuf;
use uuid::Uuid;
use walkdir::WalkDir;

pub struct DxvkScanner {
    pub game_install_dirs: Vec<PathBuf>,
}

impl CacheScanner for DxvkScanner {
    fn name(&self) -> &'static str {
        "DXVK / VKD3D Cache"
    }

    fn scan(&self) -> Vec<CacheEntry> {
        if let Some(client) = make_client_from_install() {
            info!("[DxvkScanner] Using Everything HTTP API for full-system DXVK scan");
            if let Some(entries) = self.scan_via_everything(&client) {
                return entries;
            }
        }

        info!(
            "[DxvkScanner] Falling back to walkdir-based scan ({} known dirs)",
            self.game_install_dirs.len()
        );
        self.scan_via_walkdir()
    }
}

impl DxvkScanner {
    fn scan_via_everything(&self, client: &EverythingClient) -> Option<Vec<CacheEntry>> {
        let mut results = Vec::new();

        let dxvk_items = client.find_dxvk_caches()?;
        let vkd3d_items = client.find_vkd3d_caches().unwrap_or_default();

        info!(
            "[DxvkScanner] Everything: found {} DXVK + {} VKD3D caches",
            dxvk_items.len(),
            vkd3d_items.len()
        );

        for (items, source) in &[
            (dxvk_items, CacheSource::Dxvk),
            (vkd3d_items, CacheSource::Vkd3d),
        ] {
            for item in items {
                if !item.full_path.exists() {
                    continue;
                }
                let size_bytes = if item.size_bytes > 0 {
                    item.size_bytes
                } else {
                    item.full_path.metadata().map(|m| m.len()).unwrap_or(0)
                };

                let last_modified = item.last_modified_unix();

                let game_guess = item
                    .full_path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string());

                results.push(CacheEntry {
                    id: Uuid::new_v4().to_string(),
                    source: source.clone(),
                    path: item.full_path.to_string_lossy().to_string(),
                    size_bytes,
                    last_modified,
                    associated_game_id: None,
                    associated_game_guess: game_guess,
                    confidence: 0.3,
                });
            }
        }

        Some(results)
    }

    fn scan_via_walkdir(&self) -> Vec<CacheEntry> {
        let mut results = Vec::new();

        for install_dir in &self.game_install_dirs {
            if !install_dir.exists() {
                continue;
            }
            for entry in WalkDir::new(install_dir)
                .max_depth(2)
                .follow_links(false)
                .into_iter()
                .flatten()
            {
                let path = entry.path().to_path_buf();
                if !path.is_file() {
                    continue;
                }

                let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                let source = if fname.ends_with(".dxvk-cache") {
                    CacheSource::Dxvk
                } else if fname.ends_with(".vkd3d-cache") {
                    CacheSource::Vkd3d
                } else {
                    continue;
                };

                if let Ok(meta) = path.metadata() {
                    let size_bytes = meta.len();
                    let last_modified = meta
                        .modified()
                        .ok()
                        .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);

                    let game_guess = path
                        .parent()
                        .and_then(|p| p.file_name())
                        .and_then(|n| n.to_str())
                        .map(|s| s.to_string());

                    results.push(CacheEntry {
                        id: Uuid::new_v4().to_string(),
                        source,
                        path: path.to_string_lossy().to_string(),
                        size_bytes,
                        last_modified,
                        associated_game_id: None,
                        associated_game_guess: game_guess,
                        confidence: 0.3,
                    });
                }
            }
        }

        results
    }
}
