import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  RefreshCw,
  Database,
  Cpu,
  Gamepad2,
  ArrowUpDown,
  Filter,
  LayoutGrid,
  Layers,
  List,
  FolderSearch,
  FolderOpen,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  GameCacheGroup,
  SortField,
  SortDir,
  FilterPlatform,
  FilterHasCache,
  LauncherLayoutMode,
  DetectedGame,
} from "../types";
import { useScanner, deleteGame } from "../hooks/useScanner";
import { ScanProgressBar } from "../components/ScanProgressBar";
import { formatBytes, formatRelativeDate, PlatformBadge, SourceBadge } from "../components/ui";
import { GameGridView } from "../components/GameGridView";
import { GameDetailsView } from "../components/GameDetailsView";
import { CacheActionButtons } from "../components/CacheActions";
import { LibraryScannerDialog } from "../components/LibraryScannerDialog";
import { MetadataEditorModal } from "../components/MetadataEditorModal";
import { GpuCachesModal } from "../components/GpuCachesModal";

function SummaryPanel({
  totalBytes,
  gpuBytes,
  gameBytes,
  gameCount,
}: {
  totalBytes: number;
  gpuBytes: number;
  gameBytes: number;
  gameCount: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-4 mb-4 flex-shrink-0">

      <div className="glass-card p-4 col-span-1">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Total Shader Cache</p>
        <p className="text-2xl font-bold bg-gradient-accent bg-clip-text text-transparent">
          {formatBytes(totalBytes)}
        </p>
        <p className="text-[11px] text-gray-500 mt-1">{gameCount} games with caches</p>
      </div>

      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-1">
          <Cpu size={14} className="text-green-400" />
          <p className="text-xs text-gray-500 uppercase tracking-wider">GPU Driver</p>
        </div>
        <p className="text-xl font-bold text-green-400">{formatBytes(gpuBytes)}</p>
        <p className="text-[11px] text-gray-500 mt-1">NVIDIA / AMD / Intel</p>
      </div>

      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-1">
          <Gamepad2 size={14} className="text-accent-400" />
          <p className="text-xs text-gray-500 uppercase tracking-wider">Game-Level</p>
        </div>
        <p className="text-xl font-bold text-accent-400">{formatBytes(gameBytes)}</p>
        <p className="text-[11px] text-gray-500 mt-1">Steam / DXVK / VKD3D</p>
      </div>
    </div>
  );
}

