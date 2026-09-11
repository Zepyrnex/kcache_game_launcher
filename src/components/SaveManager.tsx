import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface GameSave {
  game_name: string;
  found_path: string;
  size: number;
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
    if (selectedPaths.size === saves.length) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(saves.map((s) => s.found_path)));
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

  const totalSelectedSize = saves
    .filter((s) => selectedPaths.has(s.found_path))
    .reduce((acc, curr) => acc + curr.size, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-950">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0 bg-surface-900/50">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-gray-100 tracking-tight">Game Save Manager</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              MFT & Zip Engine
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Detect local PC game saves via Ludusavi manifest and archive them to a timestamped .zip file.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDetectSaves}
            disabled={loading || isBackingUp}
            className="btn-secondary text-xs flex items-center gap-1.5 py-2 px-3 disabled:opacity-50"
          >
            {loading ? "Scanning..." : "Rescan Saves"}
          </button>

          <button
            onClick={handleBackup}
            disabled={isBackingUp || selectedPaths.size === 0}
            className="btn-primary text-xs py-2 px-4 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBackingUp ? "Backing up..." : `Backup Selected (${selectedPaths.size})`}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain px-6 py-5 space-y-5">
        {error && (
          <div className="p-3.5 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300">
            {error}
          </div>
        )}

        {backupResult && (
          <div className="p-4 bg-emerald-950/40 border border-emerald-500/40 rounded-xl text-xs text-emerald-200 flex flex-col gap-1">
            <span className="font-semibold text-emerald-400">✓ Backup Completed Successfully!</span>
            <span className="font-mono text-[11px] text-gray-300 break-all">{backupResult}</span>
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

        <div className="flex items-center justify-between px-2 text-xs text-gray-400">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={saves.length > 0 && selectedPaths.size === saves.length}
              onChange={toggleSelectAll}
              disabled={saves.length === 0 || isBackingUp}
              className="rounded border-white/20 bg-surface-800 text-accent-500 focus:ring-0"
            />
            <span>Select All ({saves.length})</span>
          </label>

          <span>Selected Size: <strong className="text-gray-200">{formatBytes(totalSelectedSize)}</strong></span>
        </div>

        <div className="divide-y divide-white/5 border border-white/10 rounded-xl overflow-hidden bg-surface-900/50">
          {saves.length === 0 ? (
            <div className="p-12 text-center text-xs text-gray-500">
              {loading ? "Detecting game saves..." : "No game save folders found from the manifest."}
            </div>
          ) : (
            saves.map((save) => {
              const isSelected = selectedPaths.has(save.found_path);
              return (
                <div
                  key={save.found_path}
                  onClick={() => !isBackingUp && toggleSelect(save.found_path)}
                  className={`p-3.5 flex items-center justify-between gap-4 cursor-pointer hover:bg-white/5 transition-colors ${
                    isSelected ? "bg-accent-950/20" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      disabled={isBackingUp}
                      className="rounded border-white/20 bg-surface-800 text-accent-500 focus:ring-0 pointer-events-none"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{save.game_name}</p>
                      <p className="text-[11px] font-mono text-gray-400 truncate" title={save.found_path}>
                        {save.found_path}
                      </p>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <span className="text-xs font-mono font-medium text-gray-300">
                      {formatBytes(save.size)}
                    </span>
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
