use crate::libraries::GameLibrary;
use crate::types::{DetectedGame, GamePlatform};
use log::{debug, info, warn};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
#[allow(dead_code)]
struct EpicManifest {
    display_name: Option<String>,
    install_location: Option<String>,
    app_name: Option<String>,
    catalog_item_id: Option<String>,
    launch_executable: Option<String>,
    #[serde(default)]
    is_incomplete_install: bool,
}

pub struct EpicLibrary;

impl EpicLibrary {
    fn manifests_dir() -> PathBuf {
        PathBuf::from(r"C:\ProgramData\Epic\EpicGamesLauncher\Data\Manifests")
    }
}

impl GameLibrary for EpicLibrary {
    fn name(&self) -> &'static str {
        "Epic Games Store"
    }

    fn detect(&self) -> Vec<DetectedGame> {
        let manifests_dir = Self::manifests_dir();
        if !manifests_dir.exists() {
            debug!(
                "[Epic] Manifests dir not found: {}",
                manifests_dir.display()
            );
            return vec![];
        }

        let mut games = Vec::new();

        let read_dir = match std::fs::read_dir(&manifests_dir) {
            Ok(rd) => rd,
            Err(e) => {
                warn!("[Epic] Failed to read manifests dir: {e}");
                return vec![];
            }
        };

        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("item") {
                continue;
            }

            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(e) => {
                    warn!("[Epic] Failed to read {}: {e}", path.display());
                    continue;
                }
            };

            let manifest: EpicManifest = match serde_json::from_str(&content) {
                Ok(m) => m,
                Err(e) => {
                    warn!("[Epic] Failed to parse {}: {e}", path.display());
                    continue;
                }
            };

            if manifest.is_incomplete_install {
                continue;
            }

            let name = match manifest.display_name {
                Some(n) if !n.is_empty() => n,
                _ => continue,
            };

            let install_path = manifest.install_location.unwrap_or_default();
            let app_name = manifest.app_name.clone().unwrap_or_default();

            if install_path.is_empty() || app_name.is_empty() {
                continue;
            }

            if manifest
                .launch_executable
                .as_deref()
                .map(|e| e.is_empty())
                .unwrap_or(false)
            {
                debug!("[Epic] Skipping (no launch executable): {name}");
            }

            debug!("[Epic] Found: {name} at {install_path}");

            let exe_path = manifest
                .launch_executable
                .filter(|e| !e.is_empty())
                .map(|e| {
                    std::path::Path::new(&install_path)
                        .join(e)
                        .to_string_lossy()
                        .to_string()
                });

            games.push(DetectedGame {
                id: format!("epic_{app_name}"),
                name,
                platform: GamePlatform::Epic,
                install_path,
                exe_path,
                app_id: Some(app_name),
                last_played: None,
                icon_url: None,
                cover_url: None,
                hero_url: None,
                logo_url: None,
                description: None,
                genres: Vec::new(),
                developer: None,
                publisher: None,
                release_date: None,
                playtime_seconds: 0,
                install_size_bytes: 0,
            });
        }

        info!("[Epic] Detected {} games", games.len());
        games
    }
}
