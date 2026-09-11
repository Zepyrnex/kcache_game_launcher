import { useState, useMemo } from "react";
import {
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronRight,
  X,
} from "lucide-react";
import { CacheEntry, CacheAgeCategory, CategorizedCaches } from "../types";
import { formatBytes, formatRelativeDate, SourceBadge } from "../components/ui";
import { useScanner, softDeleteCache } from "../hooks/useScanner";

const AGE_THRESHOLDS_DAYS = {
  active: 30,
  stale: 90,
  old: 180,
};

function getCategory(entry: CacheEntry): CacheAgeCategory {
  const now = Date.now() / 1000;
  const ageDays = (now - entry.last_modified) / 86400;

  if (ageDays < AGE_THRESHOLDS_DAYS.active) return "active";
  if (ageDays < AGE_THRESHOLDS_DAYS.stale) return "stale";
  if (ageDays < AGE_THRESHOLDS_DAYS.old) return "old";
  return "ancient";
}

const CATEGORIES: Record<CacheAgeCategory, {
  label: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: typeof CheckCircle2;
}> = {
  active: {
    label: "Active",
    description: "Used in the last 30 days",
    color: "text-emerald-400",
    bgColor: "bg-emerald-950/40",
    borderColor: "border-emerald-800/40",
    icon: CheckCircle2,
  },
  stale: {
    label: "Stale",
    description: "Last used 30–90 days ago",
    color: "text-amber-400",
    bgColor: "bg-amber-950/40",
    borderColor: "border-amber-800/40",
    icon: AlertTriangle,
  },
  old: {
    label: "Old",
    description: "Last used 90–180 days ago",
    color: "text-orange-400",
    bgColor: "bg-orange-950/40",
    borderColor: "border-orange-800/40",
    icon: Clock,
  },
  ancient: {
    label: "Ancient",
    description: "Not used in over 180 days",
    color: "text-red-400",
    bgColor: "bg-red-950/40",
    borderColor: "border-red-800/40",
    icon: Trash2,
  },
};

