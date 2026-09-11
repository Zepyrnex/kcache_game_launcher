use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;
use chrono::Local;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameSave {
    pub game_name: String,
    pub found_path: String,
    pub size: u64,
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
    Nested { games: HashMap<String, ManifestGameEntry> },
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

#[tauri::command]
pub fn detect_saves(manifest_yaml: Option<String>) -> Result<Vec<GameSave>, String> {
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
"#;

    let yaml_str = manifest_yaml.as_deref().unwrap_or(default_yaml);
    let parsed_candidates = parse_ludusavi_manifest(yaml_str)?;

    let mut detected = Vec::new();

    for (game_name, path) in parsed_candidates {
        // Placeholder for MFT scanner query:
        // In production, query the MFT scanner for near-instant path indexing
        // without hitting standard disk I/O for missing folders:
        // let mft_match = mft_scanner.query_path(&path);
        // if let Some(found) = mft_match { ... }

        if path.exists() {
            let size = calculate_path_size(&path);
            detected.push(GameSave {
                game_name,
                found_path: path.to_string_lossy().to_string(),
                size,
            });
        }
    }

    Ok(detected)
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

        let zip_file = File::create(&zip_dest)
            .map_err(|e| format!("Failed to create zip file: {e}"))?;
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
