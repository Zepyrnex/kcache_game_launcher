use crate::libraries::GameLibrary;
use crate::types::{DetectedGame, GamePlatform};
use std::collections::HashMap;
use std::path::PathBuf;

pub struct SteamLibrary;

impl SteamLibrary {
    pub fn get_library_paths() -> Vec<PathBuf> {
        let mut paths = Vec::new();

        let candidates = Self::steam_install_candidates();

        for steam_root in candidates {
            if !steam_root.exists() {
                continue;
            }

            let default_lib = steam_root.join("steamapps");
            if default_lib.exists() {
                paths.push(steam_root.clone());
            }

            let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
            if let Ok(content) = std::fs::read_to_string(&vdf_path) {
                let extra = Self::parse_libraryfolders_vdf(&content);
                paths.extend(extra);
            }
        }

        let mut unique_paths = Vec::new();
        let mut seen_keys = std::collections::HashSet::new();

        for p in paths {
            let norm_key = std::fs::canonicalize(&p)
                .unwrap_or_else(|_| p.clone())
                .to_string_lossy()
                .trim_start_matches(r"\\?\")
                .trim_end_matches(['\\', '/'])
                .to_lowercase();

            if seen_keys.insert(norm_key) {
                unique_paths.push(p);
            }
        }

        unique_paths
    }

    fn steam_install_candidates() -> Vec<PathBuf> {
        let mut candidates = Vec::new();

        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
        candidates.push(PathBuf::from(r"C:\Program Files\Steam"));

        #[cfg(windows)]
        {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;
            if let Ok(hkcu) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam")
            {
                if let Ok(path) = hkcu.get_value::<String, _>("SteamPath") {
                    candidates.push(PathBuf::from(path.replace('/', "\\")));
                }
            }
        }

        candidates
    }

    fn parse_libraryfolders_vdf(content: &str) -> Vec<PathBuf> {
        let mut paths = Vec::new();

        let path_re = regex::Regex::new(r#""path"\s+"([^"]+)""#).unwrap();
        for cap in path_re.captures_iter(content) {
            let raw = cap[1].replace("\\\\", "\\");
            let p = PathBuf::from(&raw);
            if p.exists() {
                paths.push(p);
            }
        }

        if paths.is_empty() {
            let old_re = regex::Regex::new(r#""\d+"\s+"([A-Za-z]:[^"]+)""#).unwrap();
            for cap in old_re.captures_iter(content) {
                let raw = cap[1].replace("\\\\", "\\");
                let p = PathBuf::from(&raw);
                if p.exists() {
                    paths.push(p);
                }
            }
        }

        paths
    }

    fn parse_acf(content: &str) -> HashMap<String, String> {
        let mut map = HashMap::new();
        let re = regex::Regex::new(r#""(\w+)"\s+"([^"]*)"#).unwrap();
        for cap in re.captures_iter(content) {
            map.insert(cap[1].to_lowercase(), cap[2].to_string());
        }
        map
    }
}

impl GameLibrary for SteamLibrary {
    fn name(&self) -> &'static str {
        "Steam"
    }

    fn detect(&self) -> Vec<DetectedGame> {
        let mut games = Vec::new();
        let mut seen_app_ids = std::collections::HashSet::new();
        let library_paths = Self::get_library_paths();

        for lib_path in &library_paths {
            let steamapps = lib_path.join("steamapps");
            if !steamapps.exists() {
                continue;
            }

            let read_dir = match std::fs::read_dir(&steamapps) {
                Ok(rd) => rd,
                Err(_) => continue,
            };

            for entry in read_dir.flatten() {
                let path = entry.path();
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

                if !name.starts_with("appmanifest_") || !name.ends_with(".acf") {
                    continue;
                }

                let content = match std::fs::read_to_string(&path) {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let fields = Self::parse_acf(&content);

                let app_id = fields.get("appid").cloned().unwrap_or_default();
                let game_name = fields
                    .get("name")
                    .cloned()
                    .unwrap_or_else(|| "Unknown".into());
                let install_dir_name = fields.get("installdir").cloned().unwrap_or_default();
                let last_played: Option<i64> = fields
                    .get("lastplayed")
                    .and_then(|s| s.parse().ok())
                    .filter(|&v: &i64| v > 0);

                if app_id.is_empty() || game_name == "Unknown" {
                    continue;
                }

                if !seen_app_ids.insert(app_id.clone()) {
                    continue;
                }

                let install_path = steamapps
                    .join("common")
                    .join(&install_dir_name)
                    .to_string_lossy()
                    .to_string();

                let cover_url = Some(crate::steam_api::SteamApiClient::get_cdn_cover_url(&app_id));
                let hero_url = Some(crate::steam_api::SteamApiClient::get_cdn_hero_url(&app_id));
                let logo_url = Some(crate::steam_api::SteamApiClient::get_cdn_logo_url(&app_id));

                games.push(DetectedGame {
                    id: format!("steam_{app_id}"),
                    name: game_name,
                    platform: GamePlatform::Steam,
                    install_path,
                    exe_path: None,
                    app_id: Some(app_id),
                    last_played,
                    icon_url: cover_url.clone(),
                    cover_url,
                    hero_url,
                    logo_url,
                    description: None,
                    genres: Vec::new(),
                    developer: None,
                    publisher: None,
                    release_date: None,
                    playtime_seconds: 0,
                    install_size_bytes: 0,
                });
            }
        }

        games
    }
}