export function JanitorPage() {
  const { status, result, startScan } = useScanner();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cleaningIds, setCleaningIds] = useState<Set<string>>(new Set());
  const [expandedCategory, setExpandedCategory] = useState<CacheAgeCategory | null>("ancient");

  const categorized = useMemo<CategorizedCaches>(() => {
    if (!result) {
      return { active: [], stale: [], old: [], ancient: [], uncategorized: [] };
    }

    const cats: CategorizedCaches = {
      active: [],
      stale: [],
      old: [],
      ancient: [],
      uncategorized: [],
    };

    for (const cache of result.caches) {
      const cat = getCategory(cache);
      cats[cat].push(cache);
    }

    return cats;
  }, [result]);

  const summary = useMemo(() => {
    const entries: Array<{
      category: CacheAgeCategory;
      label: string;
      description: string;
      color: string;
      bgColor: string;
      borderColor: string;
      icon: typeof CheckCircle2;
      count: number;
      totalBytes: number;
      items: CacheEntry[];
    }> = [];

    for (const [key, config] of Object.entries(CATEGORIES)) {
      const items = categorized[key as CacheAgeCategory];
      entries.push({
        category: key as CacheAgeCategory,
        ...config,
        count: items.length,
        totalBytes: items.reduce((sum, c) => sum + c.size_bytes, 0),
        items,
      });
    }

    entries.sort((a, b) => b.totalBytes - a.totalBytes);
    return entries;
  }, [categorized]);

  const selectedBytes = useMemo(() => {
    let total = 0;
    for (const cache of result?.caches || []) {
      if (selectedIds.has(cache.id)) {
        total += cache.size_bytes;
      }
    }
    return total;
  }, [selectedIds, result]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectCategory(category: CacheAgeCategory) {
    const ids = new Set(categorized[category].map((c) => c.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function deselectCategory(category: CacheAgeCategory) {
    const ids = new Set(categorized[category].map((c) => c.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  async function handleCleanSelected() {
    if (selectedIds.size === 0) return;

    const selectedCaches = result?.caches.filter((c) => selectedIds.has(c.id)) || [];
    const totalSize = selectedCaches.reduce((sum, c) => sum + c.size_bytes, 0);

    if (
      !confirm(
        `Move ${selectedCaches.length} cache file(s) to Trash?\n\nSpace to free: ${formatBytes(
          totalSize
        )}\n\nYour GPU driver will recompile required shaders on next game launch.`
      )
    ) {
      return;
    }

    setCleaningIds(new Set(selectedIds));

    try {
      for (const cache of selectedCaches) {
        setCleaningIds((prev) => new Set(prev).add(cache.id));
        try {
          await softDeleteCache(cache.path, undefined, cache.associated_game_guess || "Unknown");
        } catch (err) {
          console.error("Failed to delete cache:", cache.path, err);
        }
      }
      setSelectedIds(new Set());
      await startScan();
    } catch (err) {
      console.error("Bulk delete error:", err);
      alert("Some caches could not be deleted. They may be locked by running games.");
    } finally {
      setCleaningIds(new Set());
    }
  }

  async function handleCleanCategory(category: CacheAgeCategory) {
    const items = categorized[category];
    if (items.length === 0) return;

    const catConfig = CATEGORIES[category];
    const totalSize = items.reduce((sum, c) => sum + c.size_bytes, 0);

    if (
      !confirm(
        `Move all ${catConfig.label} caches to Trash?\n\n${items.length} file(s) · ${formatBytes(
          totalSize
        )}\n\nThese haven't been used in ${
          category === "ancient"
            ? "over 180 days"
            : category === "old"
              ? "90–180 days"
              : category === "stale"
                ? "30–90 days"
                : "less than 30 days"
        }.`
      )
    ) {
      return;
    }

    setCleaningIds(new Set(items.map((c) => c.id)));

    try {
      for (const cache of items) {
        setCleaningIds((prev) => new Set(prev).add(cache.id));
        try {
          await softDeleteCache(cache.path, undefined, cache.associated_game_guess || "Unknown");
        } catch (err) {
          console.error("Failed to delete cache:", cache.path, err);
        }
      }
      await startScan();
    } catch (err) {
      console.error("Category delete error:", err);
    } finally {
      setCleaningIds(new Set());
    }
  }

  if (status === "idle" && !result) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 animate-fade-in">
        <div className="p-5 rounded-2xl bg-surface-800 border border-white/5 mb-4">
          <Trash2 size={40} className="text-gray-600" />
        </div>
        <h3 className="text-lg font-semibold text-gray-300">No scan data yet</h3>
        <p className="text-sm text-gray-500 mt-1 max-w-sm text-center">
          Run a scan to discover shader caches and categorize them by last usage.
        </p>
        <button className="btn-accent mt-4" onClick={startScan}>
          <RefreshCw size={16} />
          Scan Libraries
        </button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="p-6">
        <div className="p-4 rounded-lg bg-red-900/20 border border-red-900/40 text-sm text-red-400">
          Scan failed. Please try again.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0 bg-surface-900/50 backdrop-blur-sm">
        <div>
          <h1 className="text-base font-bold text-gray-100 flex items-center gap-2">
            <Trash2 size={18} className="text-red-400" />
            Cache Janitor
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Categorize shader caches by last usage. Old caches are safe to delete — drivers recompile on demand.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-400">
                {selectedIds.size} selected · {formatBytes(selectedBytes)}
              </span>
              <button onClick={handleCleanSelected} className="btn-danger text-xs">
                <Trash2 size={13} />
                Clean Selected
              </button>
              <button onClick={() => setSelectedIds(new Set())} className="btn-ghost text-xs">
                <X size={13} />
                Clear
              </button>
            </div>
          )}

          <button
            onClick={startScan}
            className="btn-ghost text-xs"
            disabled={status === "scanning"}
          >
            <RefreshCw size={13} className={status === "scanning" ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Category Cards */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain p-6 space-y-4">
        {summary.map((cat) => {
          const Icon = cat.icon;
          const isExpanded = expandedCategory === cat.category;
          const isAllSelected =
            cat.items.length > 0 &&
            selectedIds.size === cat.items.length &&
            cat.items.every((c) => selectedIds.has(c.id));

          return (
            <div
              key={cat.category}
              className={`glass-card overflow-hidden transition-all duration-200 ${
                isExpanded ? "border-white/15" : "border-white/5"
              }`}
            >
              {/* Category Header */}
              <div
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-white/5 transition-colors"
                onClick={() => setExpandedCategory(isExpanded ? null : cat.category)}
              >
                <div className={`p-2.5 rounded-xl ${cat.bgColor} border ${cat.borderColor} ${cat.color}`}>
                  <Icon size={18} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-100">{cat.label}</span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full ${cat.bgColor} ${cat.color} border ${cat.borderColor}`}
                    >
                      {cat.count} file{cat.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{cat.description}</p>
                </div>

                <div className="text-right flex-shrink-0">
                  <p className={`text-lg font-bold font-mono ${cat.color}`}>
                    {formatBytes(cat.totalBytes)}
                  </p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Disk Usage</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isAllSelected) deselectCategory(cat.category);
                      else selectCategory(cat.category);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isAllSelected
                        ? "bg-accent-600/20 text-accent-300 border border-accent-600/30"
                        : "bg-surface-800 text-gray-300 border border-white/10 hover:border-white/20"
                    }`}
                  >
                    {isAllSelected ? "Deselect All" : "Select All"}
                  </button>

                  {cat.category !== "active" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCleanCategory(cat.category);
                      }}
                      className="btn-danger text-xs py-1.5 px-3"
                    >
                      <Trash2 size={13} />
                      Clean
                    </button>
                  )}

                  <ChevronRight
                    size={18}
                    className={`text-gray-500 transition-transform duration-200 ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                </div>
              </div>

              {/* Expanded Cache List */}
              {isExpanded && (
                <div className="border-t border-white/5 bg-surface-950/30">
                  <div className="p-3 space-y-2">
                    {cat.items.length === 0 ? (
                      <p className="text-center text-xs text-gray-600 py-4">No caches in this category</p>
                    ) : (
                      cat.items.map((cache) => {
                        const isSelected = selectedIds.has(cache.id);
                        const isCleaning = cleaningIds.has(cache.id);

                        return (
                          <div
                            key={cache.id}
                            className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                              isSelected
                                ? "bg-accent-950/40 border-accent-500/30"
                                : "bg-surface-800/40 border-white/5 hover:border-white/10"
                            }`}
                          >
                            <button
                              onClick={() => toggleSelect(cache.id)}
                              className={`flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                                isSelected
                                  ? "bg-accent-500 border-accent-400"
                                  : "border-white/20 hover:border-white/40"
                              }`}
                            >
                              {isSelected && <CheckCircle2 size={12} className="text-white" />}
                            </button>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <SourceBadge source={cache.source} />
                                <span className="text-xs font-mono text-gray-400 truncate" title={cache.path}>
                                  {cache.path}
                                </span>
                              </div>
                              <p className="text-[11px] text-gray-600 mt-0.5">
                                Modified {formatRelativeDate(cache.last_modified)}
                                {cache.associated_game_guess && (
                                  <span className="text-gray-500"> · guess: {cache.associated_game_guess}</span>
                                )}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`text-sm font-mono font-semibold ${cat.color}`}>
                                {formatBytes(cache.size_bytes)}
                              </span>
                              <button
                                onClick={() => softDeleteCache(cache.path, undefined, cache.associated_game_guess || "Unknown")}
                                disabled={isCleaning}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                                title="Move to trash"
                              >
                                {isCleaning ? (
                                  <RefreshCw size={13} className="animate-spin" />
                                ) : (
                                  <Trash2 size={13} />
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Stats */}
      <div className="px-6 py-3 border-t border-white/5 bg-surface-950/80 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4 text-[11px] text-gray-500">
          <span>Total: {result?.caches.length || 0} caches</span>
          <span>·</span>
          <span>{formatBytes(result?.total_size_bytes || 0)}</span>
          {selectedIds.size > 0 && (
            <>
              <span>·</span>
              <span className="text-accent-400">{selectedIds.size} selected ({formatBytes(selectedBytes)})</span>
            </>
          )}
        </div>
        <p className="text-[10px] text-gray-600">
          Caches are soft-deleted to Trash. Drivers will recompile shaders on next launch.
        </p>
      </div>
    </div>
  );
}
