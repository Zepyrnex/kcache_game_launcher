import { useState, useEffect, useMemo } from "react";
import {
  FolderArchive,
  Zap,
  RotateCcw,
  FolderOpen,
  RefreshCw,
  Search,
  CheckCircle2,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import clsx from "clsx";
import {
  useScanner,
  useCompressor,
  compressShaderCache,
  decompressShaderCache,
  getVaultEntries,
  deleteVaultEntry,
  openVaultFolder,
} from "../hooks/useScanner";
import { formatBytes, formatRelativeDate } from "../components/ui";
import type { CacheEntry, CompressedVaultEntry, CompressionAlgorithm } from "../types";

export function CompressorPage() {
  const { result: scanResult, startScan } = useScanner();
  const { activeProgress, processingIds } = useCompressor();
  const [vaultEntries, setVaultEntries] = useState<CompressedVaultEntry[]>([]);
  const [selectedAlgorithm, setSelectedAlgorithm] = useState<CompressionAlgorithm>("zstd");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "compressed" | "raw">("all");

  async function loadVault() {
    try {
      const entries = await getVaultEntries();
      setVaultEntries(entries);
    } catch (e) {
      console.error("Failed to load vault entries:", e);
    }
  }

  useEffect(() => {
    loadVault();
  }, []);

  const allCaches: CacheEntry[] = useMemo(() => {
    if (!scanResult) return [];
    const set = new Map<string, CacheEntry>();
    for (const c of scanResult.caches) {
      set.set(c.id, c);
    }
    for (const group of scanResult.grouped) {
      for (const c of group.caches) {
        set.set(c.id, c);
      }
    }
    return Array.from(set.values());
  }, [scanResult]);

  const vaultByPath = useMemo(() => {
    const map = new Map<string, CompressedVaultEntry>();
    for (const v of vaultEntries) {
      map.set(v.original_path.toLowerCase().replace(/\//g, "\\"), v);
    }
    return map;
  }, [vaultEntries]);

  const summary = useMemo(() => {
    let totalRawBytes = 0;
    let totalCompressedBytes = 0;
    let totalItems = vaultEntries.length;

    for (const v of vaultEntries) {
      totalRawBytes += v.original_size;
      totalCompressedBytes += v.compressed_size;
    }

    const bytesSaved = totalRawBytes > totalCompressedBytes ? totalRawBytes - totalCompressedBytes : 0;
    const percentSaved = totalRawBytes > 0 ? (bytesSaved / totalRawBytes) * 100 : 0;

    return {
      totalRawBytes,
      totalCompressedBytes,
      bytesSaved,
      percentSaved,
      totalItems,
    };
  }, [vaultEntries]);

  const filteredCaches = useMemo(() => {
    return allCaches.filter((cache) => {
      const normalizedPath = cache.path.toLowerCase().replace(/\//g, "\\");
      const vaultItem = vaultByPath.get(normalizedPath);
      const isCompressed = vaultItem && vaultItem.status === "compressed";

      if (filterStatus === "compressed" && !isCompressed) return false;
      if (filterStatus === "raw" && isCompressed) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const game = cache.associated_game_guess?.toLowerCase() || "";
        const source = cache.source.toLowerCase();
        const path = cache.path.toLowerCase();
        if (!game.includes(q) && !source.includes(q) && !path.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [allCaches, vaultByPath, filterStatus, searchQuery]);

  async function handleCompress(cache: CacheEntry) {
    try {
      const gameName = cache.associated_game_guess || cache.source.replace(/_/g, " ");
      await compressShaderCache({
        sourcePath: cache.path,
        gameId: cache.associated_game_id,
        gameName,
        cacheId: cache.id,
        algorithm: selectedAlgorithm,
      });
      await loadVault();
    } catch (err: any) {
      const msg = typeof err === "object" && err?.message ? err.message : String(err);
      alert("Compression issue: " + msg);
    }
  }

  async function handleDecompress(vaultEntry: CompressedVaultEntry) {
    try {
      await decompressShaderCache(vaultEntry.id, vaultEntry.cache_id);
      await loadVault();
    } catch (err: any) {
      const msg = typeof err === "object" && err?.message ? err.message : String(err);
      alert("Decompression issue: " + msg);
    }
  }

  async function handleDeleteVault(vaultEntry: CompressedVaultEntry) {
    if (!confirm(`Delete compressed vault backup for "${vaultEntry.game_name}"?`)) return;
    try {
      await deleteVaultEntry(vaultEntry.id);
      await loadVault();
    } catch (err: any) {
      const msg = typeof err === "object" && err?.message ? err.message : String(err);
      alert("Delete failed: " + msg);
    }
  }

  async function handleCompressAll() {
    const rawToCompress = allCaches.filter((c) => {
      const norm = c.path.toLowerCase().replace(/\//g, "\\");
      const v = vaultByPath.get(norm);
      return !v || v.status !== "compressed";
    });

    if (rawToCompress.length === 0) {
      alert("All scanned shaders are already compressed in the vault!");
      return;
    }

    if (!confirm(`Compress ${rawToCompress.length} shader caches using ${selectedAlgorithm.toUpperCase()}?`)) return;

    for (const c of rawToCompress) {
      try {
        const gameName = c.associated_game_guess || c.source.replace(/_/g, " ");
        await compressShaderCache({
          sourcePath: c.path,
          gameId: c.associated_game_id,
          gameName,
          cacheId: c.id,
          algorithm: selectedAlgorithm,
        });
      } catch (err) {
        console.error("Batch compress error for:", c.path, err);
      }
    }
    await loadVault();
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-950">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0 bg-surface-900/50">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-gray-100 tracking-tight">Shader Compressor & Vault</h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-accent-500/20 text-accent-300 border border-accent-500/30">
              Zstd & LZ4 Engine
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            Shrink GPU shader caches by 75-90% or prepare ultra-fast &gt;500 MB/s decompression before launch.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => openVaultFolder()}
            className="btn-secondary text-xs flex items-center gap-2 py-2 px-3"
            title="Open the app's compressed vault folder in Windows Explorer"
          >
            <FolderOpen size={14} className="text-accent-400" />
            <span>Open Vault Folder</span>
          </button>

          <button
            onClick={() => {
              startScan();
              loadVault();
            }}
            className="btn-ghost text-xs flex items-center gap-2 py-2 px-3"
            title="Rescan GPU caches & reload vault"
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain px-6 py-5 space-y-6">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            onClick={() => setSelectedAlgorithm("zstd")}
            className={clsx(
              "p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden",
              selectedAlgorithm === "zstd"
                ? "bg-accent-950/40 border-accent-500/50 ring-1 ring-accent-500/30 shadow-glow-sm"
                : "bg-surface-900/60 border-white/5 hover:border-white/10 opacity-75 hover:opacity-100"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-accent-600/20 text-accent-400 border border-accent-600/30">
                  <FolderArchive size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    Zstandard (Zstd)
                    <span className="text-[10px] px-2 py-0.2 rounded bg-accent-500/20 text-accent-300 font-medium">
                      Maximum Space Saving
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">Dictionary-optimized shader code reduction</p>
                </div>
              </div>
              <div
                className={clsx(
                  "w-4 h-4 rounded-full border flex items-center justify-center transition-colors",
                  selectedAlgorithm === "zstd"
                    ? "border-accent-400 bg-accent-500 text-white"
                    : "border-gray-600"
                )}
              >
                {selectedAlgorithm === "zstd" && <CheckCircle2 size={12} />}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] pt-3 border-t border-white/5">
              <div>
                <span className="text-gray-500">Compression Ratio:</span>
                <p className="font-semibold text-emerald-400">75% to 90% footprint reduction</p>
              </div>
              <div>
                <span className="text-gray-500">Feature:</span>
                <p className="font-semibold text-gray-300">Dictionary code pattern training</p>
              </div>
            </div>
          </div>

          <div
            onClick={() => setSelectedAlgorithm("lz4")}
            className={clsx(
              "p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden",
              selectedAlgorithm === "lz4"
                ? "bg-emerald-950/40 border-emerald-500/50 ring-1 ring-emerald-500/30 shadow-glow-sm"
                : "bg-surface-900/60 border-white/5 hover:border-white/10 opacity-75 hover:opacity-100"
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-600/30">
                  <Zap size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    LZ4
                    <span className="text-[10px] px-2 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-medium">
                      Raw Decompression Speed
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">Ultra-low CPU overhead on game startup</p>
                </div>
              </div>
              <div
                className={clsx(
                  "w-4 h-4 rounded-full border flex items-center justify-center transition-colors",
                  selectedAlgorithm === "lz4"
                    ? "border-emerald-400 bg-emerald-500 text-white"
                    : "border-gray-600"
                )}
              >
                {selectedAlgorithm === "lz4" && <CheckCircle2 size={12} />}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] pt-3 border-t border-white/5">
              <div>
                <span className="text-gray-500">Decompression Speed:</span>
                <p className="font-semibold text-emerald-400">&gt;500 MB/s per core</p>
              </div>
              <div>
                <span className="text-gray-500">Best For:</span>
                <p className="font-semibold text-gray-300">Zero startup delay / Competitive</p>
              </div>
            </div>
          </div>
        </div>

        {activeProgress && (
          <div className="p-4 rounded-xl bg-surface-900/90 border border-accent-500/40 shadow-glow-sm relative overflow-hidden transition-all">
            <div className="flex items-center justify-between gap-4 mb-2.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={clsx(
                    "p-2 rounded-lg border flex-shrink-0",
                    activeProgress.stage === "done"
                      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                      : "bg-accent-500/20 text-accent-400 border-accent-500/30"
                  )}
                >
                  {activeProgress.stage === "done" ? (
                    <CheckCircle2 size={18} className="text-emerald-400" />
                  ) : (
                    <RefreshCw size={18} className="animate-spin text-accent-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">
                      {activeProgress.stage === "done"
                        ? "Operation Complete"
                        : activeProgress.stage === "decompressing"
                        ? `Decompressing ${activeProgress.game_name}...`
                        : `Compressing ${activeProgress.game_name}...`}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent-500/20 text-accent-300 border border-accent-500/30 uppercase tracking-wider">
                      {activeProgress.stage}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate max-w-xl mt-0.5 font-mono">
                    {activeProgress.current_file}
                  </p>
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <span className="text-lg font-bold font-mono text-white">
                  {activeProgress.percent.toFixed(0)}%
                </span>
                <div className="text-[11px] text-gray-400">
                  {activeProgress.total_bytes > 0
                    ? `${formatBytes(activeProgress.processed_bytes)} / ${formatBytes(activeProgress.total_bytes)}`
                    : `${activeProgress.processed_files} files`}
                </div>
              </div>
            </div>

            <div className="w-full h-2.5 bg-surface-800 rounded-full overflow-hidden border border-white/5 relative">
              <div
                className={clsx(
                  "h-full rounded-full transition-all duration-200 ease-out",
                  activeProgress.stage === "done"
                    ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
                    : "bg-gradient-to-r from-accent-600 via-indigo-500 to-accent-400"
                )}
                style={{ width: `${Math.max(activeProgress.percent, 2)}%` }}
              />
            </div>

            {activeProgress.total_files > 1 && (
              <div className="flex justify-between items-center text-[11px] text-gray-500 mt-2 font-mono">
                <span>Files: {activeProgress.processed_files.toLocaleString()} / {activeProgress.total_files.toLocaleString()}</span>
                <span>{selectedAlgorithm.toUpperCase()} Stream</span>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-surface-900/80 border border-white/5">
            <span className="text-[11px] font-medium text-gray-400">Total Scanned Caches</span>
            <p className="text-lg font-bold text-white mt-1">{allCaches.length}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-900/80 border border-white/5">
            <span className="text-[11px] font-medium text-gray-400">Vault Compressed Size</span>
            <p className="text-lg font-bold text-accent-400 mt-1">
              {formatBytes(summary.totalCompressedBytes)}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-900/80 border border-white/5">
            <span className="text-[11px] font-medium text-gray-400">Original Uncompressed</span>
            <p className="text-lg font-bold text-gray-300 mt-1">
              {formatBytes(summary.totalRawBytes)}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-surface-900/80 border border-white/5">
            <span className="text-[11px] font-medium text-gray-400">Disk Space Saved</span>
            <div className="flex items-baseline gap-2 mt-1">
              <p className="text-lg font-bold text-emerald-400">{formatBytes(summary.bytesSaved)}</p>
              {summary.percentSaved > 0 && (
                <span className="text-xs font-semibold text-emerald-500">
                  (-{summary.percentSaved.toFixed(1)}%)
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-surface-900/40 border border-white/5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5 text-gray-300">
            <ShieldCheck size={16} className="text-emerald-400 flex-shrink-0" />
            <span>
              <strong>Pre-Launch Decompression Flow:</strong> When you launch a game via Kcache, any compressed shaders are automatically restored back to the GPU driver folder before the game starts.
            </span>
          </div>
          <button
            onClick={handleCompressAll}
            disabled={processingIds.size > 0}
            className={clsx(
              "btn-primary text-xs py-1.5 px-3 whitespace-nowrap ml-4",
              processingIds.size > 0 && "opacity-60 cursor-not-allowed"
            )}
          >
            Compress All with {selectedAlgorithm.toUpperCase()}
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search shader files, games, or driver folders..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface-800/80 hover:bg-surface-800 focus:bg-surface-800 border border-white/10 focus:border-accent-500 rounded-lg pl-9 pr-3 py-2 text-xs text-gray-200 placeholder-gray-500 outline-none transition-all shadow-inner"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-surface-900/60 p-1 rounded-lg border border-white/5">
              <button
                onClick={() => setFilterStatus("all")}
                className={clsx(
                  "px-3 py-1 rounded text-xs font-medium transition-colors",
                  filterStatus === "all" ? "bg-accent-600 text-white" : "text-gray-400 hover:text-white"
                )}
              >
                All ({allCaches.length})
              </button>
              <button
                onClick={() => setFilterStatus("compressed")}
                className={clsx(
                  "px-3 py-1 rounded text-xs font-medium transition-colors",
                  filterStatus === "compressed" ? "bg-accent-600 text-white" : "text-gray-400 hover:text-white"
                )}
              >
                In Vault ({summary.totalItems})
              </button>
              <button
                onClick={() => setFilterStatus("raw")}
                className={clsx(
                  "px-3 py-1 rounded text-xs font-medium transition-colors",
                  filterStatus === "raw" ? "bg-accent-600 text-white" : "text-gray-400 hover:text-white"
                )}
              >
                Raw / Uncompressed
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {filteredCaches.length === 0 ? (
              <div className="p-12 text-center text-gray-500 text-xs bg-surface-900/20 rounded-xl border border-white/5">
                No shader caches match the current filter or search query.
              </div>
            ) : (
              filteredCaches.map((cache) => {
                const normalizedPath = cache.path.toLowerCase().replace(/\//g, "\\");
                const vaultItem = vaultByPath.get(normalizedPath);
                const isCompressed = vaultItem && vaultItem.status === "compressed";
                const isProcessing = processingIds.has(cache.id) || (vaultItem && processingIds.has(vaultItem.id));

                return (
                  <div
                    key={cache.id}
                    className="p-4 rounded-xl bg-surface-900/50 border border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:border-white/10 transition-colors"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate">
                          {cache.associated_game_guess || cache.source.replace(/_/g, " ").toUpperCase()}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-white/5 text-gray-400 border border-white/5">
                          {cache.source}
                        </span>
                        {isCompressed ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            Vaulted ({vaultItem.algorithm.toUpperCase()})
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/15 text-amber-300 border border-amber-500/20">
                            Raw on Disk
                          </span>
                        )}
                      </div>

                      <p className="text-xs font-mono text-gray-500 truncate" title={cache.path}>
                        {cache.path}
                      </p>

                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>Original: <strong className="text-gray-200">{formatBytes(cache.size_bytes)}</strong></span>
                        {isCompressed && vaultItem && (
                          <>
                            <span className="text-gray-600">→</span>
                            <span>Compressed: <strong className="text-accent-300">{formatBytes(vaultItem.compressed_size)}</strong></span>
                            <span className="text-emerald-400 font-semibold">(-{vaultItem.ratio.toFixed(1)}%)</span>
                          </>
                        )}
                        <span className="text-gray-600">•</span>
                        <span>Modified: {formatRelativeDate(cache.last_modified)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0 self-end md:self-center">
                      {isCompressed && vaultItem ? (
                        <>
                          <button
                            onClick={() => handleDecompress(vaultItem)}
                            disabled={isProcessing}
                            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3"
                            title="Extract raw shaders directly into the GPU driver folder"
                          >
                            <RotateCcw size={12} className={clsx(isProcessing && "animate-spin")} />
                            <span>{isProcessing ? "Decompressing..." : "Decompress"}</span>
                          </button>
                          <button
                            onClick={() => handleDeleteVault(vaultItem)}
                            disabled={isProcessing}
                            className="btn-ghost text-xs p-2 text-red-400 hover:text-red-300"
                            title="Delete compressed copy from vault"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleCompress(cache)}
                          disabled={isProcessing}
                          className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3"
                          title={`Compress using ${selectedAlgorithm.toUpperCase()}`}
                        >
                          <FolderArchive size={12} className={clsx(isProcessing && "animate-spin")} />
                          <span>{isProcessing ? "Compressing..." : `Compress (${selectedAlgorithm.toUpperCase()})`}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
