use crate::commands::AppState;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameSave {
    pub game_name: String,
    pub found_path: String,
    pub size: u64,
    pub source: Option<String>,
    pub app_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupProgress {
    pub percent: f32,
    pub current_file: String,
    pub processed_files: usize,
    pub total_files: usize,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum FilesSection {
    List(Vec<String>),
    Map(HashMap<String, serde_yaml::Value>),
}

#[derive(Debug, Deserialize)]
struct ManifestGameEntry {
    #[serde(default)]
    files: Option<FilesSection>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ManifestFormat {
    Nested {
        games: HashMap<String, ManifestGameEntry>,
    },
    Flat(HashMap<String, ManifestGameEntry>),
}

pub fn resolve_env_vars(raw_path: &str) -> PathBuf {
    let mut normalized = raw_path.replace('/', "\\");

    if let Ok(userprofile) = std::env::var("USERPROFILE") {
        normalized = normalized.replace("%USERPROFILE%", &userprofile);
        normalized = normalized.replace("<home>", &userprofile);
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        normalized = normalized.replace("%APPDATA%", &appdata);
        normalized = normalized.replace("<winAppData>", &appdata);
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        normalized = normalized.replace("%LOCALAPPDATA%", &localappdata);
        normalized = normalized.replace("<winLocalAppData>", &localappdata);
    }
    if let Some(docs) = dirs::document_dir() {
        let docs_str = docs.to_string_lossy().to_string();
        normalized = normalized.replace("%DOCUMENTS%", &docs_str);
        normalized = normalized.replace("<winDocuments>", &docs_str);
    }
    if let Ok(public) = std::env::var("PUBLIC") {
        normalized = normalized.replace("%PUBLIC%", &public);
        normalized = normalized.replace("<winPublic>", &public);
    }

    let re = regex::Regex::new(r"%([a-zA-Z0-9_]+)%").unwrap();
    let expanded = re.replace_all(&normalized, |caps: &regex::Captures| {
        let var_name = &caps[1];
        std::env::var(var_name).unwrap_or_else(|_| caps[0].to_string())
    });

    PathBuf::from(expanded.into_owned())
}

pub fn parse_ludusavi_manifest(yaml_content: &str) -> Result<Vec<(String, PathBuf)>, String> {
    let parsed: ManifestFormat = serde_yaml::from_str(yaml_content)
        .map_err(|e| format!("Failed to parse YAML manifest: {e}"))?;

    let games_map = match parsed {
        ManifestFormat::Nested { games } => games,
        ManifestFormat::Flat(games) => games,
    };

    let mut results = Vec::new();

    for (game_name, entry) in games_map {
        if let Some(files_sec) = entry.files {
            let candidate_paths: Vec<String> = match files_sec {
                FilesSection::List(list) => list,
                FilesSection::Map(map) => map.into_keys().collect(),
            };

            for raw_p in candidate_paths {
                let resolved = resolve_env_vars(&raw_p);
                results.push((game_name.clone(), resolved));
            }
        }
    }

    Ok(results)
}

fn calculate_path_size(path: &Path) -> u64 {
    if path.is_file() {
        return path.metadata().map(|m| m.len()).unwrap_or(0);
    }
    let mut total = 0u64;
    for entry in WalkDir::new(path).into_iter().flatten() {
        if entry.path().is_file() {
            if let Ok(meta) = entry.metadata() {
                total += meta.len();
            }
        }
    }
    total
}

fn get_known_steam_title(app_id: &str) -> Option<&'static str> {
    match app_id {
        "1091500" => Some("Cyberpunk 2077"),
        "1167630" => Some("Teardown"),
        "1245620" => Some("ELDEN RING"),
        "1313140" => Some("Cult of the Lamb"),
        "1466060" => Some("Tainted Grail: The Fall of Avalon"),
        "1659040" => Some("HITMAN World of Assassination"),
        "1790600" => Some("DEATH STRANDING DIRECTOR'S CUT"),
        "1817190" => Some("Marvel's Spider-Man: Miles Morales"),
        "1817070" => Some("Marvel's Spider-Man Remastered"),
        "1858630" => Some("No Man's Sky"),
        "1903340" => Some("Dread Delusion"),
        "2054970" => Some("Dragon's Dogma 2"),
        "2186990" => Some("Hades II"),
        "2215430" => Some("Ghostrunner 2"),
        "2277560" => Some("System Shock"),
        "230290" => Some("Beat Hazard 2"),
        "2357000" => Some("No Rest for the Wicked"),
        "2420110" => Some("Horizon Forbidden West"),
        "2651280" => Some("Manor Lords"),
        "2909400" => Some("Shapez 2"),
        "582010" => Some("Monster Hunter: World"),
        "851850" => Some("DRAGON QUEST HEROES"),
        "881100" => Some("Noita"),
        "1009290" => Some("SWORD ART ONLINE Alicization Lycoris"),
        "1222140" => Some("Detroit: Become Human"),
        "1659420" => Some("UNCHARTED: Legacy of Thieves Collection"),
        "374320" => Some("DARK SOULS III"),
        "524220" => Some("NieR:Automata"),
        "638650" => Some("Sekiro: Shadows Die Twice"),
        "814380" => Some("Sekiro: Shadows Die Twice"),
        "1086940" => Some("Baldur's Gate 3"),
        "1145360" => Some("Hades"),
        "367520" => Some("Hollow Knight"),
        "292030" => Some("The Witcher 3: Wild Hunt"),
        "2358720" => Some("Black Myth: Wukong"),
        "1623730" => Some("Palworld"),
        "1593500" => Some("God of War"),
        "1151640" => Some("Horizon Zero Dawn"),
        "1716740" => Some("Starfield"),
        "377160" => Some("Fallout 4"),
        "489830" => Some("The Elder Scrolls V: Skyrim Special Edition"),
        "1174180" => Some("Red Dead Redemption 2"),
        "271590" => Some("Grand Theft Auto V"),
        "211420" => Some("DARK SOULS: Prepare To Die Edition"),
        "335300" => Some("DARK SOULS II: Scholar of the First Sin"),
        "1888930" => Some("ARMORED CORE VI FIRES OF RUBICON"),
        "883710" => Some("Resident Evil 2"),
        "952060" => Some("Resident Evil 3"),
        "2050650" => Some("Resident Evil 4"),
        "418370" => Some("Resident Evil 7 Biohazard"),
        "1196590" => Some("Resident Evil Village"),
        "1446780" => Some("MONSTER HUNTER RISE"),
        "1462040" => Some("FINAL FANTASY VII REMAKE INTERGRADE"),
        "553850" => Some("HELLDIVERS 2"),
        "1627720" => Some("Lies of P"),
        "812140" => Some("Assassin's Creed Odyssey"),
        "582160" => Some("Assassin's Creed Origins"),
        "12210" => Some("Grand Theft Auto IV"),
        "4000" => Some("Garry's Mod"),
        "730" => Some("Counter-Strike 2"),
        "570" => Some("Dota 2"),
        "440" => Some("Team Fortress 2"),
        "252490" => Some("Rust"),
        "105600" => Some("Terraria"),
        "289070" => Some("Sid Meier's Civilization VI"),
        "1172470" => Some("Apex Legends"),
        "250900" => Some("The Binding of Isaac: Rebirth"),
        "413150" => Some("Stardew Valley"),
        "108600" => Some("Project Zomboid"),
        "322330" => Some("Don't Starve Together"),
        "242760" => Some("The Forest"),
        "1326470" => Some("Sons of the Forest"),
        "892970" => Some("Valheim"),
        "945360" => Some("Among Us"),
        "1938090" => Some("Call of Duty"),
        "976730" => Some("Halo: The Master Chief Collection"),
        "550" => Some("Left 4 Dead 2"),
        "220" => Some("Half-Life 2"),
        "400" => Some("Portal"),
        "620" => Some("Portal 2"),
        "22380" => Some("Fallout: New Vegas"),
        "22370" => Some("Fallout 3"),
        "281990" => Some("Stellaris"),
        "1158310" => Some("Crusader Kings III"),
        "648800" => Some("Raft"),
        "381210" => Some("Dead by Daylight"),
        "230410" => Some("Warframe"),
        "218620" => Some("PAYDAY 2"),
        "782330" => Some("DOOM Eternal"),
        "379720" => Some("DOOM"),
        "1551360" => Some("Forza Horizon 5"),
        "1293830" => Some("Forza Horizon 4"),
        "1172620" => Some("Sea of Thieves"),
        "1172380" => Some("STAR WARS Jedi: Fallen Order"),
        "1774580" => Some("STAR WARS Jedi: Survivor"),
        _ => None,
    }
}

fn resolve_steam_app_name(
    app_id: &str,
    app: &AppHandle,
    web_calls_remaining: &mut usize,
) -> String {
    if let Some(static_name) = get_known_steam_title(app_id) {
        return static_name.to_string();
    }

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(db) = state.db.lock() {
            if let Ok(Some(cached_json)) = db.get_cached_metadata(app_id) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&cached_json) {
                    if let Some(n) = val.get("name").and_then(|v| v.as_str()) {
                        if !n.is_empty() {
                            return n.to_string();
                        }
                    }
                }
            }

            if let Ok(games) = db.get_all_games() {
                for g in games {
                    if g.app_id.as_deref() == Some(app_id) {
                        return g.name;
                    }
                }
            }
        }
    }

    if *web_calls_remaining > 0 {
        *web_calls_remaining -= 1;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(4))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .build()
            .unwrap_or_default();

        let url = format!(
            "https://store.steampowered.com/api/appdetails?appids={app_id}&filters=basic&l=english"
        );
        std::thread::sleep(Duration::from_millis(350));

        if let Ok(resp) = client.get(&url).send() {
            if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                *web_calls_remaining = 0;
            } else if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>() {
                    if let Some(app_obj) = val.get(app_id) {
                        if app_obj
                            .get("success")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false)
                        {
                            if let Some(data) = app_obj.get("data") {
                                if let Some(name_str) = data.get("name").and_then(|v| v.as_str()) {
                                    let clean_name = name_str.to_string();
                                    if let Some(state) = app.try_state::<AppState>() {
                                        if let Ok(db) = state.db.lock() {
                                            let cache_val = serde_json::json!({
                                                "name": clean_name
                                            });
                                            let _ =
                                                db.cache_metadata(app_id, &cache_val.to_string());
                                        }
                                    }
                                    return clean_name;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    format!("Steam App {app_id}")
}

#[tauri::command]
pub async fn detect_saves(
    app: AppHandle,
    manifest_yaml: Option<String>,
) -> Result<Vec<GameSave>, String> {
    let app_handle = app.clone();

    tokio::task::spawn_blocking(move || {
        let mut detected = Vec::new();
        let mut seen_paths: HashSet<String> = HashSet::new();
        let mut web_calls_remaining = 8;

        let default_yaml = r#"
"The Witcher 3: Wild Hunt":
  files:
    "%USERPROFILE%/Documents/The Witcher 3/gamesaves": {}
"Cyberpunk 2077":
  files:
    "%USERPROFILE%/Saved Games/CD Projekt Red/Cyberpunk 2077": {}
"Elden Ring":
  files:
    "%APPDATA%/EldenRing": {}
"Baldur's Gate 3":
  files:
    "%LOCALAPPDATA%/Larian Studios/Baldur's Gate 3/PlayerProfiles": {}
"Hades":
  files:
    "%USERPROFILE%/Documents/Saved Games/Hades": {}
"Hollow Knight":
  files:
    "%LOCALAPPDATA%Low/Team Cherry/Hollow Knight": {}
"Black Myth: Wukong":
  files:
    "%LOCALAPPDATA%/b1/Saved/SaveGames": {}
"Palworld":
  files:
    "%LOCALAPPDATA%/Pal/Saved/SaveGames": {}
"#;

        let yaml_str = manifest_yaml.as_deref().unwrap_or(default_yaml);
        if let Ok(parsed_candidates) = parse_ludusavi_manifest(yaml_str) {
            for (game_name, path) in parsed_candidates {
                // let mft_match = mft_scanner.query_path(&path);

                if path.exists() {
                    let path_str = path.to_string_lossy().to_string();
                    let norm_key = path_str.to_lowercase().replace('/', "\\");
                    if !seen_paths.contains(&norm_key) {
                        let size = calculate_path_size(&path);
                        if size > 0 {
                            seen_paths.insert(norm_key);
                            detected.push(GameSave {
                                game_name,
                                found_path: path_str,
                                size,
                                source: Some("Manifest".to_string()),
                                app_id: None,
                            });
                        }
                    }
                }
            }
        }

        let mut emu_roots = Vec::new();
        if let Ok(public) = std::env::var("PUBLIC") {
            let p = PathBuf::from(public).join("Documents").join("Steam");
            emu_roots.push((p.join("RUNE"), "RUNE"));
            emu_roots.push((p.join("CODEX"), "CODEX"));
            emu_roots.push((p, "Steam Emu"));
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            let p_roaming = PathBuf::from(appdata);
            emu_roots.push((p_roaming.join("Steam").join("RUNE"), "RUNE"));
            emu_roots.push((p_roaming.join("Steam").join("CODEX"), "CODEX"));
            emu_roots.push((p_roaming.join("Goldberg SteamEmu Saves"), "Goldberg"));
            emu_roots.push((p_roaming.join("SEGS"), "SEGS"));
        }
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            let p_local = PathBuf::from(localappdata);
            emu_roots.push((p_local.join("Steam").join("RUNE"), "RUNE"));
            emu_roots.push((p_local.join("Steam").join("CODEX"), "CODEX"));
            emu_roots.push((p_local.join("Goldberg SteamEmu Saves"), "Goldberg"));
        }

        for (emu_dir, source_name) in emu_roots {
            if !emu_dir.exists() {
                continue;
            }
            if let Ok(entries) = fs::read_dir(&emu_dir) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if entry_path.is_dir() {
                        let folder_name = entry.file_name().to_string_lossy().to_string();
                        if folder_name.chars().all(|c| c.is_ascii_digit())
                            && !folder_name.is_empty()
                        {
                            let path_str = entry_path.to_string_lossy().to_string();
                            let norm_key = path_str.to_lowercase().replace('/', "\\");
                            if seen_paths.contains(&norm_key) {
                                continue;
                            }
                            let size = calculate_path_size(&entry_path);
                            if size > 0 {
                                let title = resolve_steam_app_name(
                                    &folder_name,
                                    &app_handle,
                                    &mut web_calls_remaining,
                                );
                                seen_paths.insert(norm_key);
                                detected.push(GameSave {
                                    game_name: title,
                                    found_path: path_str,
                                    size,
                                    source: Some(source_name.to_string()),
                                    app_id: Some(folder_name),
                                });
                            }
                        }
                    }
                }
            }
        }

        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            let cpy_dir = PathBuf::from(&userprofile)
                .join("Documents")
                .join("CPY_SAVES");
            if cpy_dir.exists() {
                for entry in WalkDir::new(&cpy_dir).max_depth(4).into_iter().flatten() {
                    let p = entry.path();
                    if p.is_dir() {
                        let mut has_save_file = false;
                        if let Ok(sub_entries) = fs::read_dir(p) {
                            for sub in sub_entries.flatten() {
                                let sub_name = sub.file_name().to_string_lossy().to_lowercase();
                                if sub_name.ends_with(".save")
                                    || sub_name.ends_with(".cdx")
                                    || sub_name.ends_with(".sav")
                                {
                                    has_save_file = true;
                                    break;
                                }
                            }
                        }

                        if has_save_file {
                            let path_str = p.to_string_lossy().to_string();
                            let norm_key = path_str.to_lowercase().replace('/', "\\");
                            if !seen_paths.contains(&norm_key) {
                                let folder_name = p
                                    .file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default();
                                let game_name = if folder_name == "2688"
                                    || path_str.to_uppercase().contains("WD2")
                                {
                                    "Watch Dogs 2 (CPY)".to_string()
                                } else if folder_name.chars().all(|c| c.is_ascii_digit())
                                    && !folder_name.is_empty()
                                {
                                    resolve_steam_app_name(
                                        &folder_name,
                                        &app_handle,
                                        &mut web_calls_remaining,
                                    )
                                } else {
                                    format!("{folder_name} (CPY)")
                                };

                                let size = calculate_path_size(p);
                                if size > 0 {
                                    seen_paths.insert(norm_key);
                                    detected.push(GameSave {
                                        game_name,
                                        found_path: path_str,
                                        size,
                                        source: Some("CPY".to_string()),
                                        app_id: if folder_name.chars().all(|c| c.is_ascii_digit()) {
                                            Some(folder_name)
                                        } else {
                                            None
                                        },
                                    });
                                }
                            }
                        }
                    }
                }
            }

            let saved_games_dir = PathBuf::from(&userprofile).join("Saved Games");
            if saved_games_dir.exists() {
                if let Ok(entries) = fs::read_dir(&saved_games_dir) {
                    for entry in entries.flatten() {
                        let ep = entry.path();
                        if ep.is_dir() {
                            let dir_name = entry.file_name().to_string_lossy().to_string();
                            let mut has_sub_games = false;
                            if let Ok(sub_entries) = fs::read_dir(&ep) {
                                for sub in sub_entries.flatten() {
                                    let sub_p = sub.path();
                                    if sub_p.is_dir() {
                                        let sub_size = calculate_path_size(&sub_p);
                                        if sub_size > 0 {
                                            let sub_path_str = sub_p.to_string_lossy().to_string();
                                            let norm_key =
                                                sub_path_str.to_lowercase().replace('/', "\\");
                                            if !seen_paths.contains(&norm_key) {
                                                has_sub_games = true;
                                                seen_paths.insert(norm_key);
                                                let sub_name =
                                                    sub.file_name().to_string_lossy().to_string();
                                                detected.push(GameSave {
                                                    game_name: format!("{dir_name} - {sub_name}"),
                                                    found_path: sub_path_str,
                                                    size: sub_size,
                                                    source: Some("Saved Games".to_string()),
                                                    app_id: None,
                                                });
                                            }
                                        }
                                    }
                                }
                            }

                            if !has_sub_games {
                                let path_str = ep.to_string_lossy().to_string();
                                let norm_key = path_str.to_lowercase().replace('/', "\\");
                                if !seen_paths.contains(&norm_key) {
                                    let size = calculate_path_size(&ep);
                                    if size > 0 {
                                        seen_paths.insert(norm_key);
                                        detected.push(GameSave {
                                            game_name: dir_name,
                                            found_path: path_str,
                                            size,
                                            source: Some("Saved Games".to_string()),
                                            app_id: None,
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            let my_games_dir = PathBuf::from(&userprofile)
                .join("Documents")
                .join("My Games");
            if my_games_dir.exists() {
                if let Ok(entries) = fs::read_dir(&my_games_dir) {
                    for entry in entries.flatten() {
                        let ep = entry.path();
                        if ep.is_dir() {
                            let dir_name = entry.file_name().to_string_lossy().to_string();
                            let path_str = ep.to_string_lossy().to_string();
                            let norm_key = path_str.to_lowercase().replace('/', "\\");
                            if !seen_paths.contains(&norm_key) {
                                let size = calculate_path_size(&ep);
                                if size > 0 {
                                    seen_paths.insert(norm_key);
                                    detected.push(GameSave {
                                        game_name: dir_name,
                                        found_path: path_str,
                                        size,
                                        source: Some("My Games".to_string()),
                                        app_id: None,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        detected.sort_by(|a, b| a.game_name.to_lowercase().cmp(&b.game_name.to_lowercase()));
        Ok(detected)
    })
    .await
    .map_err(|e| format!("Save detection error: {e}"))?
}

#[tauri::command]
pub fn open_save_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Save path does not exist: {path}"));
    }
    #[cfg(windows)]
    {
        if p.is_file() {
            std::process::Command::new("explorer")
                .arg(format!("/select,{}", path))
                .spawn()
                .map_err(|e| format!("Failed to open Explorer: {e}"))?;
        } else {
            std::process::Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("Failed to open Explorer: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn open_backup_folder(custom_dir: Option<String>) -> Result<(), String> {
    let out_dir = match custom_dir {
        Some(d) => PathBuf::from(d),
        None => {
            let base = dirs::document_dir()
                .or_else(dirs::data_local_dir)
                .unwrap_or_else(|| PathBuf::from("."));
            base.join("Kcache").join("SaveBackups")
        }
    };
    let _ = fs::create_dir_all(&out_dir);
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(&out_dir)
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn backup_saves(
    app: AppHandle,
    paths: Vec<String>,
    backup_dir: Option<String>,
) -> Result<String, String> {
    let out_dir = match backup_dir {
        Some(d) => PathBuf::from(d),
        None => {
            let base = dirs::document_dir()
                .or_else(dirs::data_local_dir)
                .unwrap_or_else(|| PathBuf::from("."));
            base.join("Kcache").join("SaveBackups")
        }
    };

    fs::create_dir_all(&out_dir).map_err(|e| format!("Failed to create backup dir: {e}"))?;

    let timestamp = Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let zip_filename = format!("save_backup_{timestamp}.zip");
    let zip_path = out_dir.join(&zip_filename);

    let app_handle = app.clone();
    let zip_dest = zip_path.clone();

    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let mut file_list: Vec<(PathBuf, String)> = Vec::new();

        for root_str in &paths {
            let root_path = Path::new(root_str);
            if !root_path.exists() {
                continue;
            }

            let folder_name = root_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("save_folder");

            if root_path.is_file() {
                file_list.push((root_path.to_path_buf(), folder_name.to_string()));
            } else {
                for entry in WalkDir::new(root_path).into_iter().flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        if let Ok(rel) = p.strip_prefix(root_path) {
                            let zip_rel = Path::new(folder_name).join(rel);
                            let zip_rel_str = zip_rel.to_string_lossy().replace('\\', "/");
                            file_list.push((p.to_path_buf(), zip_rel_str));
                        }
                    }
                }
            }
        }

        let total_files = file_list.len();
        if total_files == 0 {
            return Err("No valid files found across selected save paths.".into());
        }

        let zip_file =
            File::create(&zip_dest).map_err(|e| format!("Failed to create zip file: {e}"))?;
        let buf_writer = BufWriter::with_capacity(512 * 1024, zip_file);
        let mut zip_writer = ZipWriter::new(buf_writer);

        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o755);

        let mut read_buf = Vec::with_capacity(128 * 1024);

        for (index, (fs_path, zip_internal_path)) in file_list.iter().enumerate() {
            let filename = fs_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file");

            let percent = ((index as f32 / total_files as f32) * 100.0).min(99.0);

            let _ = app_handle.emit(
                "backup-progress",
                BackupProgress {
                    percent,
                    current_file: filename.to_string(),
                    processed_files: index,
                    total_files,
                    status: "zipping".to_string(),
                },
            );

            if let Ok(mut f) = File::open(fs_path) {
                read_buf.clear();
                if f.read_to_end(&mut read_buf).is_ok() {
                    if zip_writer.start_file(zip_internal_path, options).is_ok() {
                        let _ = zip_writer.write_all(&read_buf);
                    }
                }
            }
        }

        zip_writer
            .finish()
            .map_err(|e| format!("Failed to finalize zip file: {e}"))?;

        let _ = app_handle.emit(
            "backup-progress",
            BackupProgress {
                percent: 100.0,
                current_file: "Completed".to_string(),
                processed_files: total_files,
                total_files,
                status: "done".to_string(),
            },
        );

        Ok(())
    })
    .await
    .map_err(|e| format!("Backup task failed: {e}"))??;

    Ok(zip_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_env_vars_userprofile() {
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let res = resolve_env_vars("%USERPROFILE%/Saved Games/Test");
            assert_eq!(
                res,
                PathBuf::from(format!("{}\\Saved Games\\Test", profile))
            );

            let res_home = resolve_env_vars("<home>/Saved Games/Test");
            assert_eq!(
                res_home,
                PathBuf::from(format!("{}\\Saved Games\\Test", profile))
            );
        }
    }

    #[test]
    fn test_resolve_env_vars_appdata() {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let res = resolve_env_vars("%APPDATA%/Game/Saves");
            assert_eq!(res, PathBuf::from(format!("{}\\Game\\Saves", appdata)));

            let res_win = resolve_env_vars("<winAppData>/Game/Saves");
            assert_eq!(res_win, PathBuf::from(format!("{}\\Game\\Saves", appdata)));
        }
    }

    #[test]
    fn test_resolve_env_vars_localappdata() {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let res = resolve_env_vars("%LOCALAPPDATA%/Game/Saves");
            assert_eq!(res, PathBuf::from(format!("{}\\Game\\Saves", local)));

            let res_win = resolve_env_vars("<winLocalAppData>/Game/Saves");
            assert_eq!(res_win, PathBuf::from(format!("{}\\Game\\Saves", local)));
        }
    }
}
