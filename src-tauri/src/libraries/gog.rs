use crate::libraries::GameLibrary;
use crate::types::{DetectedGame, GamePlatform};
use log::{debug, info, warn};
use std::path::PathBuf;

pub struct GogLibrary;

impl GogLibrary {
    #[cfg(windows)]
    fn detect_via_registry() -> Vec<DetectedGame> {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;

        let mut games = Vec::new();

        let gog_key = r"SOFTWARE\WOW6432Node\GOG.com\Games";
        let reg = match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(gog_key) {
            Ok(k) => k,
            Err(_) => {
                debug!("[GOG] Registry key not found: {gog_key}");
                return vec![];
            }
        };

        for subkey_name in reg.enum_keys().flatten() {
            let subkey = match reg.open_subkey(&subkey_name) {
                Ok(k) => k,
                Err(_) => continue,
            };

            let game_id: String = subkey.get_value("gameID").unwrap_or_default();
            let game_name: String = subkey.get_value("gameName").unwrap_or_default();
            let install_path: String = subkey.get_value("path").unwrap_or_default();
            let _exe: String = subkey.get_value("exe").unwrap_or_default();

            if game_name.is_empty() || install_path.is_empty() {
                continue;
            }

            let path = PathBuf::from(&install_path);
            if !path.exists() {
                debug!("[GOG] Skipping missing path: {install_path}");
                continue;
            }

            debug!("[GOG] Found via registry: {game_name} at {install_path}");

            games.push(DetectedGame {
                id: format!("gog_{game_id}"),
                name: game_name,
                platform: GamePlatform::Gog,
                install_path,
                exe_path: None,
                app_id: Some(game_id),
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

        games
    }

    #[cfg(not(windows))]
    fn detect_via_registry() -> Vec<DetectedGame> {
        vec![]
    }

    fn detect_via_galaxy_db() -> Vec<DetectedGame> {
        let db_path = PathBuf::from(r"C:\ProgramData\GOG.com\Galaxy\storage\galaxy-2.0.db");
        if !db_path.exists() {
            return vec![];
        }

        debug!("[GOG] Trying Galaxy DB at {}", db_path.display());

        let conn = match rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            Ok(c) => c,
            Err(e) => {
                warn!("[GOG] Failed to open Galaxy DB: {e}");
                return vec![];
            }
        };

        let sql = r#"
            SELECT DISTINCT
                p.productId,
                pp.value as title,
                ip.installationPath
            FROM InstalledBaseProducts ip
            LEFT JOIN ProductPurchaseDates pp
                ON ip.productId = pp.productId AND pp.gamePieceTypeId = 'originalTitle'
            ORDER BY pp.value
        "#;

        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(e) => {
                debug!("[GOG] Galaxy DB query failed (schema may differ): {e}");
                return vec![];
            }
        };

        let games: Vec<DetectedGame> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0).unwrap_or_default(),
                    row.get::<_, String>(1).unwrap_or_default(),
                    row.get::<_, String>(2).unwrap_or_default(),
                ))
            })
            .ok()
            .map(|rows| {
                rows.flatten()
                    .filter(|(_, name, path)| !name.is_empty() && !path.is_empty())
                    .map(|(id, name, install_path)| {
                        debug!("[GOG] DB found: {name} at {install_path}");
                        DetectedGame {
                            id: format!("gog_{id}"),
                            name,
                            platform: GamePlatform::Gog,
                            install_path,
                            exe_path: None,
                            app_id: Some(id),
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
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();

        games
    }
}

impl GameLibrary for GogLibrary {
    fn name(&self) -> &'static str {
        "GOG Galaxy"
    }

    fn detect(&self) -> Vec<DetectedGame> {
        let mut games = Self::detect_via_registry();

        if games.is_empty() {
            games = Self::detect_via_galaxy_db();
        }

        info!("[GOG] Detected {} games", games.len());
        games
    }
}
