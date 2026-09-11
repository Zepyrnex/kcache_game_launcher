use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheSource {
    NvidiaDx,
    NvidiaGl,
    AmdDx,
    AmdDxc,
    IntelShader,
    SteamShaderPrecache,
    Dxvk,
    Vkd3d,
    UnityEngine,
    UnrealEngine,
    Unknown,
}

impl fmt::Display for CacheSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CacheSource::NvidiaDx => write!(f, "NVIDIA DXCache"),
            CacheSource::NvidiaGl => write!(f, "NVIDIA GLCache"),
            CacheSource::AmdDx => write!(f, "AMD DxCache"),
            CacheSource::AmdDxc => write!(f, "AMD DxcCache"),
            CacheSource::IntelShader => write!(f, "Intel ShaderCache"),
            CacheSource::SteamShaderPrecache => write!(f, "Steam Shader Pre-Cache"),
            CacheSource::Dxvk => write!(f, "DXVK Cache"),
            CacheSource::Vkd3d => write!(f, "VKD3D Cache"),
            CacheSource::UnityEngine => write!(f, "Unity Engine Cache"),
            CacheSource::UnrealEngine => write!(f, "Unreal Engine Cache"),
            CacheSource::Unknown => write!(f, "Unknown"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheEntry {
    pub id: String,
    pub source: CacheSource,
    pub path: String,
    pub size_bytes: u64,
    pub last_modified: i64,
    pub associated_game_id: Option<String>,
    pub associated_game_guess: Option<String>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedGame {
    pub id: String,
    pub name: String,
    pub platform: GamePlatform,
    pub install_path: String,
    #[serde(default)]
    pub exe_path: Option<String>,
    pub app_id: Option<String>,
    pub last_played: Option<i64>,
    pub icon_url: Option<String>,
    #[serde(default)]
    pub cover_url: Option<String>,
    #[serde(default)]
    pub hero_url: Option<String>,
    #[serde(default)]
    pub logo_url: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub developer: Option<String>,
    #[serde(default)]
    pub publisher: Option<String>,
    #[serde(default)]
    pub release_date: Option<String>,
    #[serde(default)]
    pub playtime_seconds: u64,
    #[serde(default)]
    pub install_size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GamePlatform {
    Steam,
    Epic,
    Gog,
    Xbox,
    Custom,
    Unknown,
}

impl fmt::Display for GamePlatform {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GamePlatform::Steam => write!(f, "Steam"),
            GamePlatform::Epic => write!(f, "Epic Games"),
            GamePlatform::Gog => write!(f, "GOG"),
            GamePlatform::Xbox => write!(f, "Xbox"),
            GamePlatform::Custom => write!(f, "Custom"),
            GamePlatform::Unknown => write!(f, "Unknown"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanFolder {
    pub id: i64,
    pub path: String,
    pub enabled: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredProgram {
    pub name: String,
    pub exe_path: String,
    pub folder_path: String,
    pub size_bytes: u64,
    pub last_modified: i64,
    pub suggested_name: String,
    pub matched_app_id: Option<String>,
    pub matched_cover_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamAppDetails {
    pub app_id: String,
    pub name: String,
    pub short_description: String,
    pub header_image: String,
    pub capsule_image: String,
    pub cover_url: String,
    pub hero_url: String,
    pub logo_url: String,
    pub genres: Vec<String>,
    pub pc_requirements_min: Option<String>,
    pub pc_requirements_rec: Option<String>,
    pub developers: Vec<String>,
    pub publishers: Vec<String>,
    pub release_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamSearchResult {
    pub id: u64,
    pub name: String,
    pub tiny_image: String,
    pub cover_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamOwnedGame {
    pub appid: u64,
    pub name: Option<String>,
    pub playtime_forever: u64,
    pub img_icon_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameCacheGroup {
    pub game: DetectedGame,
    pub caches: Vec<CacheEntry>,
    pub total_cache_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupRecord {
    pub id: i64,
    pub game_id: String,
    pub game_name: String,
    pub archive_path: String,
    pub created_at: i64,
    pub size_bytes: u64,
    pub notes: Option<String>,
    pub original_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub games: Vec<DetectedGame>,
    pub caches: Vec<CacheEntry>,
    pub grouped: Vec<GameCacheGroup>,
    pub unmatched: Vec<CacheEntry>,
    pub total_size_bytes: u64,
    pub gpu_cache_size: u64,
    pub game_cache_size: u64,
    pub scan_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub stage: String,
    pub current_path: Option<String>,
    pub items_found: usize,
    pub bytes_found: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaytimeInfo {
    pub game_id: String,
    pub total_playtime_secs: u64,
    pub is_running: bool,
    pub session_duration_secs: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompressionAlgorithm {
    Zstd,
    Lz4,
}

impl fmt::Display for CompressionAlgorithm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CompressionAlgorithm::Zstd => write!(f, "zstd"),
            CompressionAlgorithm::Lz4 => write!(f, "lz4"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressedVaultEntry {
    pub id: String,
    pub cache_id: String,
    pub game_id: Option<String>,
    pub game_name: String,
    pub original_path: String,
    pub compressed_path: String,
    pub algorithm: CompressionAlgorithm,
    pub original_size: u64,
    pub compressed_size: u64,
    pub ratio: f32,
    pub compressed_at: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionSummary {
    pub total_original_bytes: u64,
    pub total_compressed_bytes: u64,
    pub total_bytes_saved: u64,
    pub space_saved_percent: f32,
    pub total_vault_items: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressionProgress {
    pub cache_id: String,
    pub game_name: String,
    pub stage: String,
    pub current_file: String,
    pub processed_files: usize,
    pub total_files: usize,
    pub processed_bytes: u64,
    pub total_bytes: u64,
    pub percent: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameDiskSize {
    pub install_size_bytes: u64,
    pub cache_size_bytes: u64,
    pub total_size_bytes: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("File is locked by another process: {0}")]
    FileLocked(String),
    #[error("Path not allowed: {0}")]
    PathNotAllowed(String),
    #[error("Backup not found: {0}")]
    BackupNotFound(i64),
    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        #[derive(Serialize)]
        struct ErrorPayload {
            code: &'static str,
            message: String,
        }
        let (code, message) = match self {
            AppError::FileLocked(p) => (
                "FILE_LOCKED",
                format!("File is locked by another process: {p}"),
            ),
            AppError::PathNotAllowed(p) => {
                ("PATH_NOT_ALLOWED", format!("Path not in allowlist: {p}"))
            }
            AppError::BackupNotFound(id) => ("BACKUP_NOT_FOUND", format!("Backup #{id} not found")),
            _ => ("ERROR", self.to_string()),
        };
        ErrorPayload { code, message }.serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameStorageStat {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub cover_url: Option<String>,
    pub hero_url: Option<String>,
    pub icon_url: Option<String>,
    pub install_size_bytes: u64,
    pub cache_size_bytes: u64,
    pub total_size_bytes: u64,
    pub playtime_seconds: u64,
    pub last_played: Option<i64>,
    pub is_installed: bool,
    pub install_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryStatistics {
    pub total_games: usize,
    pub installed_games: usize,
    pub not_installed_games: usize,
    pub played_games: usize,
    pub not_played_games: usize,
    pub total_playtime_seconds: u64,
    pub average_playtime_seconds: u64,
    pub total_install_size_bytes: u64,
    pub total_shader_cache_size_bytes: u64,
    pub total_backup_size_bytes: u64,
    pub total_storage_used_bytes: u64,
    pub platform_counts: std::collections::HashMap<String, usize>,
    pub top_played_games: Vec<GameStorageStat>,
    pub all_games: Vec<GameStorageStat>,
}
