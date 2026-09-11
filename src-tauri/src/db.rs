use crate::types::{
    BackupRecord, CacheEntry, CacheSource, CompressedVaultEntry, CompressionAlgorithm,
    DetectedGame, GamePlatform, ScanFolder,
};
use log::info;
use rusqlite::{params, Connection, OptionalExtension, Result};
use std::path::PathBuf;

pub struct Database {
    conn: Connection,
}

impl Database {
    pub fn open(db_path: &PathBuf) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = Connection::open(db_path)?;
        let db = Self { conn };
        db.initialize()?;
        Ok(db)
    }

    fn initialize(&self) -> Result<()> {
        self.conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        self.conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        self.conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS games (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                platform    TEXT NOT NULL,
                install_path TEXT NOT NULL DEFAULT '',
                exe_path    TEXT NOT NULL DEFAULT '',
                app_id      TEXT,
                last_played INTEGER,
                icon_url    TEXT,
                cover_url   TEXT NOT NULL DEFAULT '',
                hero_url    TEXT NOT NULL DEFAULT '',
                logo_url    TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                genres      TEXT NOT NULL DEFAULT '[]',
                developer   TEXT NOT NULL DEFAULT '',
                publisher   TEXT NOT NULL DEFAULT '',
                release_date TEXT NOT NULL DEFAULT '',
                updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS scan_folders (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                path        TEXT NOT NULL UNIQUE,
                enabled     INTEGER NOT NULL DEFAULT 1,
                created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS game_metadata_cache (
                app_id      TEXT PRIMARY KEY,
                data_json   TEXT NOT NULL,
                cached_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS cache_entries (
                id              TEXT PRIMARY KEY,
                game_id         TEXT REFERENCES games(id) ON DELETE CASCADE,
                source          TEXT NOT NULL,
                path            TEXT NOT NULL UNIQUE,
                size_bytes      INTEGER NOT NULL DEFAULT 0,
                last_modified   INTEGER NOT NULL DEFAULT 0,
                scan_time       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                confidence      REAL NOT NULL DEFAULT 0.0
            );

            CREATE TABLE IF NOT EXISTS backups (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id         TEXT NOT NULL,
                game_name       TEXT NOT NULL,
                archive_path    TEXT NOT NULL,
                created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                size_bytes      INTEGER NOT NULL DEFAULT 0,
                notes           TEXT,
                original_paths  TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS trash (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                original_path   TEXT NOT NULL,
                trash_path      TEXT NOT NULL,
                game_id         TEXT,
                game_name       TEXT,
                deleted_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS settings (
                key     TEXT PRIMARY KEY,
                value   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS excluded_games (
                id              TEXT PRIMARY KEY,
                name            TEXT NOT NULL,
                platform        TEXT NOT NULL,
                app_id          TEXT,
                exe_path        TEXT,
                excluded_at     INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS compressed_vault_entries (
                id              TEXT PRIMARY KEY,
                cache_id        TEXT NOT NULL,
                game_id         TEXT,
                game_name       TEXT NOT NULL,
                original_path   TEXT NOT NULL,
                compressed_path TEXT NOT NULL,
                algorithm       TEXT NOT NULL,
                original_size   INTEGER NOT NULL,
                compressed_size INTEGER NOT NULL,
                ratio           REAL NOT NULL,
                compressed_at   INTEGER NOT NULL,
                status          TEXT NOT NULL DEFAULT 'compressed'
            );

            CREATE INDEX IF NOT EXISTS idx_cache_game ON cache_entries(game_id);
            CREATE INDEX IF NOT EXISTS idx_backups_game ON backups(game_id);
            CREATE INDEX IF NOT EXISTS idx_trash_game ON trash(game_id);
            CREATE INDEX IF NOT EXISTS idx_excluded_games ON excluded_games(id);
            CREATE INDEX IF NOT EXISTS idx_vault_game ON compressed_vault_entries(game_id);
            CREATE INDEX IF NOT EXISTS idx_vault_cache ON compressed_vault_entries(cache_id);
        "#,
        )?;

        self.conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);",
        )?;

        let has_version_row: bool = self
            .conn
            .query_row("SELECT 1 FROM schema_version LIMIT 1", [], |_| Ok(true))
            .unwrap_or(false);

        if !has_version_row {
            self.conn
                .execute("INSERT INTO schema_version (version) VALUES (0)", [])?;
        }

        let current_version: i32 =
            self.conn
                .query_row("SELECT version FROM schema_version LIMIT 1", [], |row| {
                    row.get(0)
                })?;

        let existing_columns: std::collections::HashSet<String> = {
            let mut stmt = self.conn.prepare("PRAGMA table_info(games)")?;
            let names = stmt
                .query_map([], |row| row.get::<_, String>(1))?
                .flatten()
                .collect();
            names
        };

        if current_version < 1 {
            let tx = self.conn.unchecked_transaction()?;

            let columns_to_add = [
                (
                    "exe_path",
                    "ALTER TABLE games ADD COLUMN exe_path TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "cover_url",
                    "ALTER TABLE games ADD COLUMN cover_url TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "hero_url",
                    "ALTER TABLE games ADD COLUMN hero_url TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "logo_url",
                    "ALTER TABLE games ADD COLUMN logo_url TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "description",
                    "ALTER TABLE games ADD COLUMN description TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "genres",
                    "ALTER TABLE games ADD COLUMN genres TEXT NOT NULL DEFAULT '[]'",
                ),
                (
                    "developer",
                    "ALTER TABLE games ADD COLUMN developer TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "publisher",
                    "ALTER TABLE games ADD COLUMN publisher TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "release_date",
                    "ALTER TABLE games ADD COLUMN release_date TEXT NOT NULL DEFAULT ''",
                ),
                (
                    "playtime_seconds",
                    "ALTER TABLE games ADD COLUMN playtime_seconds INTEGER NOT NULL DEFAULT 0",
                ),
                (
                    "install_size_bytes",
                    "ALTER TABLE games ADD COLUMN install_size_bytes INTEGER NOT NULL DEFAULT 0",
                ),
            ];

            for (col_name, sql) in columns_to_add {
                if !existing_columns.contains(col_name) {
                    tx.execute(sql, [])?;
                }
            }

            tx.execute("UPDATE schema_version SET version = 1", [])?;
            tx.commit()?;
        }

        self.conn.execute_batch(
            r#"
            INSERT OR IGNORE INTO settings(key, value) VALUES
                ('theme', 'dark'),
                ('accent_color', '#7C3AED'),
                ('backup_dir', ''),
                ('steam_api_key', ''),
                ('steam_id', ''),
                ('launcher_layout', 'grid'),
                ('excluded_paths', '[]'),
                ('excluded_game_ids', '[]');
        "#,
        )?;

        let _ = self.conn.execute_batch(r#"
            DELETE FROM games WHERE rowid NOT IN (
                SELECT MIN(rowid) FROM games
                GROUP BY
                    CASE
                        WHEN exe_path IS NOT NULL AND exe_path != '' THEN LOWER(REPLACE(exe_path, '/', '\'))
                        WHEN app_id IS NOT NULL AND app_id != '' THEN 'steam_' || app_id
                        ELSE LOWER(id)
                    END
            );
        "#);

        let old_key: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'steam_api_key'",
                [],
                |row| row.get(0),
            )
            .ok();

        if let Some(key) = old_key {
            let trimmed = key.trim();
            if !trimmed.is_empty() {
                let _ = crate::utils::set_steam_api_key(trimmed);
            }
            let _ = self.conn.execute(
                "UPDATE settings SET value = '' WHERE key = 'steam_api_key'",
                [],
            );
        }

        info!("[DB] Schema initialized");
        Ok(())
    }

    pub fn upsert_game(&self, game: &DetectedGame) -> Result<()> {
        let genres_json = serde_json::to_string(&game.genres).unwrap_or_else(|_| "[]".to_string());
        self.conn.execute(
            r#"INSERT INTO games(
                 id, name, platform, install_path, exe_path, app_id, last_played, icon_url,
                 cover_url, hero_url, logo_url, description, genres, developer, publisher, release_date,
                 playtime_seconds, install_size_bytes
               )
               VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)
               ON CONFLICT(id) DO UPDATE SET
                 name = excluded.name,
                 platform = excluded.platform,
                 install_path = excluded.install_path,
                 exe_path = CASE WHEN excluded.exe_path != '' THEN excluded.exe_path ELSE games.exe_path END,
                 app_id = COALESCE(excluded.app_id, games.app_id),
                 last_played = COALESCE(excluded.last_played, games.last_played),
                 icon_url = COALESCE(excluded.icon_url, games.icon_url),
                 cover_url = CASE WHEN excluded.cover_url != '' THEN excluded.cover_url ELSE games.cover_url END,
                 hero_url = CASE WHEN excluded.hero_url != '' THEN excluded.hero_url ELSE games.hero_url END,
                 logo_url = CASE WHEN excluded.logo_url != '' THEN excluded.logo_url ELSE games.logo_url END,
                 description = CASE WHEN excluded.description != '' THEN excluded.description ELSE games.description END,
                 genres = CASE WHEN excluded.genres != '[]' THEN excluded.genres ELSE games.genres END,
                 developer = CASE WHEN excluded.developer != '' THEN excluded.developer ELSE games.developer END,
                 publisher = CASE WHEN excluded.publisher != '' THEN excluded.publisher ELSE games.publisher END,
                 release_date = CASE WHEN excluded.release_date != '' THEN excluded.release_date ELSE games.release_date END,
                 playtime_seconds = CASE WHEN games.playtime_seconds > 0 THEN games.playtime_seconds ELSE excluded.playtime_seconds END,
                 install_size_bytes = CASE WHEN games.install_size_bytes > 0 THEN games.install_size_bytes ELSE excluded.install_size_bytes END,
                 updated_at = strftime('%s','now')"#,
            params![
                game.id,
                game.name,
                format!("{:?}", game.platform),
                game.install_path,
                game.exe_path.as_deref().unwrap_or(""),
                game.app_id,
                game.last_played,
                game.icon_url,
                game.cover_url.as_deref().unwrap_or(""),
                game.hero_url.as_deref().unwrap_or(""),
                game.logo_url.as_deref().unwrap_or(""),
                game.description.as_deref().unwrap_or(""),
                genres_json,
                game.developer.as_deref().unwrap_or(""),
                game.publisher.as_deref().unwrap_or(""),
                game.release_date.as_deref().unwrap_or(""),
                game.playtime_seconds,
                game.install_size_bytes,
            ],
        )?;
        Ok(())
    }

    pub fn get_all_games(&self) -> Result<Vec<DetectedGame>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT id, name, platform, install_path, exe_path, app_id, last_played, icon_url,
                      cover_url, hero_url, logo_url, description, genres, developer, publisher, release_date,
                      playtime_seconds, install_size_bytes
               FROM games ORDER BY name"#
        )?;
        let games = stmt
            .query_map([], |row| {
                let platform_str: String = row.get(2)?;
                let platform = match platform_str.as_str() {
                    "Steam" => GamePlatform::Steam,
                    "Epic" => GamePlatform::Epic,
                    "Gog" => GamePlatform::Gog,
                    "Xbox" => GamePlatform::Xbox,
                    "Custom" => GamePlatform::Custom,
                    _ => GamePlatform::Unknown,
                };
                let exe_path_raw: String = row.get(4)?;
                let cover_raw: String = row.get(8)?;
                let hero_raw: String = row.get(9)?;
                let logo_raw: String = row.get(10)?;
                let desc_raw: String = row.get(11)?;
                let genres_raw: String = row.get(12)?;
                let dev_raw: String = row.get(13)?;
                let pub_raw: String = row.get(14)?;
                let rel_raw: String = row.get(15)?;
                let playtime: u64 = row.get::<_, Option<u64>>(16)?.unwrap_or(0);
                let install_size: u64 = row.get::<_, Option<u64>>(17)?.unwrap_or(0);

                let genres: Vec<String> = serde_json::from_str(&genres_raw).unwrap_or_default();

                Ok(DetectedGame {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    platform,
                    install_path: row.get(3)?,
                    exe_path: if exe_path_raw.is_empty() {
                        None
                    } else {
                        Some(exe_path_raw)
                    },
                    app_id: row.get(5)?,
                    last_played: row.get(6)?,
                    icon_url: row.get(7)?,
                    cover_url: if cover_raw.is_empty() {
                        None
                    } else {
                        Some(cover_raw)
                    },
                    hero_url: if hero_raw.is_empty() {
                        None
                    } else {
                        Some(hero_raw)
                    },
                    logo_url: if logo_raw.is_empty() {
                        None
                    } else {
                        Some(logo_raw)
                    },
                    description: if desc_raw.is_empty() {
                        None
                    } else {
                        Some(desc_raw)
                    },
                    genres,
                    developer: if dev_raw.is_empty() {
                        None
                    } else {
                        Some(dev_raw)
                    },
                    publisher: if pub_raw.is_empty() {
                        None
                    } else {
                        Some(pub_raw)
                    },
                    release_date: if rel_raw.is_empty() {
                        None
                    } else {
                        Some(rel_raw)
                    },
                    playtime_seconds: playtime,
                    install_size_bytes: install_size,
                })
            })?
            .flatten()
            .collect();
        Ok(games)
    }

    pub fn get_game_by_id(&self, id: &str) -> Result<Option<DetectedGame>> {
        let mut stmt = self.conn.prepare(
            r#"SELECT id, name, platform, install_path, exe_path, app_id, last_played, icon_url,
                      cover_url, hero_url, logo_url, description, genres, developer, publisher, release_date,
                      playtime_seconds, install_size_bytes
               FROM games WHERE id = ?1"#
        )?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            let platform_str: String = row.get(2)?;
            let platform = match platform_str.as_str() {
                "Steam" => GamePlatform::Steam,
                "Epic" => GamePlatform::Epic,
                "Gog" => GamePlatform::Gog,
                "Xbox" => GamePlatform::Xbox,
                "Custom" => GamePlatform::Custom,
                _ => GamePlatform::Unknown,
            };
            let exe_path_raw: String = row.get(4)?;
            let cover_raw: String = row.get(8)?;
            let hero_raw: String = row.get(9)?;
            let logo_raw: String = row.get(10)?;
            let desc_raw: String = row.get(11)?;
            let genres_raw: String = row.get(12)?;
            let dev_raw: String = row.get(13)?;
            let pub_raw: String = row.get(14)?;
            let rel_raw: String = row.get(15)?;
            let playtime: u64 = row.get::<_, Option<u64>>(16)?.unwrap_or(0);
            let install_size: u64 = row.get::<_, Option<u64>>(17)?.unwrap_or(0);

            let genres: Vec<String> = serde_json::from_str(&genres_raw).unwrap_or_default();

            Ok(Some(DetectedGame {
                id: row.get(0)?,
                name: row.get(1)?,
                platform,
                install_path: row.get(3)?,
                exe_path: if exe_path_raw.is_empty() {
                    None
                } else {
                    Some(exe_path_raw)
                },
                app_id: row.get(5)?,
                last_played: row.get(6)?,
                icon_url: row.get(7)?,
                cover_url: if cover_raw.is_empty() {
                    None
                } else {
                    Some(cover_raw)
                },
                hero_url: if hero_raw.is_empty() {
                    None
                } else {
                    Some(hero_raw)
                },
                logo_url: if logo_raw.is_empty() {
                    None
                } else {
                    Some(logo_raw)
                },
                description: if desc_raw.is_empty() {
                    None
                } else {
                    Some(desc_raw)
                },
                genres,
                developer: if dev_raw.is_empty() {
                    None
                } else {
                    Some(dev_raw)
                },
                publisher: if pub_raw.is_empty() {
                    None
                } else {
                    Some(pub_raw)
                },
                release_date: if rel_raw.is_empty() {
                    None
                } else {
                    Some(rel_raw)
                },
                playtime_seconds: playtime,
                install_size_bytes: install_size,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn add_game_playtime(
        &self,
        id: &str,
        additional_seconds: u64,
        last_played: i64,
    ) -> Result<u64> {
        self.conn.execute(
            "UPDATE games SET playtime_seconds = playtime_seconds + ?1, last_played = ?2, updated_at = strftime('%s','now') WHERE id = ?3",
            params![additional_seconds, last_played, id],
        )?;
        let mut stmt = self
            .conn
            .prepare("SELECT playtime_seconds FROM games WHERE id = ?1")?;
        let total: u64 = stmt.query_row(params![id], |row| row.get(0)).unwrap_or(0);
        Ok(total)
    }

    pub fn get_game_playtime(&self, id: &str) -> Result<u64> {
        let mut stmt = self
            .conn
            .prepare("SELECT playtime_seconds FROM games WHERE id = ?1")?;
        let total: u64 = stmt.query_row(params![id], |row| row.get(0)).unwrap_or(0);
        Ok(total)
    }

    pub fn update_game_install_size(&self, id: &str, size_bytes: u64) -> Result<()> {
        self.conn.execute(
            "UPDATE games SET install_size_bytes = ?1, updated_at = strftime('%s','now') WHERE id = ?2",
            params![size_bytes, id],
        )?;
        Ok(())
    }

    pub fn delete_game(&self, id: &str) -> Result<()> {
        let _ = self
            .conn
            .execute("DELETE FROM cache_entries WHERE game_id = ?1", params![id]);
        self.conn
            .execute("DELETE FROM games WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn update_last_played(&self, id: &str, timestamp: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE games SET last_played = ?1 WHERE id = ?2",
            params![timestamp, id],
        )?;
        Ok(())
    }

    pub fn update_game_metadata(
        &self,
        id: &str,
        name: Option<&str>,
        app_id: Option<&str>,
        cover_url: Option<&str>,
        hero_url: Option<&str>,
        logo_url: Option<&str>,
        description: Option<&str>,
        genres: Option<&[String]>,
        developer: Option<&str>,
        publisher: Option<&str>,
        release_date: Option<&str>,
    ) -> Result<()> {
        let existing = self.get_game_by_id(id)?;
        if let Some(mut game) = existing {
            if let Some(n) = name {
                if !n.is_empty() {
                    game.name = n.to_string();
                }
            }
            if let Some(a) = app_id {
                game.app_id = Some(a.to_string());
            }
            if let Some(c) = cover_url {
                game.cover_url = Some(c.to_string());
            }
            if let Some(h) = hero_url {
                game.hero_url = Some(h.to_string());
            }
            if let Some(l) = logo_url {
                game.logo_url = Some(l.to_string());
            }
            if let Some(d) = description {
                game.description = Some(d.to_string());
            }
            if let Some(g) = genres {
                game.genres = g.to_vec();
            }
            if let Some(dev) = developer {
                game.developer = Some(dev.to_string());
            }
            if let Some(publ) = publisher {
                game.publisher = Some(publ.to_string());
            }
            if let Some(rel) = release_date {
                game.release_date = Some(rel.to_string());
            }

            self.upsert_game(&game)?;
        }
        Ok(())
    }

    pub fn update_game_exe_path(&self, id: &str, exe_path: &str) -> Result<()> {
        let parent_dir = std::path::Path::new(exe_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        self.conn.execute(
            "UPDATE games SET exe_path = ?1, install_path = CASE WHEN install_path = '' THEN ?2 ELSE install_path END, updated_at = strftime('%s','now') WHERE id = ?3",
            params![exe_path, parent_dir, id],
        )?;
        Ok(())
    }

    pub fn get_scan_folders(&self) -> Result<Vec<ScanFolder>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, path, enabled, created_at FROM scan_folders ORDER BY id ASC")?;
        let folders = stmt
            .query_map([], |row| {
                let enabled_int: i64 = row.get(2)?;
                Ok(ScanFolder {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    enabled: enabled_int == 1,
                    created_at: row.get(3)?,
                })
            })?
            .flatten()
            .collect();
        Ok(folders)
    }

    pub fn add_scan_folder(&self, path: &str) -> Result<ScanFolder> {
        self.conn.execute(
            "INSERT OR IGNORE INTO scan_folders(path, enabled) VALUES(?1, 1)",
            params![path],
        )?;
        let mut stmt = self
            .conn
            .prepare("SELECT id, path, enabled, created_at FROM scan_folders WHERE path = ?1")?;
        stmt.query_row(params![path], |row| {
            let enabled_int: i64 = row.get(2)?;
            Ok(ScanFolder {
                id: row.get(0)?,
                path: row.get(1)?,
                enabled: enabled_int == 1,
                created_at: row.get(3)?,
            })
        })
    }

    pub fn remove_scan_folder(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM scan_folders WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn toggle_scan_folder(&self, id: i64, enabled: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE scan_folders SET enabled = ?1 WHERE id = ?2",
            params![if enabled { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    pub fn get_cached_metadata(&self, app_id: &str) -> Result<Option<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT data_json FROM game_metadata_cache WHERE app_id = ?1")?;
        let mut rows = stmt.query(params![app_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn cache_metadata(&self, app_id: &str, data_json: &str) -> Result<()> {
        self.conn.execute(
            r#"INSERT INTO game_metadata_cache(app_id, data_json, cached_at)
               VALUES(?1, ?2, strftime('%s','now'))
               ON CONFLICT(app_id) DO UPDATE SET
                 data_json = excluded.data_json,
                 cached_at = strftime('%s','now')"#,
            params![app_id, data_json],
        )?;
        Ok(())
    }

    pub fn upsert_cache_entry(&self, entry: &CacheEntry) -> Result<()> {
        self.conn.execute(
            r#"INSERT INTO cache_entries(id, game_id, source, path, size_bytes, last_modified, confidence)
               VALUES(?1,?2,?3,?4,?5,?6,?7)
               ON CONFLICT(path) DO UPDATE SET
                 game_id=excluded.game_id,
                 source=excluded.source,
                 size_bytes=excluded.size_bytes,
                 last_modified=excluded.last_modified,
                 confidence=excluded.confidence,
                 scan_time=strftime('%s','now')"#,
            params![
                entry.id,
                entry.associated_game_id,
                format!("{}", entry.source),
                entry.path,
                entry.size_bytes as i64,
                entry.last_modified,
                entry.confidence as f64,
            ],
        )?;
        Ok(())
    }

    pub fn get_caches_for_game(&self, game_id: &str) -> Result<Vec<CacheEntry>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, game_id, source, path, size_bytes, last_modified, confidence FROM cache_entries WHERE game_id=?1"
        )?;
        let entries = stmt
            .query_map([game_id], |row| {
                Ok(CacheEntry {
                    id: row.get(0)?,
                    associated_game_id: row.get(1)?,
                    source: CacheSource::Unknown,
                    path: row.get(3)?,
                    size_bytes: row.get::<_, i64>(4)? as u64,
                    last_modified: row.get(5)?,
                    associated_game_guess: None,
                    confidence: row.get::<_, f64>(6)? as f32,
                })
            })?
            .flatten()
            .collect();
        Ok(entries)
    }

    pub fn delete_cache_entry_by_path(&self, path: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM cache_entries WHERE path=?1", [path])?;
        Ok(())
    }

    pub fn add_to_trash(
        &self,
        original_path: &str,
        trash_path: &str,
        game_id: Option<&str>,
        game_name: Option<&str>,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO trash(original_path, trash_path, game_id, game_name) VALUES(?1,?2,?3,?4)",
            params![original_path, trash_path, game_id, game_name],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_trash_items(&self) -> Result<Vec<TrashRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, original_path, trash_path, game_id, game_name, deleted_at FROM trash ORDER BY deleted_at DESC"
        )?;
        let items = stmt
            .query_map([], |row| {
                Ok(TrashRecord {
                    id: row.get(0)?,
                    original_path: row.get(1)?,
                    trash_path: row.get(2)?,
                    game_id: row.get(3)?,
                    game_name: row.get(4)?,
                    deleted_at: row.get(5)?,
                })
            })?
            .flatten()
            .collect();
        Ok(items)
    }

    pub fn remove_from_trash(&self, trash_id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM trash WHERE id=?1", [trash_id])?;
        Ok(())
    }

    pub fn add_backup(&self, backup: &BackupRecord) -> Result<i64> {
        let paths_json = serde_json::to_string(&backup.original_paths).unwrap_or_default();
        self.conn.execute(
            "INSERT INTO backups(game_id, game_name, archive_path, size_bytes, notes, original_paths) VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                backup.game_id,
                backup.game_name,
                backup.archive_path,
                backup.size_bytes as i64,
                backup.notes,
                paths_json,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_backups_for_game(&self, game_id: &str) -> Result<Vec<BackupRecord>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, game_id, game_name, archive_path, created_at, size_bytes, notes, original_paths FROM backups WHERE game_id=?1 ORDER BY created_at DESC"
        )?;
        let records = stmt
            .query_map([game_id], |row| {
                let paths_json: String = row.get(7)?;
                let original_paths: Vec<String> =
                    serde_json::from_str(&paths_json).unwrap_or_default();
                Ok(BackupRecord {
                    id: row.get(0)?,
                    game_id: row.get(1)?,
                    game_name: row.get(2)?,
                    archive_path: row.get(3)?,
                    created_at: row.get(4)?,
                    size_bytes: row.get::<_, i64>(5)? as u64,
                    notes: row.get(6)?,
                    original_paths,
                })
            })?
            .flatten()
            .collect();
        Ok(records)
    }

    pub fn delete_backup(&self, backup_id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM backups WHERE id=?1", [backup_id])?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        if key == "steam_api_key" {
            return Ok(crate::utils::get_steam_api_key());
        }
        self.conn
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        if key == "steam_api_key" {
            let _ = crate::utils::set_steam_api_key(value);
            let _ = self.conn.execute(
                "UPDATE settings SET value = '' WHERE key = 'steam_api_key'",
                [],
            );
            return Ok(());
        }
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_all_settings(&self) -> Result<std::collections::HashMap<String, String>> {
        let mut stmt = self.conn.prepare("SELECT key, value FROM settings")?;
        let mut map: std::collections::HashMap<String, String> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .flatten()
            .collect();
        if let Some(key) = crate::utils::get_steam_api_key() {
            map.insert("steam_api_key".to_string(), key);
        } else {
            map.insert("steam_api_key".to_string(), String::new());
        }
        Ok(map)
    }

    pub fn exclude_game(&self, game: &DetectedGame) -> Result<()> {
        let platform_str = format!("{:?}", game.platform);
        self.conn.execute(
            "INSERT OR REPLACE INTO excluded_games(id, name, platform, app_id, exe_path, excluded_at)
             VALUES(?1, ?2, ?3, ?4, ?5, strftime('%s','now'))",
            params![
                game.id,
                game.name,
                platform_str,
                game.app_id.as_deref().unwrap_or(""),
                game.exe_path.as_deref().unwrap_or(""),
            ],
        )?;

        let mut current_ids = self.get_excluded_game_ids()?;
        current_ids.insert(game.id.clone());
        if let Some(ref app_id) = game.app_id {
            if !app_id.is_empty() {
                current_ids.insert(app_id.clone());
            }
        }
        let list: Vec<String> = current_ids.into_iter().collect();
        let json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string());
        let _ = self.set_setting("excluded_game_ids", &json);

        Ok(())
    }

    pub fn get_excluded_games(&self) -> Result<Vec<ExcludedGame>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, platform, app_id, exe_path, excluded_at FROM excluded_games ORDER BY excluded_at DESC"
        )?;
        let items = stmt
            .query_map([], |row| {
                let app_id_raw: String = row.get(3)?;
                let exe_raw: String = row.get(4)?;
                Ok(ExcludedGame {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    platform: row.get(2)?,
                    app_id: if app_id_raw.is_empty() {
                        None
                    } else {
                        Some(app_id_raw)
                    },
                    exe_path: if exe_raw.is_empty() {
                        None
                    } else {
                        Some(exe_raw)
                    },
                    excluded_at: row.get(5)?,
                })
            })?
            .flatten()
            .collect();
        Ok(items)
    }

    pub fn get_excluded_game_ids(&self) -> Result<std::collections::HashSet<String>> {
        let mut set = std::collections::HashSet::new();

        if let Ok(mut stmt) = self
            .conn
            .prepare("SELECT id, app_id, exe_path FROM excluded_games")
        {
            if let Ok(rows) = stmt.query_map([], |row| {
                let id: String = row.get(0)?;
                let app_id: String = row.get(1).unwrap_or_default();
                let exe: String = row.get(2).unwrap_or_default();
                Ok((id, app_id, exe))
            }) {
                for item in rows.flatten() {
                    set.insert(item.0);
                    if !item.1.is_empty() {
                        set.insert(item.1);
                    }
                    if !item.2.is_empty() {
                        set.insert(item.2.to_lowercase().replace('/', "\\"));
                    }
                }
            }
        }

        if let Ok(Some(setting_val)) = self.get_setting("excluded_game_ids") {
            if let Ok(parsed) = serde_json::from_str::<Vec<String>>(&setting_val) {
                for id in parsed {
                    set.insert(id);
                }
            }
        }

        Ok(set)
    }

    pub fn restore_excluded_game(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM excluded_games WHERE id = ?1 OR app_id = ?1",
            params![id],
        )?;

        let mut current_ids = self.get_excluded_game_ids()?;
        current_ids.remove(id);
        let list: Vec<String> = current_ids.into_iter().collect();
        let json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".to_string());
        let _ = self.set_setting("excluded_game_ids", &json);

        Ok(())
    }

    pub fn insert_vault_entry(&self, entry: &CompressedVaultEntry) -> Result<()> {
        let algo_str = match entry.algorithm {
            CompressionAlgorithm::Zstd => "zstd",
            CompressionAlgorithm::Lz4 => "lz4",
        };
        self.conn.execute(
            r#"
            INSERT OR REPLACE INTO compressed_vault_entries (
                id, cache_id, game_id, game_name, original_path, compressed_path,
                algorithm, original_size, compressed_size, ratio, compressed_at, status
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            "#,
            params![
                entry.id,
                entry.cache_id,
                entry.game_id,
                entry.game_name,
                entry.original_path,
                entry.compressed_path,
                algo_str,
                entry.original_size as i64,
                entry.compressed_size as i64,
                entry.ratio,
                entry.compressed_at,
                entry.status
            ],
        )?;
        Ok(())
    }

    pub fn get_all_vault_entries(&self) -> Result<Vec<CompressedVaultEntry>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, cache_id, game_id, game_name, original_path, compressed_path,
                   algorithm, original_size, compressed_size, ratio, compressed_at, status
            FROM compressed_vault_entries
            ORDER BY compressed_at DESC
            "#,
        )?;

        let rows = stmt.query_map([], |row| {
            let algo_str: String = row.get(6)?;
            let algorithm = if algo_str == "lz4" {
                CompressionAlgorithm::Lz4
            } else {
                CompressionAlgorithm::Zstd
            };
            let orig_sz: i64 = row.get(7)?;
            let comp_sz: i64 = row.get(8)?;

            Ok(CompressedVaultEntry {
                id: row.get(0)?,
                cache_id: row.get(1)?,
                game_id: row.get(2)?,
                game_name: row.get(3)?,
                original_path: row.get(4)?,
                compressed_path: row.get(5)?,
                algorithm,
                original_size: orig_sz as u64,
                compressed_size: comp_sz as u64,
                ratio: row.get(9)?,
                compressed_at: row.get(10)?,
                status: row.get(11)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn get_vault_entry_by_id(&self, id: &str) -> Result<Option<CompressedVaultEntry>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, cache_id, game_id, game_name, original_path, compressed_path,
                   algorithm, original_size, compressed_size, ratio, compressed_at, status
            FROM compressed_vault_entries
            WHERE id = ?1
            "#,
        )?;

        let mut rows = stmt.query_map(params![id], |row| {
            let algo_str: String = row.get(6)?;
            let algorithm = if algo_str == "lz4" {
                CompressionAlgorithm::Lz4
            } else {
                CompressionAlgorithm::Zstd
            };
            let orig_sz: i64 = row.get(7)?;
            let comp_sz: i64 = row.get(8)?;

            Ok(CompressedVaultEntry {
                id: row.get(0)?,
                cache_id: row.get(1)?,
                game_id: row.get(2)?,
                game_name: row.get(3)?,
                original_path: row.get(4)?,
                compressed_path: row.get(5)?,
                algorithm,
                original_size: orig_sz as u64,
                compressed_size: comp_sz as u64,
                ratio: row.get(9)?,
                compressed_at: row.get(10)?,
                status: row.get(11)?,
            })
        })?;

        if let Some(first) = rows.next() {
            Ok(Some(first?))
        } else {
            Ok(None)
        }
    }

    pub fn get_vault_entries_for_game(&self, game_id: &str) -> Result<Vec<CompressedVaultEntry>> {
        let mut stmt = self.conn.prepare(
            r#"
            SELECT id, cache_id, game_id, game_name, original_path, compressed_path,
                   algorithm, original_size, compressed_size, ratio, compressed_at, status
            FROM compressed_vault_entries
            WHERE game_id = ?1
            ORDER BY compressed_at DESC
            "#,
        )?;

        let rows = stmt.query_map(params![game_id], |row| {
            let algo_str: String = row.get(6)?;
            let algorithm = if algo_str == "lz4" {
                CompressionAlgorithm::Lz4
            } else {
                CompressionAlgorithm::Zstd
            };
            let orig_sz: i64 = row.get(7)?;
            let comp_sz: i64 = row.get(8)?;

            Ok(CompressedVaultEntry {
                id: row.get(0)?,
                cache_id: row.get(1)?,
                game_id: row.get(2)?,
                game_name: row.get(3)?,
                original_path: row.get(4)?,
                compressed_path: row.get(5)?,
                algorithm,
                original_size: orig_sz as u64,
                compressed_size: comp_sz as u64,
                ratio: row.get(9)?,
                compressed_at: row.get(10)?,
                status: row.get(11)?,
            })
        })?;

        let mut list = Vec::new();
        for r in rows {
            list.push(r?);
        }
        Ok(list)
    }

    pub fn update_vault_entry_status(&self, id: &str, status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE compressed_vault_entries SET status = ?1 WHERE id = ?2",
            params![status, id],
        )?;
        Ok(())
    }

    pub fn delete_vault_entry(&self, id: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM compressed_vault_entries WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrashRecord {
    pub id: i64,
    pub original_path: String,
    pub trash_path: String,
    pub game_id: Option<String>,
    pub game_name: Option<String>,
    pub deleted_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExcludedGame {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub app_id: Option<String>,
    pub exe_path: Option<String>,
    pub excluded_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schema_version_and_migration() {
        let temp_dir = std::env::temp_dir().join("kcache_db_test");
        let _ = std::fs::create_dir_all(&temp_dir);
        let db_path = temp_dir.join(format!("test_{}.db", uuid::Uuid::new_v4()));

        let db = Database::open(&db_path).expect("failed to open test db");
        let version: i32 = db
            .conn
            .query_row("SELECT version FROM schema_version LIMIT 1", [], |r| {
                r.get(0)
            })
            .expect("query schema_version");
        assert_eq!(version, 1);

        assert!(db.initialize().is_ok());

        let version_after: i32 = db
            .conn
            .query_row("SELECT version FROM schema_version LIMIT 1", [], |r| {
                r.get(0)
            })
            .expect("query schema_version after second init");
        assert_eq!(version_after, 1);

        drop(db);
        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_dir(&temp_dir);
    }
}
