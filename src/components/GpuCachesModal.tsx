import { useState } from "react";
import {
  X,
  Cpu,
  FolderOpen,
  Trash2,
  Check,
  Copy,
} from "lucide-react";
import { CacheEntry } from "../types";
import { formatBytes, formatRelativeDate, SourceBadge } from "./ui";
import { openGameFolder, softDeleteCache } from "../hooks/useScanner";

interface Props {
  caches: CacheEntry[];
  totalBytes: number;
  onClose: () => void;
  onRefresh: () => void;
}

export function GpuCachesModal({
  caches,
  totalBytes,
  onClose,
  onRefresh,
}: Props) {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [cleaningPath, setCleaningPath] = useState<string | null>(null);

  async function handleOpenFolder(path: string) {
    try {
      await openGameFolder(path);
    } catch (err) {
      console.error("Failed to open folder:", err);
      alert(`Could not open folder: ${err}`);
    }
  }

  async function handleCopy(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedPath(path);
      setTimeout(() => setCopiedPath(null), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }

  async function handleCleanCache(entry: CacheEntry) {
    if (
      !confirm(
        `Move this shader cache to Trash?\n\nLocation: ${entry.path}\nSize: ${formatBytes(
          entry.size_bytes
        )}\n\nYour GPU driver will recompile any required shaders the next time you launch your games.`
      )
    ) {
      return;
    }

    setCleaningPath(entry.path);
    try {
      await softDeleteCache(entry.path, undefined, "GPU Driver Cache");
      onRefresh();
    } catch (err: any) {
      console.error("Clean cache error:", err);
      const msg = err?.message || (typeof err === "string" ? err : JSON.stringify(err));
      alert(`Could not clean cache: ${msg}`);
    } finally {
      setCleaningPath(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-surface-950/60 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent-600/20 border border-accent-500/30 text-accent-300">
              <Cpu size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">GPU Driver Shader Caches</h2>
                <span className="badge bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 font-mono text-xs">
                  {formatBytes(totalBytes)}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {caches.length} system cache location{caches.length === 1 ? "" : "s"} found on your PC
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain p-6 space-y-3">
          {caches.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">
              No GPU driver caches detected on this system.
            </div>
          ) : (
            caches.map((entry) => {
              const isCleaning = cleaningPath === entry.path;
              const isCopied = copiedPath === entry.path;

              return (
                <div
                  key={entry.path}
                  className="glass-card p-4 space-y-3 hover:border-white/15 transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <SourceBadge source={entry.source} />
                        <span className="text-sm font-bold text-gray-200 truncate">
                          {entry.source === "nvidia_dx"
                            ? "NVIDIA DirectX Shader Cache (DXCache)"
                            : entry.source === "nvidia_gl"
                            ? "NVIDIA OpenGL / Vulkan Shader Cache (GLCache)"
                            : entry.source === "amd_dx"
                            ? "AMD DirectX Shader Cache"
                            : entry.source === "amd_dxc"
                            ? "AMD DXC Shader Cache"
                            : entry.source === "intel_shader"
                            ? "Intel GPU Shader Cache"
                            : "DirectX Shader Cache"}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-500">
                        Modified {formatRelativeDate(entry.last_modified)}
                      </p>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-bold font-mono text-emerald-400">
                        {formatBytes(entry.size_bytes)}
                      </p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">
                        Disk Usage
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 p-2 rounded-xl bg-surface-950/80 border border-white/5 font-mono text-xs text-gray-300">
                    <span className="truncate flex-1 select-all" title={entry.path}>
                      {entry.path}
                    </span>
                    <button
                      onClick={() => handleCopy(entry.path)}
                      className="p-1 rounded text-gray-400 hover:text-white transition-colors"
                      title="Copy path"
                    >
                      {isCopied ? (
                        <Check size={13} className="text-emerald-400" />
                      ) : (
                        <Copy size={13} />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-white/5">
                    <button
                      onClick={() => handleOpenFolder(entry.path)}
                      className="btn-ghost text-xs py-1.5 px-3"
                    >
                      <FolderOpen size={13} />
                      Open in Explorer
                    </button>
                    <button
                      onClick={() => handleCleanCache(entry)}
                      disabled={isCleaning}
                      className="btn-danger text-xs py-1.5 px-3"
                    >
                      <Trash2 size={13} />
                      {isCleaning ? "Moving to Trash…" : "Move to Trash"}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-white/10 bg-surface-950/80 flex items-center justify-between flex-shrink-0">
          <p className="text-[11px] text-gray-500">
            Soft-deleted caches can be restored from the <span className="text-gray-300">Trash</span> tab anytime.
          </p>
          <button onClick={onClose} className="btn-accent text-xs py-1.5 px-4">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
