use crate::types::{
    AppError, AppResult, CompressedVaultEntry, CompressionAlgorithm, CompressionProgress,
};
use chrono::Utc;
use log::{info, warn};
use lz4_flex::frame::{FrameDecoder, FrameEncoder};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use walkdir::WalkDir;

pub fn get_vault_directory() -> PathBuf {
    let base = dirs::data_dir()
        .or_else(dirs::data_local_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("com.kcache.launcher").join("compressed_vault")
}

pub fn compress_shader_target(
    app: &AppHandle,
    source_path: &Path,
    game_id: Option<String>,
    game_name: &str,
    cache_id: &str,
    algorithm: CompressionAlgorithm,
) -> AppResult<CompressedVaultEntry> {
    if !source_path.exists() {
        return Err(AppError::Other(format!(
            "Source shader path does not exist: {}",
            source_path.display()
        )));
    }

    let vault_dir = get_vault_directory();
    let sanitized_game = sanitize_name(game_name);
    let target_dir = vault_dir.join(&sanitized_game);
    fs::create_dir_all(&target_dir)?;

    let entry_id = Uuid::new_v4().to_string();
    let is_directory = source_path.is_dir();

    let (compressed_path, original_size, compressed_size) = if is_directory {
        compress_directory_streaming(
            app,
            source_path,
            &target_dir,
            &entry_id,
            &algorithm,
            cache_id,
            game_name,
        )?
    } else {
        compress_single_file_streaming(
            app,
            source_path,
            &target_dir,
            &entry_id,
            &algorithm,
            cache_id,
            game_name,
        )?
    };

    let ratio = if original_size > 0 {
        let saved = (original_size as f64 - compressed_size as f64) / (original_size as f64);
        (saved * 100.0).max(0.0) as f32
    } else {
        0.0
    };

    let _ = app.emit(
        "compression-progress",
        CompressionProgress {
            cache_id: cache_id.to_string(),
            game_name: game_name.to_string(),
            stage: "done".to_string(),
            current_file: "Completed".to_string(),
            processed_files: 1,
            total_files: 1,
            processed_bytes: original_size,
            total_bytes: original_size,
            percent: 100.0,
        },
    );

    info!(
        "[Compressor] Compressed {} ({}) -> {} bytes ({:.1}% saved) with {:?}",
        source_path.display(),
        original_size,
        compressed_size,
        ratio,
        algorithm
    );

    Ok(CompressedVaultEntry {
        id: entry_id,
        cache_id: cache_id.to_string(),
        game_id,
        game_name: game_name.to_string(),
        original_path: source_path.to_string_lossy().to_string(),
        compressed_path: compressed_path.to_string_lossy().to_string(),
        algorithm,
        original_size,
        compressed_size,
        ratio,
        compressed_at: Utc::now().timestamp(),
        status: "compressed".to_string(),
    })
}

fn compress_single_file_streaming(
    app: &AppHandle,
    source_path: &Path,
    target_dir: &Path,
    entry_id: &str,
    algorithm: &CompressionAlgorithm,
    cache_id: &str,
    game_name: &str,
) -> AppResult<(PathBuf, u64, u64)> {
    let source_file = match File::open(source_path) {
        Ok(f) => f,
        Err(e) if e.raw_os_error() == Some(5) || e.raw_os_error() == Some(32) => {
            return Err(AppError::Other(format!(
                "Shader file is currently locked by the graphics driver or running game: {}. Close running games and try again.",
                source_path.display()
            )));
        }
        Err(e) => return Err(AppError::from(e)),
    };
    let original_size = source_file.metadata()?.len();

    let file_stem = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("shader");

    let ext = match algorithm {
        CompressionAlgorithm::Zstd => "cache.zst",
        CompressionAlgorithm::Lz4 => "cache.lz4",
    };

    let target_filename = format!("{}_{}.{}", sanitize_name(file_stem), &entry_id[..8], ext);
    let destination = target_dir.join(target_filename);
    let dest_file = File::create(&destination)?;
    let mut dest_writer = BufWriter::with_capacity(256 * 1024, dest_file);

    let mut reader = BufReader::with_capacity(256 * 1024, source_file);

    let _ = app.emit(
        "compression-progress",
        CompressionProgress {
            cache_id: cache_id.to_string(),
            game_name: game_name.to_string(),
            stage: "compressing".to_string(),
            current_file: file_stem.to_string(),
            processed_files: 0,
            total_files: 1,
            processed_bytes: 0,
            total_bytes: original_size,
            percent: 0.0,
        },
    );

    let encode_result: AppResult<()> = (|| {
        match algorithm {
            CompressionAlgorithm::Zstd => {
                let mut encoder = zstd::stream::Encoder::new(&mut dest_writer, 6)?;
                std::io::copy(&mut reader, &mut encoder)?;
                encoder.finish()?;
            }
            CompressionAlgorithm::Lz4 => {
                let mut encoder = FrameEncoder::new(&mut dest_writer);
                std::io::copy(&mut reader, &mut encoder)?;
                encoder
                    .finish()
                    .map_err(|e| AppError::Other(format!("LZ4 finish error: {e}")))?;
            }
        }
        dest_writer.flush()?;
        Ok(())
    })();

    if let Err(err) = encode_result {
        let _ = fs::remove_file(&destination);
        return Err(err);
    }

    let compressed_size = destination.metadata()?.len();
    Ok((destination, original_size, compressed_size))
}

fn compress_directory_streaming(
    app: &AppHandle,
    source_path: &Path,
    target_dir: &Path,
    entry_id: &str,
    algorithm: &CompressionAlgorithm,
    cache_id: &str,
    game_name: &str,
) -> AppResult<(PathBuf, u64, u64)> {
    let mut total_files = 0usize;
    let mut total_bytes = 0u64;

    for entry in WalkDir::new(source_path).min_depth(1).into_iter().flatten() {
        if entry.path().is_file() {
            total_files += 1;
            if let Ok(meta) = entry.metadata() {
                total_bytes += meta.len();
            }
        }
    }

    let dir_name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("shader_cache");

    let ext = match algorithm {
        CompressionAlgorithm::Zstd => "tar.zst",
        CompressionAlgorithm::Lz4 => "tar.lz4",
    };

    let target_filename = format!("{}_{}.{}", sanitize_name(dir_name), &entry_id[..8], ext);
    let destination = target_dir.join(target_filename);
    let dest_file = File::create(&destination)?;
    let dest_writer = BufWriter::with_capacity(512 * 1024, dest_file);

    let mut processed_files = 0usize;
    let mut processed_bytes = 0u64;
    let mut last_progress_time = std::time::Instant::now();
    let mut file_buf = Vec::with_capacity(256 * 1024);

    let encode_result: AppResult<()> = match algorithm {
        CompressionAlgorithm::Zstd => (|| {
            let encoder = zstd::stream::Encoder::new(dest_writer, 6)?;
            let mut tar_builder = tar::Builder::new(encoder);

            for entry in WalkDir::new(source_path).min_depth(1).into_iter().flatten() {
                let path = entry.path();
                if path.is_file() {
                    let relative = match path.strip_prefix(source_path) {
                        Ok(r) => r,
                        Err(_) => continue,
                    };

                    match File::open(path) {
                        Ok(mut f) => {
                            let f_len = f.metadata().map(|m| m.len()).unwrap_or(0);
                            if f_len == 0 {
                                let mut header = tar::Header::new_gnu();
                                header.set_size(0);
                                header.set_mode(0o644);
                                header.set_cksum();
                                if tar_builder
                                    .append_data(&mut header, relative, std::io::empty())
                                    .is_ok()
                                {
                                    processed_files += 1;
                                }
                            } else if f_len <= 32 * 1024 * 1024 {
                                file_buf.clear();
                                if std::io::Read::read_to_end(&mut f, &mut file_buf).is_ok() {
                                    let mut header = tar::Header::new_gnu();
                                    header.set_size(file_buf.len() as u64);
                                    header.set_mode(0o644);
                                    header.set_cksum();
                                    if tar_builder
                                        .append_data(&mut header, relative, &file_buf[..])
                                        .is_ok()
                                    {
                                        processed_bytes += file_buf.len() as u64;
                                        processed_files += 1;
                                    }
                                }
                            } else {
                                if tar_builder.append_file(relative, &mut f).is_ok() {
                                    processed_bytes += f_len;
                                    processed_files += 1;
                                }
                            }
                        }
                        Err(e) => {
                            warn!(
                                "[Compressor] Skipping locked/inaccessible file {}: {:?}",
                                path.display(),
                                e
                            );
                        }
                    }

                    if last_progress_time.elapsed().as_millis() > 200
                        || processed_files == total_files
                    {
                        last_progress_time = std::time::Instant::now();
                        let percent = if total_bytes > 0 {
                            ((processed_bytes as f64 / total_bytes as f64) * 100.0).min(99.0) as f32
                        } else {
                            0.0
                        };

                        let _ = app.emit(
                            "compression-progress",
                            CompressionProgress {
                                cache_id: cache_id.to_string(),
                                game_name: game_name.to_string(),
                                stage: "compressing".to_string(),
                                current_file: relative.to_string_lossy().to_string(),
                                processed_files,
                                total_files,
                                processed_bytes,
                                total_bytes,
                                percent,
                            },
                        );
                    }
                }
            }

            let encoder = tar_builder.into_inner()?;
            encoder.finish()?;
            Ok(())
        })(),
        CompressionAlgorithm::Lz4 => (|| {
            let encoder = FrameEncoder::new(dest_writer);
            let mut tar_builder = tar::Builder::new(encoder);

            for entry in WalkDir::new(source_path).min_depth(1).into_iter().flatten() {
                let path = entry.path();
                if path.is_file() {
                    let relative = match path.strip_prefix(source_path) {
                        Ok(r) => r,
                        Err(_) => continue,
                    };

                    match File::open(path) {
                        Ok(mut f) => {
                            let f_len = f.metadata().map(|m| m.len()).unwrap_or(0);
                            if f_len == 0 {
                                let mut header = tar::Header::new_gnu();
                                header.set_size(0);
                                header.set_mode(0o644);
                                header.set_cksum();
                                if tar_builder
                                    .append_data(&mut header, relative, std::io::empty())
                                    .is_ok()
                                {
                                    processed_files += 1;
                                }
                            } else if f_len <= 32 * 1024 * 1024 {
                                file_buf.clear();
                                if std::io::Read::read_to_end(&mut f, &mut file_buf).is_ok() {
                                    let mut header = tar::Header::new_gnu();
                                    header.set_size(file_buf.len() as u64);
                                    header.set_mode(0o644);
                                    header.set_cksum();
                                    if tar_builder
                                        .append_data(&mut header, relative, &file_buf[..])
                                        .is_ok()
                                    {
                                        processed_bytes += file_buf.len() as u64;
                                        processed_files += 1;
                                    }
                                }
                            } else {
                                if tar_builder.append_file(relative, &mut f).is_ok() {
                                    processed_bytes += f_len;
                                    processed_files += 1;
                                }
                            }
                        }
                        Err(e) => {
                            warn!(
                                "[Compressor] Skipping locked/inaccessible file {}: {:?}",
                                path.display(),
                                e
                            );
                        }
                    }

                    if last_progress_time.elapsed().as_millis() > 200
                        || processed_files == total_files
                    {
                        last_progress_time = std::time::Instant::now();
                        let percent = if total_bytes > 0 {
                            ((processed_bytes as f64 / total_bytes as f64) * 100.0).min(99.0) as f32
                        } else {
                            0.0
                        };

                        let _ = app.emit(
                            "compression-progress",
                            CompressionProgress {
                                cache_id: cache_id.to_string(),
                                game_name: game_name.to_string(),
                                stage: "compressing".to_string(),
                                current_file: relative.to_string_lossy().to_string(),
                                processed_files,
                                total_files,
                                processed_bytes,
                                total_bytes,
                                percent,
                            },
                        );
                    }
                }
            }

            let encoder = tar_builder.into_inner()?;
            encoder
                .finish()
                .map_err(|e| AppError::Other(format!("LZ4 finish error: {e}")))?;
            Ok(())
        })(),
    };

    if let Err(err) = encode_result {
        let _ = fs::remove_file(&destination);
        return Err(err);
    }

    if total_files > 0 && processed_files == 0 {
        let _ = fs::remove_file(&destination);
        return Err(AppError::Other(format!(
            "Unable to compress {}: all files are currently locked by the graphics driver. Close running games and try again.",
            source_path.display()
        )));
    }

    let compressed_size = destination.metadata()?.len();
    Ok((destination, processed_bytes, compressed_size))
}

pub fn decompress_shader_target(
    app: &AppHandle,
    compressed_path: &Path,
    original_target_path: &Path,
    algorithm: &CompressionAlgorithm,
    cache_id: &str,
    game_name: &str,
) -> AppResult<()> {
    if !compressed_path.exists() {
        return Err(AppError::Other(format!(
            "Compressed vault file not found: {}",
            compressed_path.display()
        )));
    }

    let file_name = compressed_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    let is_tar = file_name.contains(".tar.");
    let comp_file = File::open(compressed_path)?;
    let total_comp_bytes = comp_file.metadata()?.len();
    let buf_reader = BufReader::with_capacity(512 * 1024, comp_file);

    let _ = app.emit(
        "compression-progress",
        CompressionProgress {
            cache_id: cache_id.to_string(),
            game_name: game_name.to_string(),
            stage: "decompressing".to_string(),
            current_file: "Extracting shaders...".to_string(),
            processed_files: 0,
            total_files: 1,
            processed_bytes: 0,
            total_bytes: total_comp_bytes,
            percent: 10.0,
        },
    );

    if is_tar {
        fs::create_dir_all(original_target_path)?;

        match algorithm {
            CompressionAlgorithm::Zstd => {
                let decoder = zstd::stream::Decoder::new(buf_reader)?;
                let mut archive = tar::Archive::new(decoder);
                for mut e in archive.entries()?.flatten() {
                    if let Ok(rel) = e.path() {
                        let unpacked_path =
                            match crate::utils::safe_extract_path(original_target_path, &rel) {
                                Some(p) => p,
                                None => {
                                    warn!(
                                        "[decompress] Skipping unsafe path traversal entry: {}",
                                        rel.display()
                                    );
                                    continue;
                                }
                            };
                        if let Some(parent) = unpacked_path.parent() {
                            fs::create_dir_all(parent)?;
                        }
                        let _ = e.unpack(&unpacked_path);
                    }
                }
            }
            CompressionAlgorithm::Lz4 => {
                let decoder = FrameDecoder::new(buf_reader);
                let mut archive = tar::Archive::new(decoder);
                for mut e in archive.entries()?.flatten() {
                    if let Ok(rel) = e.path() {
                        let unpacked_path =
                            match crate::utils::safe_extract_path(original_target_path, &rel) {
                                Some(p) => p,
                                None => {
                                    warn!(
                                        "[decompress] Skipping unsafe path traversal entry: {}",
                                        rel.display()
                                    );
                                    continue;
                                }
                            };
                        if let Some(parent) = unpacked_path.parent() {
                            fs::create_dir_all(parent)?;
                        }
                        let _ = e.unpack(&unpacked_path);
                    }
                }
            }
        }
    } else {
        if let Some(parent) = original_target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let out_file = File::create(original_target_path)?;
        let mut out_writer = BufWriter::with_capacity(256 * 1024, out_file);

        match algorithm {
            CompressionAlgorithm::Zstd => {
                let mut decoder = zstd::stream::Decoder::new(buf_reader)?;
                std::io::copy(&mut decoder, &mut out_writer)?;
            }
            CompressionAlgorithm::Lz4 => {
                let mut decoder = FrameDecoder::new(buf_reader);
                std::io::copy(&mut decoder, &mut out_writer)?;
            }
        }
        out_writer.flush()?;
    }

    let _ = app.emit(
        "compression-progress",
        CompressionProgress {
            cache_id: cache_id.to_string(),
            game_name: game_name.to_string(),
            stage: "done".to_string(),
            current_file: "Decompressed".to_string(),
            processed_files: 1,
            total_files: 1,
            processed_bytes: total_comp_bytes,
            total_bytes: total_comp_bytes,
            percent: 100.0,
        },
    );

    info!(
        "[Compressor] Decompressed {} -> {}",
        compressed_path.display(),
        original_target_path.display()
    );

    Ok(())
}

fn sanitize_name(name: &str) -> String {
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
