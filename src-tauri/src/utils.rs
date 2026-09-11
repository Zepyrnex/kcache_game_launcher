use crate::types::{AppError, AppResult, CacheEntry, CacheSource};
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

pub fn dir_size_and_mtime(path: &Path) -> (u64, i64) {
    const MAX_FILES: usize = 50_000;
    let mut total = 0u64;
    let mut latest: i64 = 0;
    let mut count = 0usize;
    for entry in WalkDir::new(path)
        .min_depth(1)
        .max_depth(1)
        .into_iter()
        .flatten()
    {
        if count >= MAX_FILES {
            break;
        }
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                count += 1;
                total += meta.len();
                if let Ok(modified) = meta.modified() {
                    let ts = modified
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    if ts > latest {
                        latest = ts;
                    }
                }
            }
        }
    }
    (total, latest)
}

pub fn scan_dir(source: CacheSource, path: PathBuf) -> Option<CacheEntry> {
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

fn path_starts_with_case_insensitive(path: &Path, prefix: &Path) -> bool {
    let mut path_comps = path.components();
    for prefix_comp in prefix.components() {
        match path_comps.next() {
            Some(pc) => {
                if pc.as_os_str().to_string_lossy().to_lowercase()
                    != prefix_comp.as_os_str().to_string_lossy().to_lowercase()
                {
                    return false;
                }
            }
            None => return false,
        }
    }
    true
}

pub fn validate_path_allowed(path: &Path) -> AppResult<()> {
    let canonical = path
        .canonicalize()
        .map_err(|_| AppError::PathNotAllowed(path.to_string_lossy().to_string()))?;

    let mut allowed_roots: Vec<PathBuf> = Vec::new();

    if let Some(local) = dirs::data_local_dir() {
        allowed_roots.push(local.join("NVIDIA").join("DXCache"));
        allowed_roots.push(local.join("NVIDIA").join("GLCache"));
        allowed_roots.push(local.join("AMD").join("DxCache"));
        allowed_roots.push(local.join("AMD").join("DxcCache"));
        allowed_roots.push(local.join("Intel").join("ShaderCache"));
    }

    if let Some(app_data) = dirs::data_dir() {
        allowed_roots.push(app_data.join("Kcache"));
        allowed_roots.push(app_data.join("ShaderVault"));
    }

    for root in &allowed_roots {
        if let Ok(c_root) = root.canonicalize() {
            if path_starts_with_case_insensitive(&canonical, &c_root) {
                return Ok(());
            }
        }
    }

    let comps: Vec<String> = canonical
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
        .collect();

    for window in comps.windows(2) {
        if window[0] == "steamapps" && window[1] == "shadercache" {
            return Ok(());
        }
    }

    if let Some(ext) = canonical.extension() {
        let ext = ext.to_string_lossy().to_lowercase();
        if ext == "dxvk-cache" || ext == "vkd3d-cache" {
            for root in &allowed_roots {
                if let Ok(c_root) = root.canonicalize() {
                    if path_starts_with_case_insensitive(&canonical, &c_root) {
                        return Ok(());
                    }
                }
            }

            let steam_libs = crate::libraries::steam::SteamLibrary::get_library_paths();
            for lib in steam_libs {
                if let Ok(c_lib) = lib.canonicalize() {
                    if path_starts_with_case_insensitive(&canonical, &c_lib) {
                        return Ok(());
                    }
                }
            }
        }
    }

    Err(AppError::PathNotAllowed(path.to_string_lossy().to_string()))
}

pub fn is_path_locked(path: &Path) -> bool {
    if path.is_file() {
        std::fs::OpenOptions::new().write(true).open(path).is_err()
    } else if path.is_dir() {
        for entry in WalkDir::new(path)
            .min_depth(1)
            .max_depth(2)
            .into_iter()
            .flatten()
        {
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

pub fn safe_extract_path(root: &Path, entry_path: &Path) -> Option<PathBuf> {
    let mut safe_rel = PathBuf::new();
    for comp in entry_path.components() {
        match comp {
            Component::Normal(c) => safe_rel.push(c),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if safe_rel.as_os_str().is_empty() {
        return None;
    }
    Some(root.join(safe_rel))
}

const KEYRING_SERVICE: &str = "com.kcache.launcher";
const KEYRING_USER: &str = "steam_api_key";

pub fn get_steam_api_key() -> Option<String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    entry.get_password().ok()
}

pub fn set_steam_api_key(key: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
        .map_err(|e| AppError::Other(format!("Failed to open keyring: {e}")))?;
    if key.trim().is_empty() {
        let _ = entry.delete_credential();
    } else {
        entry
            .set_password(key)
            .map_err(|e| AppError::Other(format!("Failed to save API key to keyring: {e}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_extract_path_normal() {
        let root = Path::new("/var/data");
        let entry = Path::new("normal.txt");
        assert_eq!(
            safe_extract_path(root, entry),
            Some(root.join("normal.txt"))
        );
    }

    #[test]
    fn test_safe_extract_path_parent_dir() {
        let root = Path::new("/var/data");
        let entry = Path::new("../evil.txt");
        assert_eq!(safe_extract_path(root, entry), None);
    }

    #[test]
    fn test_safe_extract_path_absolute() {
        let root = Path::new("/var/data");
        let entry = Path::new("/absolute/path");
        assert_eq!(safe_extract_path(root, entry), None);
    }

    #[test]
    fn test_safe_extract_path_sub_parent_escape() {
        let root = Path::new("/var/data");
        let entry = Path::new("sub/../../evil.txt");
        assert_eq!(safe_extract_path(root, entry), None);
    }

    #[test]
    fn test_safe_extract_path_nested_legitimate() {
        let root = Path::new("/var/data");
        let entry = Path::new("a/b/c.txt");
        assert_eq!(
            safe_extract_path(root, entry),
            Some(root.join("a").join("b").join("c.txt"))
        );
    }

    #[test]
    fn test_validate_path_allowed_real_root() {
        let app_data = dirs::data_dir().expect("data_dir must exist");
        let kcache_dir = app_data.join("Kcache").join("test_allowed");
        let _ = std::fs::create_dir_all(&kcache_dir);
        let test_file = kcache_dir.join("test_real.bin");
        std::fs::write(&test_file, b"test").expect("write test file");
        let res = validate_path_allowed(&test_file);
        let _ = std::fs::remove_file(&test_file);
        let _ = std::fs::remove_dir(&kcache_dir);
        assert!(res.is_ok());
    }

    #[test]
    fn test_validate_path_allowed_dotdot_traversal_safe() {
        let app_data = dirs::data_dir().expect("data_dir must exist");
        let kcache_dir = app_data.join("Kcache").join("test_traversal");
        let sub_dir = kcache_dir.join("subdir");
        let _ = std::fs::create_dir_all(&sub_dir);
        let test_file = kcache_dir.join("target.bin");
        std::fs::write(&test_file, b"target").expect("write test file");
        let traversal_path = sub_dir.join("..").join("target.bin");
        let res = validate_path_allowed(&traversal_path);
        let _ = std::fs::remove_file(&test_file);
        let _ = std::fs::remove_dir(&sub_dir);
        let _ = std::fs::remove_dir(&kcache_dir);
        assert!(res.is_ok());
    }

    #[test]
    fn test_validate_path_allowed_dxvk_cache_outside_rejected() {
        let temp_dir = std::env::temp_dir().join("kcache_test_dxvk_unscoped");
        let _ = std::fs::create_dir_all(&temp_dir);
        let test_file = temp_dir.join("game.dxvk-cache");
        std::fs::write(&test_file, b"cache").expect("write test file");
        let res = validate_path_allowed(&test_file);
        let _ = std::fs::remove_file(&test_file);
        let _ = std::fs::remove_dir(&temp_dir);
        assert!(res.is_err());
    }

    #[test]
    fn test_validate_path_allowed_steamapps_shadercache_and_decoy() {
        let temp_base = std::env::temp_dir().join("kcache_test_steam");
        let genuine_dir = temp_base
            .join("steamapps")
            .join("shadercache")
            .join("12345");
        let _ = std::fs::create_dir_all(&genuine_dir);
        let genuine_file = genuine_dir.join("shaders.bin");
        std::fs::write(&genuine_file, b"shaders").expect("write genuine file");

        let decoy_dir = temp_base.join("decoy_steamapps_shadercache");
        let _ = std::fs::create_dir_all(&decoy_dir);
        let decoy_file = decoy_dir.join("decoy.bin");
        std::fs::write(&decoy_file, b"decoy").expect("write decoy file");

        let decoy_nested_dir = temp_base
            .join("steamapps")
            .join("other")
            .join("shadercache");
        let _ = std::fs::create_dir_all(&decoy_nested_dir);
        let decoy_nested_file = decoy_nested_dir.join("decoy.bin");
        std::fs::write(&decoy_nested_file, b"nested").expect("write nested decoy file");

        let genuine_res = validate_path_allowed(&genuine_file);
        let decoy_res = validate_path_allowed(&decoy_file);
        let decoy_nested_res = validate_path_allowed(&decoy_nested_file);

        let _ = std::fs::remove_file(&genuine_file);
        let _ = std::fs::remove_dir(&genuine_dir);
        let _ = std::fs::remove_file(&decoy_file);
        let _ = std::fs::remove_dir(&decoy_dir);
        let _ = std::fs::remove_file(&decoy_nested_file);
        let _ = std::fs::remove_dir(&decoy_nested_dir);
        let _ = std::fs::remove_dir_all(&temp_base);

        assert!(genuine_res.is_ok());
        assert!(decoy_res.is_err());
        assert!(decoy_nested_res.is_err());
    }
}
