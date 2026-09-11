import React, { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { FolderOpen, Search, RefreshCw, Archive, Check } from "lucide-react";

export interface GameSave {
  game_name: string;
  found_path: string;
  size: number;
  source?: string;
  app_id?: string;
}

export interface BackupProgress {
  percent: number;
  current_file: string;
  processed_files: number;
  total_files: number;
  status: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export const SaveManager: React.FC = () => {
  const [saves, setSaves] = useState<GameSave[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<boolean>(false);
  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [backupResult, setBackupResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [activeSourceFilter, setActiveSourceFilter] = useState<string>("all");

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<BackupProgress>("backup-progress", (event) => {
          setProgress(event.payload);
          if (event.payload.status === "done") {
            setIsBackingUp(false);
          }
        });
      } catch (err) {
        console.error("Failed to register backup-progress listener:", err);
      }
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleDetectSaves = async () => {
    setLoading(true);
    setError(null);
    setBackupResult(null);
    try {
      const detected = await invoke<GameSave[]>("detect_saves", { manifestYaml: null });
      setSaves(detected);
      setSelectedPaths(new Set(detected.map((s) => s.found_path)));
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "Failed to detect saves.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleDetectSaves();
  }, []);

  const handleOpenSaveFolder = async (path: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    try {
      await invoke("open_save_folder", { path });
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "Failed to open folder.");
    }
  };

  const handleOpenBackupFolder = async () => {
    try {
      await invoke("open_backup_folder", { customDir: null });
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "Failed to open backup folder.");
    }
  };

  const toggleSelect = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedPaths.size === filteredSaves.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(filteredSaves.map((s) => s.found_path)));
    }
  };

  const handleBackup = async () => {
    if (selectedPaths.size === 0) return;
    setIsBackingUp(true);
    setProgress({
      percent: 0,
      current_file: "Preparing backup archive...",
      processed_files: 0,
      total_files: 1,
      status: "starting",
    });
    setError(null);
    setBackupResult(null);

    try {
      const destination = await invoke<string>("backup_saves", {
        paths: Array.from(selectedPaths),
        backupDir: null,
      });
      setBackupResult(destination);
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "Backup failed.");
      setIsBackingUp(false);
    }
  };

  const availableSources = useMemo(() => {
    const set = new Set<string>();
    saves.forEach((s) => {
      if (s.source) set.add(s.source);
    });
    return Array.from(set);
  }, [saves]);

  const filteredSaves = useMemo(() => {
    return saves.filter((save) => {
      const matchesSearch =
        searchQuery.trim() === "" ||
        save.game_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        save.found_path.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (save.app_id && save.app_id.includes(searchQuery.trim()));

      const matchesSource =
        activeSourceFilter === "all" || save.source === activeSourceFilter;

      return matchesSearch && matchesSource;
    });
  }, [saves, searchQuery, activeSourceFilter]);

  const totalSelectedSize = saves
    .filter((s) => selectedPaths.has(s.found_path))
    .reduce((acc, curr) => acc + curr.size, 0);

  const getSourceBadgeColor = (source?: string) => {
    switch (source) {
      case "RUNE":
        return "bg-amber-500/20 text-amber-300 border-amber-500/30";
      case "CODEX":
        return "bg-purple-500/20 text-purple-300 border-purple-500/30";
      case "Goldberg":
        return "bg-cyan-500/20 text-cyan-300 border-cyan-500/30";
      case "CPY":
        return "bg-rose-500/20 text-rose-300 border-rose-500/30";
      case "Saved Games":
        return "bg-blue-500/20 text-blue-300 border-blue-500/30";
      case "My Games":
        return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
      default:
        return "bg-gray-500/20 text-gray-300 border-gray-500/30";
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-950">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0 bg-surface-900/50">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-gray-100 tracking-tight">Game Save Manager</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              MFT & Zip Engine
            </span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/5 text-gray-400 border border-white/10">
              {saves.length} Saves Detected
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Detects saves across Steam, CPY, RUNE, CODEX, Goldberg, and Windows game folders.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenBackupFolder}
            className="btn-secondary text-xs flex items-center gap-1.5 py-2 px-3 text-gray-200 hover:text-white"
            title="Open backup folder in Windows Explorer"
          >
            <FolderOpen size={13} className="text-accent-400" />
            <span>Open Backups</span>
          </button>

          <button
            onClick={handleDetectSaves}
            disabled={loading || isBackingUp}
            className="btn-secondary text-xs flex items-center gap-1.5 py-2 px-3 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span>{loading ? "Scanning..." : "Rescan"}</span>
          </button>

          <button
            onClick={handleBackup}
            disabled={isBackingUp || selectedPaths.size === 0}
            className="btn-primary text-xs flex items-center gap-1.5 py-2 px-4 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Archive size={13} />
            <span>{isBackingUp ? "Backing up..." : `Backup Selected (${selectedPaths.size})`}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain px-6 py-5 space-y-4">
        {error && (
          <div className="p-3.5 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300">
            {error}
          </div>
        )}

        {backupResult && (
          <div className="p-4 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-xs text-emerald-200 flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="font-semibold text-emerald-400 flex items-center gap-1.5">
                <Check size={14} /> Backup Completed Successfully!
              </span>
              <span className="font-mono text-[11px] text-gray-300 truncate" title={backupResult}>
                {backupResult}
              </span>
            </div>
            <button
              onClick={handleOpenBackupFolder}
              className="btn-secondary text-xs flex items-center gap-1 py-1.5 px-3 whitespace-nowrap"
            >
              <FolderOpen size={12} />
              <span>View in Explorer</span>
            </button>
          </div>
        )}

        {progress && (
          <div className="p-4 rounded-xl bg-surface-900 border border-accent-500/30 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white">
                {progress.status === "done" ? "Archive Created" : "Archiving Files into .zip..."}
              </span>
              <span className="font-mono font-bold text-accent-400">{progress.percent.toFixed(0)}%</span>
            </div>

            <div className="w-full h-2.5 bg-surface-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-accent-600 via-indigo-500 to-accent-400 transition-all duration-200 ease-out"
                style={{ width: `${Math.max(progress.percent, 3)}%` }}
              />
            </div>

            <div className="flex justify-between items-center text-[11px] text-gray-400 font-mono">
              <span className="truncate max-w-md">{progress.current_file}</span>
              <span>
                {progress.processed_files} / {progress.total_files} files
              </span>
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="Search saves by game, source, or Steam App ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface-900/80 border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            <button
              onClick={() => setActiveSourceFilter("all")}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                activeSourceFilter === "all"
                  ? "bg-accent-600 text-white"
                  : "bg-surface-900 text-gray-400 hover:text-white border border-white/5"
              }`}
            >
              All ({saves.length})
            </button>
            {availableSources.map((source) => (
              <button
                key={source}
                onClick={() => setActiveSourceFilter(source)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  activeSourceFilter === source
                    ? "bg-accent-600 text-white"
                    : "bg-surface-900 text-gray-400 hover:text-white border border-white/5"
                }`}
              >
                {source} ({saves.filter((s) => s.source === source).length})
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-1 text-xs text-gray-400">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={filteredSaves.length > 0 && filteredSaves.every((s) => selectedPaths.has(s.found_path))}
              onChange={toggleSelectAll}
              disabled={filteredSaves.length === 0 || isBackingUp}
              className="rounded border-white/20 bg-surface-800 text-accent-500 focus:ring-0"
            />
            <span>
              Select All Shown ({filteredSaves.length})
            </span>
          </label>

          <span>
            Selected Size: <strong className="text-gray-200">{formatBytes(totalSelectedSize)}</strong>
          </span>
        </div>

        <div className="divide-y divide-white/5 border border-white/10 rounded-xl overflow-hidden bg-surface-900/50 shadow-sm">
          {filteredSaves.length === 0 ? (
            <div className="p-12 text-center text-xs text-gray-500">
              {loading
                ? "Detecting game saves across CPY, RUNE, CODEX, Goldberg, and Windows folders..."
                : saves.length === 0
                ? "No game save folders detected."
                : "No game saves match your search filter."}
            </div>
          ) : (
            filteredSaves.map((save) => {
              const isSelected = selectedPaths.has(save.found_path);
              return (
                <div
                  key={save.found_path}
                  onClick={() => !isBackingUp && toggleSelect(save.found_path)}
                  className={`p-3.5 flex items-center justify-between gap-4 cursor-pointer hover:bg-white/5 transition-colors ${
                    isSelected ? "bg-accent-950/20" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      disabled={isBackingUp}
                      className="rounded border-white/20 bg-surface-800 text-accent-500 focus:ring-0 pointer-events-none"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-white truncate">
                          {save.game_name}
                        </span>
                        {save.source && (
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${getSourceBadgeColor(
                              save.source
                            )}`}
                          >
                            {save.source}
                          </span>
                        )}
                        {save.app_id && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-gray-400 bg-white/5 border border-white/10">
                            #{save.app_id}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-gray-400 truncate mt-0.5" title={save.found_path}>
                        {save.found_path}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs font-mono font-medium text-gray-300">
                      {formatBytes(save.size)}
                    </span>
                    <button
                      onClick={(e) => handleOpenSaveFolder(save.found_path, e)}
                      className="p-1.5 rounded-lg bg-surface-800 hover:bg-surface-700 text-gray-300 hover:text-white border border-white/10 transition-colors"
                      title="Open save folder directly in Windows Explorer"
                    >
                      <FolderOpen size={13} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default SaveManager;
