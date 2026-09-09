use crate::types::{AppError, AppResult};
use crate::utils::{validate_path_allowed, is_path_locked};
use std::path::{Path, PathBuf};
use std::io::{BufReader, BufWriter};
use std::fs;
use chrono::Utc;
use log::{info, warn};
use walkdir::WalkDir;

pub fn backup_paths(
    paths: &[PathBuf],
    archive_path: &PathBuf,
) -> AppResult<u64> {

    for p in paths {
        validate_path_allowed(p)?;
        if is_path_locked(p) {
            return Err(AppError::FileLocked(p.to_string_lossy().to_string()));
        }
    }

    if let Some(parent) = archive_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let archive_file = fs::File::create(archive_path)?;
    let buffered = BufWriter::new(archive_file);

    let encoder = zstd::stream::Encoder::new(buffered, 3)?;
    let mut tar = tar::Builder::new(encoder);

    for source_path in paths {
        if source_path.is_file() {
            let name = source_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("cache_file");
            tar.append_path_with_name(source_path, name)?;
        } else if source_path.is_dir() {

            let _dir_name = source_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("cache");

            for entry in WalkDir::new(source_path)
                .min_depth(1)
                .into_iter()
                .flatten()
            {
                if entry.path().is_file() {
                    let relative = entry
                        .path()
                        .strip_prefix(source_path.parent().unwrap_or(source_path))
                        .unwrap_or(entry.path());
                    tar.append_path_with_name(entry.path(), relative)?;
                }
            }
        }
    }

    let encoder = tar.into_inner()?;
    encoder.finish()?;

    let archive_size = archive_path.metadata()?.len();
    info!("[backup] Created archive: {} ({} bytes)", archive_path.display(), archive_size);
    Ok(archive_size)
}

pub fn restore_archive(archive_path: &Path, restore_root: &Path) -> AppResult<Vec<PathBuf>> {
    if !archive_path.exists() {
        return Err(AppError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Archive not found: {}", archive_path.display()),
        )));
    }

    fs::create_dir_all(restore_root)?;

    let archive_file = fs::File::open(archive_path)?;
    let buffered = BufReader::new(archive_file);
    let decoder = zstd::stream::Decoder::new(buffered)?;
    let mut archive = tar::Archive::new(decoder);

    let mut restored_paths = Vec::new();

    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = restore_root.join(entry.path()?);

        if !path.starts_with(restore_root) {
            warn!("[restore] Skipping path outside restore root: {}", path.display());
            continue;
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        entry.unpack(&path)?;
        restored_paths.push(path);
    }

    info!(
        "[restore] Restored {} files to {}",
        restored_paths.len(),
        restore_root.display()
    );
    Ok(restored_paths)
}

pub fn make_archive_path(backup_dir: &Path, game_name: &str) -> PathBuf {
    let sanitized = sanitize_game_name(game_name);
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    backup_dir
        .join("Kcache")
        .join("Backups")
        .join(&sanitized)
        .join(format!("{}.kcache.tar.zst", timestamp))
}

fn sanitize_game_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}