function GameRow({
  group,
  onAction,
  onEditMetadata,
}: {
  group: GameCacheGroup;
  onAction: () => void;
  onEditMetadata: (game: DetectedGame) => void;
}) {
  const { game, caches, total_cache_size } = group;
  const hasCache = caches.length > 0;
  const cover = game.cover_url || game.icon_url;

  return (
    <div className="flex items-center gap-4 p-3.5 border-b border-white/5 hover:bg-white/5 transition-colors group animate-fade-in">

      <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-surface-800 border border-white/5 relative">
        {cover ? (
          <img
            src={cover}
            alt={game.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Gamepad2 size={18} className="text-gray-600" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-100 truncate">{game.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <PlatformBadge platform={game.platform} />
          {game.app_id && (
            <span className="text-xs text-gray-600 font-mono">#{game.app_id}</span>
          )}
        </div>
      </div>

      <div className="flex gap-1 flex-wrap w-32">
        {hasCache ? (
          caches.slice(0, 3).map((c) => (
            <SourceBadge key={c.id} source={c.source} />
          ))
        ) : (
          <span className="text-xs text-gray-600 italic">None</span>
        )}
        {caches.length > 3 && (
          <span className="badge bg-surface-600 text-gray-400 border border-white/5">
            +{caches.length - 3}
          </span>
        )}
      </div>

      <div className="w-24 text-right">
        {hasCache ? (
          <span className="text-sm font-mono font-semibold text-gray-200">
            {formatBytes(total_cache_size)}
          </span>
        ) : (
          <span className="text-xs text-gray-600">—</span>
        )}
      </div>

      <div className="w-24 text-right">
        <span className="text-xs text-gray-500">
          {hasCache
            ? formatRelativeDate(Math.max(...caches.map((c) => c.last_modified)))
            : "—"}
        </span>
      </div>

      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity w-48 justify-end">
        <button
          onClick={() => onEditMetadata(game)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-accent-300 hover:bg-white/5 transition-colors"
          title="Match Steam Art"
        >
          <Sparkles size={14} />
        </button>
        {hasCache && (
          <CacheActionButtons group={group} onDeleted={onAction} />
        )}
        <button
          onClick={async () => {
            if (
              confirm(
                `Remove "${game.name}" from Kcache?\n\nThis will hide the game from your library. It will not delete or uninstall the game files from your computer.`
              )
            ) {
              try {
                await deleteGame(game.id);
                onAction();
              } catch (err) {
                console.error("Failed to remove game:", err);
                alert(`Could not remove game: ${err}`);
              }
            }
          }}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Remove Game from Kcache"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function EmptyState({ onScan, onOpenFolders }: { onScan: () => void; onOpenFolders: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 space-y-4 animate-fade-in">
      <div className="p-5 rounded-2xl bg-surface-800 border border-white/5">
        <Database size={40} className="text-gray-600" />
      </div>
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-300">No scan data yet</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-sm">
          Run a scan or scan custom folders with MFT to discover installed games and shader caches.
        </p>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button className="btn-accent" onClick={onScan}>
          <RefreshCw size={16} />
          Scan Libraries
        </button>
        <button className="btn-ghost" onClick={onOpenFolders}>
          <FolderSearch size={16} />
          Scan Folders (MFT)
        </button>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { status, progress, result, error, startScan } = useScanner();
  const [layoutMode, setLayoutMode] = useState<LauncherLayoutMode>(() => {
    return (localStorage.getItem("kcache_layout") as LauncherLayoutMode) ||
      (localStorage.getItem("shadervault_layout") as LauncherLayoutMode) || "grid";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("size");
  const [sortDir, setSortDir]     = useState<SortDir>("desc");
  const [filterPlatform, setFilterPlatform] = useState<FilterPlatform>("all");
  const [filterHasCache, setFilterHasCache] = useState<FilterHasCache>("all");
  const [searchParams, setSearchParams] = useSearchParams();

  const [showScannerDialog, setShowScannerDialog] = useState(false);
  const [showGpuCachesModal, setShowGpuCachesModal] = useState(false);
  const [editingMetadataGame, setEditingMetadataGame] = useState<DetectedGame | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get("inspect") === "gpu_caches") {
      setShowGpuCachesModal(true);
    }

    const p = searchParams.get("platform");
    if (p && ["all", "steam", "epic", "gog", "custom"].includes(p)) {
      setFilterPlatform(p as FilterPlatform);
    } else if (!p) {
      setFilterPlatform("all");
    }

    const c = searchParams.get("cache");
    if (c && ["all", "has_cache", "no_cache"].includes(c)) {
      setFilterHasCache(c as FilterHasCache);
    } else if (!c) {
      setFilterHasCache("all");
    }
  }, [searchParams]);

  function handlePlatformChange(p: FilterPlatform) {
    setFilterPlatform(p);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p === "all") next.delete("platform");
      else next.set("platform", p);
      return next;
    });
  }

  function handleCacheChange(c: FilterHasCache) {
    setFilterHasCache(c);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (c === "all") next.delete("cache");
      else next.set("cache", c);
      return next;
    });
  }

  useEffect(() => {
    if (!result && status === "idle") {
      startScan();
    }
  }, []);

  function handleSetLayout(mode: LauncherLayoutMode) {
    setLayoutMode(mode);
    localStorage.setItem("kcache_layout", mode);
  }

  const displayGroups = useMemo<GameCacheGroup[]>(() => {
    if (!result) return [];

    const seen = new Set<string>();
    const uniqueGroups: GameCacheGroup[] = [];
    for (const g of result.grouped) {
      const idKey = g.game.id.toLowerCase();
      const appKey = g.game.app_id ? `${g.game.platform}:${g.game.app_id}`.toLowerCase() : "";
      if (seen.has(idKey) || (appKey && seen.has(appKey))) {
        continue;
      }
      seen.add(idKey);
      if (appKey) seen.add(appKey);
      uniqueGroups.push(g);
    }

    let groups = uniqueGroups;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      groups = groups.filter(
        (g) =>
          g.game.name.toLowerCase().includes(q) ||
          g.game.platform.toLowerCase().includes(q) ||
          (g.game.app_id && g.game.app_id.includes(q))
      );
    }

    if (filterPlatform !== "all") {
      groups = groups.filter((g) => g.game.platform === filterPlatform);
    }

    if (filterHasCache === "has_cache") {
      groups = groups.filter((g) => g.caches.length > 0);
    } else if (filterHasCache === "no_cache") {
      groups = groups.filter((g) => g.caches.length === 0);
    }

    groups.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "size":          cmp = a.total_cache_size - b.total_cache_size; break;
        case "name":          cmp = a.game.name.localeCompare(b.game.name); break;
        case "platform":      cmp = a.game.platform.localeCompare(b.game.platform); break;
        case "last_modified": {
          const aMax = a.caches.length ? Math.max(...a.caches.map((c) => c.last_modified)) : 0;
          const bMax = b.caches.length ? Math.max(...b.caches.map((c) => c.last_modified)) : 0;
          cmp = aMax - bMax;
          break;
        }
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    return groups;
  }, [result, searchQuery, sortField, sortDir, filterPlatform, filterHasCache]);

  const uniqueGamesCount = useMemo(() => {
    if (!result) return 0;
    const seen = new Set<string>();
    for (const g of result.grouped) {
      seen.add(g.game.id.toLowerCase());
    }
    return seen.size;
  }, [result]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const isBusy = status === "scanning";
  const hasDone = status === "done" && !!result;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface-950">

      <div className="flex items-center justify-between px-6 py-3.5 border-b border-white/5 flex-shrink-0 bg-surface-900/50 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-base font-bold text-gray-100 flex items-center gap-2">
              Game Library
              {result && (
                <span className="badge bg-surface-700 text-gray-300 text-[11px]">
                  {uniqueGamesCount}
                </span>
              )}
            </h1>
            {result && (
              <button
                onClick={() => setShowGpuCachesModal(true)}
                className="text-[11px] text-gray-400 hover:text-accent-300 flex items-center gap-1.5 transition-colors cursor-pointer group text-left mt-0.5"
                title="Click to inspect GPU driver caches and their exact locations on disk"
              >
                <span>
                  {result.caches.length} GPU driver caches · {formatBytes(result.total_size_bytes)} total
                </span>
                <span className="text-[10px] text-accent-400 opacity-80 group-hover:opacity-100 underline decoration-dotted">
                  (View locations ↗)
                </span>
              </button>
            )}
          </div>

          <div className="relative w-64 hidden sm:block">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search games…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface-800 border border-white/5 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-surface-800 rounded-lg p-0.5 border border-white/5">
            <button
              onClick={() => handleSetLayout("grid")}
              className={`p-1.5 rounded-md transition-colors ${
                layoutMode === "grid"
                  ? "bg-accent-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-white"
              }`}
              title="Cover Grid View"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => handleSetLayout("details")}
              className={`p-1.5 rounded-md transition-colors ${
                layoutMode === "details"
                  ? "bg-accent-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-white"
              }`}
              title="Cinematic Details View"
            >
              <Layers size={15} />
            </button>
            <button
              onClick={() => handleSetLayout("table")}
              className={`p-1.5 rounded-md transition-colors ${
                layoutMode === "table"
                  ? "bg-accent-600 text-white shadow-sm"
                  : "text-gray-400 hover:text-white"
              }`}
              title="Table View (Shader Cache Management)"
            >
              <List size={15} />
            </button>
          </div>

          <button
            onClick={() => setShowScannerDialog(true)}
            className="btn-ghost text-xs"
            title="Scan folders for .exe games using MFT"
          >
            <FolderSearch size={14} />
            Scan Folders
          </button>

          <button
            className="btn-accent text-xs"
            onClick={startScan}
            disabled={isBusy}
          >
            <RefreshCw size={13} className={isBusy ? "animate-spin" : ""} />
            {isBusy ? "Scanning…" : "Scan"}
          </button>
        </div>
      </div>

      {isBusy && (
        <div className="px-6 py-3 border-b border-white/5 bg-surface-900/30">
          <ScanProgressBar progress={progress} />
        </div>
      )}

      {status === "error" && error && (
        <div className="mx-6 mt-4 p-4 rounded-lg bg-red-900/20 border border-red-900/40 text-sm text-red-400">
          Scan failed: {error}
        </div>
      )}

      {hasDone && (
        <div className="flex flex-col flex-1 overflow-hidden">

          <div className="flex items-center gap-3 px-6 py-2.5 border-b border-white/5 bg-surface-950 flex-shrink-0 flex-wrap">
            <Filter size={13} className="text-gray-500" />
            <select
              className="bg-surface-800 border border-white/5 text-xs text-gray-300 rounded-lg px-2.5 py-1 focus:outline-none focus:border-accent-500"
              value={filterPlatform}
              onChange={(e) => handlePlatformChange(e.target.value as FilterPlatform)}
            >
              <option value="all">All Platforms</option>
              <option value="steam">Steam</option>
              <option value="epic">Epic</option>
              <option value="gog">GOG</option>
              <option value="custom">Custom Added</option>
            </select>

            <select
              className="bg-surface-800 border border-white/5 text-xs text-gray-300 rounded-lg px-2.5 py-1 focus:outline-none focus:border-accent-500"
              value={filterHasCache}
              onChange={(e) => handleCacheChange(e.target.value as FilterHasCache)}
            >
              <option value="all">All Games</option>
              <option value="has_cache">Has Cache</option>
              <option value="no_cache">No Cache</option>
            </select>

            <span className="text-[11px] text-gray-500 ml-auto">
              {displayGroups.length} games displayed
            </span>
          </div>

          {result && result.caches.length > 0 && (
            <div className="mx-6 mt-3.5 px-4 py-3 rounded-xl bg-surface-900/90 border border-accent-500/20 bg-gradient-to-r from-accent-950/20 via-surface-900/80 to-surface-900/40 flex items-center justify-between flex-shrink-0 backdrop-blur-sm">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="p-2.5 rounded-xl bg-accent-600/20 border border-accent-500/30 text-accent-300 flex-shrink-0">
                  <Cpu size={18} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-gray-100">
                      GPU Driver Shader Caches
                    </span>
                    <span className="badge bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 font-mono text-[10px]">
                      {formatBytes(result.total_size_bytes)}
                    </span>
                    <span className="text-[11px] text-gray-500">
                      ({result.caches.length} driver locations)
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    DirectX & OpenGL compiled shaders in <code className="text-gray-300 font-mono text-[11px]">AppData\Local\NVIDIA</code> for all your PC games.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                <button
                  onClick={() => setShowGpuCachesModal(true)}
                  className="btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5 whitespace-nowrap border-white/10 hover:border-accent-500/40 hover:text-white"
                >
                  <FolderOpen size={13} className="text-accent-400" />
                  Inspect Locations & Paths
                </button>
              </div>
            </div>
          )}

          {layoutMode === "grid" && (
            <div className="flex-1 min-h-0 overflow-hidden relative h-full">
              <GameGridView
                groups={displayGroups}
                onSelectGame={(g) => {
                  setSelectedGameId(g.id);
                  handleSetLayout("details");
                }}
                onEditMetadata={(g) => setEditingMetadataGame(g)}
                onManageCache={(grp) => {
                  setSelectedGameId(grp.game.id);
                  handleSetLayout("details");
                }}
                onRefresh={startScan}
              />
            </div>
          )}

          {layoutMode === "details" && (
            <div className="flex-1 min-h-0 overflow-hidden h-full">
              <GameDetailsView
                groups={displayGroups}
                selectedGameId={selectedGameId}
                onSelectGame={(g) => setSelectedGameId(g.id)}
                onEditMetadata={(g) => setEditingMetadataGame(g)}
                onRefresh={startScan}
              />
            </div>
          )}

          {layoutMode === "table" && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-6 pt-4 space-y-4 h-full">
              <SummaryPanel
                totalBytes={result.total_size_bytes}
                gpuBytes={result.gpu_cache_size}
                gameBytes={result.game_cache_size}
                gameCount={result.grouped.filter((g) => g.caches.length > 0).length}
              />

              <div className="glass-card overflow-hidden flex-1 min-h-0 flex flex-col mb-4">
                <div className="flex items-center gap-4 px-4 py-2.5 border-b border-white/5 text-xs font-semibold text-gray-500 uppercase tracking-wider flex-shrink-0">
                  <div className="w-10 flex-shrink-0" />
                  <button
                    className="flex-1 flex items-center gap-1 hover:text-gray-300 transition-colors text-left"
                    onClick={() => toggleSort("name")}
                  >
                    Game {sortField === "name" && <ArrowUpDown size={11} />}
                  </button>
                  <div className="w-32">Sources</div>
                  <button
                    className="w-24 flex items-center justify-end gap-1 hover:text-gray-300 transition-colors"
                    onClick={() => toggleSort("size")}
                  >
                    Size {sortField === "size" && <ArrowUpDown size={11} />}
                  </button>
                  <button
                    className="w-24 flex items-center justify-end gap-1 hover:text-gray-300 transition-colors"
                    onClick={() => toggleSort("last_modified")}
                  >
                    Modified {sortField === "last_modified" && <ArrowUpDown size={11} />}
                  </button>
                  <div className="w-44" />
                </div>

                <div className="overflow-y-auto flex-1 custom-scrollbar touch-pan-y overscroll-contain min-h-0">
                  {displayGroups.length === 0 ? (
                    <p className="text-center text-sm text-gray-500 py-12">
                      No games match the current filters.
                    </p>
                  ) : (
                    displayGroups.map((group) => (
                      <GameRow
                        key={group.game.id}
                        group={group}
                        onAction={startScan}
                        onEditMetadata={(g) => setEditingMetadataGame(g)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {status === "idle" && !result && (
        <EmptyState onScan={startScan} onOpenFolders={() => setShowScannerDialog(true)} />
      )}

      {showScannerDialog && (
        <LibraryScannerDialog
          existingGames={result?.grouped.map((g) => g.game) || []}
          onClose={() => setShowScannerDialog(false)}
          onAdded={() => {
            setShowScannerDialog(false);
            startScan();
          }}
        />
      )}

      {editingMetadataGame !== null && (
        <MetadataEditorModal
          game={editingMetadataGame}
          onClose={() => setEditingMetadataGame(null)}
          onUpdated={() => {
            setEditingMetadataGame(null);
            startScan();
          }}
        />
      )}

      {showGpuCachesModal && result && (
        <GpuCachesModal
          caches={result.caches}
          totalBytes={result.total_size_bytes}
          onClose={() => setShowGpuCachesModal(false)}
          onRefresh={startScan}
        />
      )}
    </div>
  );
}
