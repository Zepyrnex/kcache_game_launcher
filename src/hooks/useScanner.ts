import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useState, useCallback, useEffect } from "react";
import type {
  ScanResult,
  ScanProgress,
  TrashRecord,
  BackupRecord,
  EverythingStatus,
  ScanFolder,
  DiscoveredProgram,
  DetectedGame,
  SteamAppDetails,
  SteamSearchResult,
  ExcludedGame,
  PlaytimeInfo,
  GameDiskSize,
  CompressedVaultEntry,
  CompressionAlgorithm,
  CompressionProgress,
} from "../types";

interface ScannerState {
  status: "idle" | "scanning" | "done" | "error";
  progress: ScanProgress | null;
  result: ScanResult | null;
  error: string | null;
}

const STORAGE_KEY = "kcache_cached_scan_result";

function loadInitialResult(): ScanResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.games) && Array.isArray(parsed.grouped)) {
        console.log("[Kcache] Loaded cached scan result from localStorage:", parsed.games.length, "games");
        return parsed;
      }
    }
  } catch (e) {
    console.error("[Kcache] Failed to read cached scan result:", e);
  }
  return null;
}

const initialCachedResult = loadInitialResult();

let globalState: ScannerState = {
  status: initialCachedResult ? "done" : "idle",
  progress: null,
  result: initialCachedResult,
  error: null,
};

const listeners = new Set<(state: ScannerState) => void>();

function setGlobalState(update: Partial<ScannerState> | ((prev: ScannerState) => ScannerState)) {
  if (typeof update === "function") {
    globalState = update(globalState);
  } else {
    globalState = { ...globalState, ...update };
  }

  if (globalState.result) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(globalState.result));
    } catch (e) {
      console.warn("[Kcache] Could not save scan result to localStorage:", e);
    }
  }

  listeners.forEach((listener) => {
    try {
      listener(globalState);
    } catch (e) {
      console.error("[Kcache] Error in scanner listener:", e);
    }
  });
}

let activeUnlisten: UnlistenFn | null = null;
let isScanInProgress = false;

export async function runGlobalScan(): Promise<ScanResult> {
  if (isScanInProgress) {
    console.log("[Kcache] Scan already in progress, returning existing result.");
    if (globalState.result) return globalState.result;
  }
  isScanInProgress = true;

  if (activeUnlisten) {
    activeUnlisten();
    activeUnlisten = null;
  }

  setGlobalState({
    status: "scanning",
    progress: null,
    error: null,
  });

  try {
    const unlisten = await listen<ScanProgress>("scan-progress", (event) => {
      setGlobalState((prev) => ({ ...prev, progress: event.payload }));
    });
    activeUnlisten = unlisten;

    const result = await invoke<ScanResult>("run_scan");
    setGlobalState({
      status: "done",
      progress: null,
      result,
      error: null,
    });
    return result;
  } catch (err) {
    const msg = typeof err === "string" ? err : JSON.stringify(err);
    setGlobalState({
      status: "error",
      progress: null,
      error: msg,
    });
    throw err;
  } finally {
    if (activeUnlisten) {
      activeUnlisten();
      activeUnlisten = null;
    }
    isScanInProgress = false;
  }
}

export function useScanner() {
  const [state, setState] = useState<ScannerState>(globalState);

  useEffect(() => {
    listeners.add(setState);

    setState(globalState);
    return () => {
      listeners.delete(setState);
    };
  }, []);

  const startScan = useCallback(async () => {
    return runGlobalScan();
  }, []);

  return { ...state, startScan };
}

