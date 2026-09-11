
export type CacheSource =
  | "nvidia_dx"
  | "nvidia_gl"
  | "amd_dx"
  | "amd_dxc"
  | "intel_shader"
  | "steam_shader_precache"
  | "dxvk"
  | "vkd3d"
  | "unity_engine"
  | "unreal_engine"
  | "unknown";

export type GamePlatform = "steam" | "epic" | "gog" | "xbox" | "custom" | "unknown";

export interface CacheEntry {
  id: string;
  source: CacheSource;
  path: string;
  size_bytes: number;
  last_modified: number;
  associated_game_id: string | null;
  associated_game_guess: string | null;
  confidence: number;
}

export interface DetectedGame {
  id: string;
  name: string;
  platform: GamePlatform;
  install_path: string;
  exe_path?: string | null;
  app_id: string | null;
  last_played: number | null;
  icon_url: string | null;
  cover_url?: string | null;
  hero_url?: string | null;
  logo_url?: string | null;
  description?: string | null;
  genres?: string[];
  developer?: string | null;
  publisher?: string | null;
  release_date?: string | null;
  playtime_seconds?: number;
  install_size_bytes?: number;
}

export interface PlaytimeInfo {
  game_id: string;
  total_playtime_secs: number;
  is_running: boolean;
  session_duration_secs: number;
}

export interface GameDiskSize {
  install_size_bytes: number;
  cache_size_bytes: number;
  total_size_bytes: number;
}

export type CompressionAlgorithm = "zstd" | "lz4";

export interface CompressedVaultEntry {
  id: string;
  cache_id: string;
  game_id: string | null;
  game_name: string;
  original_path: string;
  compressed_path: string;
  algorithm: CompressionAlgorithm;
  original_size: number;
  compressed_size: number;
  ratio: number;
  compressed_at: number;
  status: "compressed" | "decompressed";
}

export interface CompressionSummary {
  total_original_bytes: number;
  total_compressed_bytes: number;
  total_bytes_saved: number;
  space_saved_percent: number;
  total_vault_items: number;
}

export interface CompressionProgress {
  cache_id: string;
  game_name: string;
  stage: string;
  current_file: string;
  processed_files: number;
  total_files: number;
  processed_bytes: number;
  total_bytes: number;
  percent: number;
}

export interface ScanFolder {
  id: number;
  path: string;
  enabled: boolean;
  created_at: number;
}

export interface DiscoveredProgram {
  name: string;
  exe_path: string;
  folder_path: string;
  size_bytes: number;
  last_modified: number;
  suggested_name: string;
  matched_app_id: string | null;
  matched_cover_url: string | null;
}

export interface SteamAppDetails {
  app_id: string;
  name: string;
  short_description: string;
  header_image: string;
  capsule_image: string;
  cover_url: string;
  hero_url: string;
  logo_url: string;
  genres: string[];
  pc_requirements_min?: string | null;
  pc_requirements_rec?: string | null;
  developers: string[];
  publishers: string[];
  release_date?: string | null;
}

export interface SteamSearchResult {
  id: number;
  name: string;
  tiny_image: string;
  cover_url: string;
}

export type LauncherLayoutMode = "grid" | "details" | "table";

export interface GameCacheGroup {
  game: DetectedGame;
  caches: CacheEntry[];
  total_cache_size: number;
}

export interface BackupRecord {
  id: number;
  game_id: string;
  game_name: string;
  archive_path: string;
  created_at: number;
  size_bytes: number;
  notes: string | null;
  original_paths: string[];
}

export interface TrashRecord {
  id: number;
  original_path: string;
  trash_path: string;
  game_id: string | null;
  game_name: string | null;
  deleted_at: number;
}

export interface ScanResult {
  games: DetectedGame[];
  caches: CacheEntry[];
  grouped: GameCacheGroup[];
  unmatched: CacheEntry[];
  total_size_bytes: number;
  gpu_cache_size: number;
  game_cache_size: number;
  scan_duration_ms: number;
}

export interface ScanProgress {
  stage: string;
  current_path: string | null;
  items_found: number;
  bytes_found: number;
}

export interface EverythingStatus {
  installed: boolean;
  install_path: string | null;
  http_available: boolean;
  http_port: number | null;
}

export interface AppSettings {
  theme: "dark" | "light";
  accent_color: string;
  backup_dir: string;
  excluded_paths: string[];
  excluded_game_ids: string[];
}

export interface ExcludedGame {
  id: string;
  name: string;
  platform: string;
  app_id: string | null;
  exe_path: string | null;
  excluded_at: number;
}

export type SortField = "size" | "name" | "platform" | "last_modified";
export type SortDir = "asc" | "desc";
export type FilterPlatform = "all" | GamePlatform;
export type FilterHasCache = "all" | "has_cache" | "no_cache";

export interface GameStorageStat {
  id: string;
  name: string;
  platform: string;
  cover_url?: string | null;
  hero_url?: string | null;
  icon_url?: string | null;
  install_size_bytes: number;
  cache_size_bytes: number;
  total_size_bytes: number;
  playtime_seconds: number;
  last_played?: number | null;
  is_installed: boolean;
  install_path: string;
}

export interface LibraryStatistics {
  total_games: number;
  installed_games: number;
  not_installed_games: number;
  played_games: number;
  not_played_games: number;
  total_playtime_seconds: number;
  average_playtime_seconds: number;
  total_install_size_bytes: number;
  total_shader_cache_size_bytes: number;
  total_backup_size_bytes: number;
  total_storage_used_bytes: number;
  platform_counts: Record<string, number>;
  top_played_games: GameStorageStat[];
  all_games: GameStorageStat[];
}
