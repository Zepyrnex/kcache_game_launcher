use crate::everything::EverythingClient;
use crate::steam_api::SteamApiClient;
use crate::types::DiscoveredProgram;
use log::{debug, info};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub struct ExeScanner;

impl ExeScanner {
    pub fn scan_folders(
        folders: &[PathBuf],
        everything: Option<&EverythingClient>,
    ) -> Vec<DiscoveredProgram> {
        let mut discovered = Vec::new();

        for folder in folders {
            if !folder.exists() {
                continue;
            }
            let folder_str = folder.to_string_lossy().to_string();
            info!("[ExeScanner] Scanning folder: {folder_str}");

            let mut found_from_mft = false;
            if let Some(client) = everything {
                if let Some(items) = client.find_executables_in_folder(&folder_str) {
                    info!("[ExeScanner] MFT scan found {} raw .exe items via Everything in {folder_str}", items.len());
                    for item in items {
                        if !item.is_folder && Self::is_game_executable(&item.full_path) {
                            if let Some(program) = Self::build_program_info(
                                &item.full_path,
                                item.size_bytes,
                                item.last_modified_unix(),
                            ) {
                                discovered.push(program);
                            }
                        }
                    }
                    found_from_mft = true;
                }
            }

            if !found_from_mft {
                debug!("[ExeScanner] Using walkdir fallback for {folder_str}");
                let fallback_items = Self::scan_directory_fallback(folder);
                discovered.extend(fallback_items);
            }
        }

        discovered.sort_by(|a, b| a.exe_path.to_lowercase().cmp(&b.exe_path.to_lowercase()));
        discovered.dedup_by(|a, b| {
            a.exe_path
                .replace('/', "\\")
                .eq_ignore_ascii_case(&b.exe_path.replace('/', "\\"))
        });

        discovered = Self::deduplicate_by_game_folder(discovered);

        Self::auto_match_steam_metadata(&mut discovered);

        info!(
            "[ExeScanner] Scan complete: {} game programs discovered",
            discovered.len()
        );
        discovered
    }