export async function softDeleteCache(
  cachePath: string,
  gameId?: string,
  gameName?: string
): Promise<TrashRecord> {
  const res = await invoke<TrashRecord>("delete_cache", {
    cachePath,
    gameId: gameId ?? null,
    gameName: gameName ?? null,
  });

  if (globalState.result) {
    const normalizedPath = cachePath.toLowerCase().replace(/\//g, "\\");
    const updatedCaches = globalState.result.caches.filter(
      (c) => c.path.toLowerCase().replace(/\//g, "\\") !== normalizedPath
    );
    const updatedGrouped = globalState.result.grouped.map((g) => {
      const filtered = g.caches.filter(
        (c) => c.path.toLowerCase().replace(/\//g, "\\") !== normalizedPath
      );
      const total_cache_size = filtered.reduce((acc, c) => acc + c.size_bytes, 0);
      return { ...g, caches: filtered, total_cache_size };
    });
    const total_size_bytes = updatedCaches.reduce((acc, c) => acc + c.size_bytes, 0);

    setGlobalState({
      result: {
        ...globalState.result,
        caches: updatedCaches,
        grouped: updatedGrouped,
        total_size_bytes,
      },
    });
  }

  return res;
}

export async function restoreFromTrash(trashId: number): Promise<string> {
  return invoke<string>("restore_from_trash", { trashId });
}

export async function getTrash(): Promise<TrashRecord[]> {
  return invoke<TrashRecord[]>("get_trash");
}

export async function backupCache(
  gameId: string,
  gameName: string,
  cachePaths: string[],
  notes?: string
): Promise<BackupRecord> {
  return invoke<BackupRecord>("backup_game_cache", {
    gameId,
    gameName,
    cachePaths,
    notes: notes ?? null,
  });
}

export async function restoreFromArchive(
  archivePath: string,
  restoreTo: string
): Promise<string[]> {
  return invoke<string[]>("restore_cache_from_archive", { archivePath, restoreTo });
}

export async function getBackups(gameId: string): Promise<BackupRecord[]> {
  return invoke<BackupRecord[]>("get_backups", { gameId });
}

export async function getSettings(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("get_settings");
}

export async function setSetting(key: string, value: string): Promise<void> {
  return invoke("set_setting", { key, value });
}

export async function getEverythingStatus(): Promise<EverythingStatus> {
  return invoke<EverythingStatus>("get_everything_status");
}

export async function getScanFolders(): Promise<ScanFolder[]> {
  return invoke<ScanFolder[]>("get_scan_folders");
}

export async function addScanFolder(path: string): Promise<ScanFolder> {
  return invoke<ScanFolder>("add_scan_folder", { path });
}

export async function removeScanFolder(id: number): Promise<void> {
  return invoke("remove_scan_folder", { id });
}

export async function toggleScanFolder(id: number, enabled: boolean): Promise<void> {
  return invoke("toggle_scan_folder", { id, enabled });
}

export async function scanCustomFolders(): Promise<DiscoveredProgram[]> {
  return invoke<DiscoveredProgram[]>("scan_custom_folders");
}

export async function addCustomGames(programs: DiscoveredProgram[]): Promise<DetectedGame[]> {
  return invoke<DetectedGame[]>("add_custom_games", { programs });
}

export async function launchGame(gameId: string): Promise<void> {
  return invoke("launch_game", { gameId });
}

export async function openGameFolder(path: string): Promise<void> {
  return invoke("open_game_folder", { path });
}

export async function updateGameExe(gameId: string, exePath: string): Promise<void> {
  await invoke("update_game_exe", { gameId, exePath });

  if (globalState.result) {
    const updatedGames = globalState.result.games.map((g) =>
      g.id === gameId ? { ...g, exe_path: exePath } : g
    );
    const updatedGrouped = globalState.result.grouped.map((grp) =>
      grp.game.id === gameId
        ? { ...grp, game: { ...grp.game, exe_path: exePath } }
        : grp
    );
    setGlobalState({
      result: {
        ...globalState.result,
        games: updatedGames,
        grouped: updatedGrouped,
      },
    });
  }
}

export async function deleteGame(gameId: string): Promise<void> {
  await invoke("delete_game", { gameId });

  if (globalState.result) {
    const updatedGames = globalState.result.games.filter((g) => g.id !== gameId);
    const updatedGrouped = globalState.result.grouped.filter((g) => g.game.id !== gameId);
    setGlobalState({
      result: {
        ...globalState.result,
        games: updatedGames,
        grouped: updatedGrouped,
      },
    });
  }
}

export async function getExcludedGames(): Promise<ExcludedGame[]> {
  return invoke<ExcludedGame[]>("get_excluded_games");
}

export async function restoreGame(gameId: string): Promise<void> {
  return invoke("restore_game", { gameId });
}

export async function fetchSteamMetadata(appId: string): Promise<SteamAppDetails> {
  return invoke<SteamAppDetails>("fetch_steam_metadata", { appId });
}

export async function searchSteamGames(query: string): Promise<SteamSearchResult[]> {
  return invoke<SteamSearchResult[]>("search_steam_games", { query });
}

export async function updateGameMetadata(params: {
  gameId: string;
  name?: string;
  appId?: string;
  coverUrl?: string;
  heroUrl?: string;
  logoUrl?: string;
  description?: string;
  genres?: string[];
  developer?: string;
  publisher?: string;
  releaseDate?: string;
}): Promise<void> {
  return invoke("update_game_metadata", {
    gameId: params.gameId,
    name: params.name ?? null,
    appId: params.appId ?? null,
    coverUrl: params.coverUrl ?? null,
    heroUrl: params.heroUrl ?? null,
    logoUrl: params.logoUrl ?? null,
    description: params.description ?? null,
    genres: params.genres ?? null,
    developer: params.developer ?? null,
    publisher: params.publisher ?? null,
    releaseDate: params.releaseDate ?? null,
  });
}

export async function detectSteamId(): Promise<string | null> {
  return invoke<string | null>("detect_steam_id");
}

export async function syncSteamWebApi(apiKey: string, steamId?: string): Promise<number> {
  return invoke<number>("sync_steam_web_api", {
    apiKey,
    steamId: steamId ?? null,
  });
}

export async function getGamePlaytime(gameId: string): Promise<PlaytimeInfo> {
  return invoke<PlaytimeInfo>("get_game_playtime", { gameId });
}

export async function getGameDiskSize(gameId: string, forceRefresh?: boolean): Promise<GameDiskSize> {
  return invoke<GameDiskSize>("get_game_disk_size", { gameId, forceRefresh: forceRefresh ?? false });
}

export function formatPlaytime(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return "0m";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

export function formatTimer(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

interface CompressorGlobalState {
  activeProgress: CompressionProgress | null;
  processingIds: Set<string>;
}

let globalCompressorState: CompressorGlobalState = {
  activeProgress: null,
  processingIds: new Set<string>(),
};

const compressorListeners = new Set<(state: CompressorGlobalState) => void>();

function setGlobalCompressorState(
  update: Partial<CompressorGlobalState> | ((prev: CompressorGlobalState) => CompressorGlobalState)
) {
  if (typeof update === "function") {
    globalCompressorState = update(globalCompressorState);
  } else {
    globalCompressorState = { ...globalCompressorState, ...update };
  }
  compressorListeners.forEach((l) => {
    try {
      l(globalCompressorState);
    } catch (e) {
      console.error(e);
    }
  });
}

let compressorUnlisten: UnlistenFn | null = null;

async function setupCompressorEventListener() {
  if (compressorUnlisten) return;
  try {
    compressorUnlisten = await listen<CompressionProgress>("compression-progress", (event) => {
      const payload = event.payload;
      setGlobalCompressorState((prev) => {
        const nextIds = new Set(prev.processingIds);
        if (payload.stage === "done") {
          nextIds.delete(payload.cache_id);
          return {
            activeProgress: payload,
            processingIds: nextIds,
          };
        } else {
          nextIds.add(payload.cache_id);
          return {
            activeProgress: payload,
            processingIds: nextIds,
          };
        }
      });

      if (payload.stage === "done") {
        setTimeout(() => {
          setGlobalCompressorState((prev) => ({
            ...prev,
            activeProgress: prev.activeProgress?.cache_id === payload.cache_id ? null : prev.activeProgress,
          }));
        }, 3000);
      }
    });
  } catch (err) {
    console.error("Failed to setup compression progress listener:", err);
  }
}

setupCompressorEventListener().catch(console.error);

export function useCompressor() {
  const [state, setState] = useState<CompressorGlobalState>(globalCompressorState);

  useEffect(() => {
    compressorListeners.add(setState);
    return () => {
      compressorListeners.delete(setState);
    };
  }, []);

  return state;
}

export async function compressShaderCache(params: {
  sourcePath: string;
  gameId?: string | null;
  gameName: string;
  cacheId: string;
  algorithm: CompressionAlgorithm;
}): Promise<CompressedVaultEntry> {
  setGlobalCompressorState((prev) => {
    const nextIds = new Set(prev.processingIds);
    nextIds.add(params.cacheId);
    return { ...prev, processingIds: nextIds };
  });

  try {
    const result = await invoke<CompressedVaultEntry>("compress_shader_cache", {
      sourcePath: params.sourcePath,
      gameId: params.gameId ?? null,
      gameName: params.gameName,
      cacheId: params.cacheId,
      algorithm: params.algorithm,
    });
    return result;
  } catch (err) {
    setGlobalCompressorState((prev) => ({
      ...prev,
      activeProgress: null,
    }));
    throw err;
  } finally {
    setGlobalCompressorState((prev) => {
      const nextIds = new Set(prev.processingIds);
      nextIds.delete(params.cacheId);
      return { ...prev, processingIds: nextIds };
    });
  }
}

export async function decompressShaderCache(vaultId: string, cacheId?: string): Promise<void> {
  if (cacheId) {
    setGlobalCompressorState((prev) => {
      const nextIds = new Set(prev.processingIds);
      nextIds.add(cacheId);
      return { ...prev, processingIds: nextIds };
    });
  }

  try {
    await invoke("decompress_shader_cache", { vaultId });
  } catch (err) {
    setGlobalCompressorState((prev) => ({
      ...prev,
      activeProgress: null,
    }));
    throw err;
  } finally {
    if (cacheId) {
      setGlobalCompressorState((prev) => {
        const nextIds = new Set(prev.processingIds);
        nextIds.delete(cacheId);
        return { ...prev, processingIds: nextIds };
      });
    }
  }
}

export async function getVaultEntries(): Promise<CompressedVaultEntry[]> {
  return invoke<CompressedVaultEntry[]>("get_vault_entries");
}

export async function deleteVaultEntry(vaultId: string): Promise<void> {
  return invoke("delete_vault_entry", { vaultId });
}

export async function openVaultFolder(): Promise<void> {
  return invoke("open_vault_folder");
}