    fn scan_directory_fallback(root: &Path) -> Vec<DiscoveredProgram> {
        let mut items = Vec::new();

        let walker = WalkDir::new(root)
            .min_depth(1)
            .max_depth(4)
            .into_iter()
            .filter_entry(|entry| {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if entry.file_type().is_dir() {
                    !Self::is_ignored_directory(&name)
                } else {
                    true
                }
            });

        for entry in walker.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    if ext.eq_ignore_ascii_case("exe") && Self::is_game_executable(path) {
                        if let Ok(meta) = entry.metadata() {
                            let size = meta.len();
                            let mtime = meta
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_secs() as i64)
                                .unwrap_or(0);

                            if let Some(prog) = Self::build_program_info(path, size, mtime) {
                                items.push(prog);
                            }
                        }
                    }
                }
            }
        }

        items
    }

    fn is_ignored_directory(dir_name: &str) -> bool {
        matches!(
            dir_name,
            "_commonredist"
                | "installer"
                | "installers"
                | "support"
                | "directx"
                | "crashreport"
                | "crashreports"
                | "crashpad"
                | "node_modules"
                | "__pycache__"
                | "$recycle.bin"
                | ".git"
                | ".vscode"
                | "windowsapps"
                | "appdata"
                | "temp"
                | "logs"
                | "easyanticheat"
                | "battleye"
                | "redist"
                | "prerequisites"
        )
    }

    fn is_game_executable(path: &Path) -> bool {
        let file_stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        if file_stem.is_empty() {
            return false;
        }

        if file_stem.starts_with("unins")
            || file_stem.starts_with("uninstall")
            || file_stem.contains("setup")
            || file_stem.contains("install")
            || file_stem.contains("patch")
            || file_stem.contains("downloader")
            || file_stem.contains("update")
        {
            return false;
        }

        if file_stem.starts_with("vc_redist")
            || file_stem.starts_with("vcredist")
            || file_stem.starts_with("dxsetup")
            || file_stem.starts_with("dotnet")
            || file_stem.starts_with("oalinst")
            || file_stem.starts_with("ue4prereqsetup")
            || file_stem.contains("crashhandler")
            || file_stem.contains("crashreporter")
            || file_stem.contains("crashreport")
            || file_stem.contains("unitycrashhandler")
            || file_stem.contains("unrealcefsubprocess")
            || file_stem.contains("easyanticheat")
            || file_stem.contains("battleye")
            || file_stem.contains("epiconlineservices")
            || file_stem.contains("cefprocess")
            || file_stem.contains("gamelauncherhelper")
            || file_stem.contains("launchhelper")
            || file_stem.contains("gamemanager")
            || file_stem.contains("activation")
            || file_stem.contains("registration")
            || file_stem.contains("webhelper")
            || file_stem.contains("qtwebengineprocess")
            || file_stem.contains("cleanup")
            || file_stem.contains("bslogmgr")
            || file_stem.contains("feedback")
            || file_stem.contains("sendrpt")
            || file_stem.contains("bugreport")
            || file_stem.contains("diagnostics")
        {
            return false;
        }

        true
    }

    fn build_program_info(
        path: &Path,
        size_bytes: u64,
        last_modified: i64,
    ) -> Option<DiscoveredProgram> {
        let file_stem = path.file_stem()?.to_string_lossy().to_string();
        let folder_path = path.parent()?.to_string_lossy().to_string();

        let suggested_name = Self::clean_game_name(&file_stem, path);

        Some(DiscoveredProgram {
            name: suggested_name.clone(),
            exe_path: path.to_string_lossy().to_string(),
            folder_path,
            size_bytes,
            last_modified,
            suggested_name,
            matched_app_id: None,
            matched_cover_url: None,
        })
    }

    fn clean_game_name(file_stem: &str, path: &Path) -> String {
        let is_generic = matches!(
            file_stem.to_lowercase().as_str(),
            "game" | "launcher" | "play" | "start" | "app" | "main" | "client"
        );

        let base_name = if is_generic {
            let mut cur = path.parent();
            let mut candidate = file_stem.to_string();
            while let Some(parent) = cur {
                let name = parent.file_name().and_then(|n| n.to_str()).unwrap_or("");
                let lower = name.to_lowercase();
                if lower != "bin"
                    && lower != "binaries"
                    && lower != "win64"
                    && lower != "x64"
                    && lower != "x86"
                    && !lower.is_empty()
                {
                    candidate = name.to_string();
                    break;
                }
                cur = parent.parent();
            }
            candidate
        } else {
            file_stem.to_string()
        };

        let mut clean = base_name;
        for suffix in &[
            "-Win64-Shipping",
            "-Win32-Shipping",
            "_Win64_Shipping",
            "_x64",
            "_x86",
            "x64",
            "x86",
            "_DX12",
            "_DX11",
            "DX12",
            "DX11",
            "_Release",
            "Release",
        ] {
            if clean.ends_with(suffix) && clean.len() > suffix.len() + 2 {
                clean = clean[..clean.len() - suffix.len()].to_string();
                break;
            }
        }

        let formatted = clean.replace('_', " ").replace('.', " ");

        insert_camel_spaces(&formatted).trim().to_string()
    }

    fn auto_match_steam_metadata(programs: &mut [DiscoveredProgram]) {
        let steam = SteamApiClient::new();
        let limit = programs.len().min(20);

        for prog in programs.iter_mut().take(limit) {
            if let Ok(results) = steam.search_store(&prog.suggested_name) {
                if let Some(first) = results.first() {
                    let app_id_str = first.id.to_string();
                    prog.matched_app_id = Some(app_id_str.clone());
                    prog.matched_cover_url = Some(SteamApiClient::get_cdn_cover_url(&app_id_str));
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(150));
        }
    }

    fn deduplicate_by_game_folder(programs: Vec<DiscoveredProgram>) -> Vec<DiscoveredProgram> {
        use std::collections::HashMap;

        let mut groups: HashMap<PathBuf, Vec<DiscoveredProgram>> = HashMap::new();
        for prog in programs {
            let exe_p = PathBuf::from(&prog.exe_path);
            let root = Self::get_game_root_dir(&exe_p);
            groups.entry(root).or_default().push(prog);
        }

        let mut result = Vec::new();
        for (root, mut progs) in groups {
            if progs.len() == 1 {
                result.push(progs.remove(0));
            } else {
                progs.sort_by_key(|p| {
                    let exe_p = PathBuf::from(&p.exe_path);
                    Self::score_executable(&exe_p, p.size_bytes, &root)
                });

                if let Some(best) = progs.pop() {
                    result.push(best);
                }
            }
        }

        result.sort_by(|a, b| a.name.cmp(&b.name));
        result
    }

    fn get_game_root_dir(exe_path: &Path) -> PathBuf {
        let mut cur = exe_path.parent();
        let mut root = cur.map(PathBuf::from).unwrap_or_default();
        while let Some(parent) = cur {
            let name = parent
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();
            if matches!(
                name.as_str(),
                "bin"
                    | "binaries"
                    | "win64"
                    | "win32"
                    | "x64"
                    | "x86"
                    | "retail"
                    | "release"
                    | "game"
            ) {
                if let Some(grandparent) = parent.parent() {
                    root = grandparent.to_path_buf();
                }
            }
            cur = parent.parent();
        }
        root
    }

    fn score_executable(path: &Path, size_bytes: u64, root: &Path) -> i64 {
        let mut score: i64 = 0;
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        let root_name = root
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !root_name.is_empty()
            && (stem == root_name || stem.contains(&root_name) || root_name.contains(&stem))
        {
            score += 100;
        }

        if stem.contains("shipping") {
            score += 40;
        }

        if size_bytes > 50_000_000 {
            score += 50;
        } else if size_bytes > 15_000_000 {
            score += 30;
        } else if size_bytes < 2_000_000 {
            score -= 30;
        }

        if matches!(
            stem.as_str(),
            "launcher" | "play" | "start" | "crashreportclient" | "redprelauncher"
        ) {
            score -= 40;
        }

        if path.parent() == Some(root) {
            score += 20;
        }

        score
    }
}

fn insert_camel_spaces(s: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();
    for i in 0..chars.len() {
        if i > 0 {
            let prev = chars[i - 1];
            let cur = chars[i];
            if (prev.is_alphabetic() && cur.is_numeric())
                || (prev.is_numeric() && cur.is_alphabetic())
                || (prev.is_lowercase() && cur.is_uppercase())
            {
                result.push(' ');
            }
        }
        result.push(chars[i]);
    }
    result
}
