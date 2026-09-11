import React, { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  BarChart3,
  Clock,
  HardDrive,
  FolderOpen,
  Search,
  RefreshCw,
  Gamepad2,
  ArrowUpDown,
} from "lucide-react";
import type { LibraryStatistics, PlaytimeInfo } from "../types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatPlaytime(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

type SortOption = "total_size" | "install_size" | "cache_size" | "playtime" | "name";

export function Statistics() {
  const [stats, setStats] = useState<LibraryStatistics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [includeUninstalled, setIncludeUninstalled] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortOption>("total_size");

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<LibraryStatistics>("get_library_statistics");
      setStats(data);
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "Failed to load statistics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();

    let unlisten: UnlistenFn | undefined;
    const setupListener = async () => {
      try {
        unlisten = await listen<PlaytimeInfo>("game-status-changed", (event) => {
          setStats((prev) => {
            if (!prev) return prev;
            const updatedAll = prev.all_games.map((g) => {
              if (g.id === event.payload.game_id) {
                return { ...g, playtime_seconds: event.payload.total_playtime_secs };
              }
              return g;
            });
            const updatedTop = [...updatedAll]
              .filter((g) => g.playtime_seconds > 0)
              .sort((a, b) => b.playtime_seconds - a.playtime_seconds)
              .slice(0, 15);
            const totalPlay = updatedAll.reduce((acc, g) => acc + g.playtime_seconds, 0);

            return {
              ...prev,
              all_games: updatedAll,
              top_played_games: updatedTop,
              total_playtime_seconds: totalPlay,
              average_playtime_seconds:
                prev.total_games > 0 ? Math.floor(totalPlay / prev.total_games) : 0,
            };
          });
        });
      } catch (e) {
        console.error("Failed to register game-status-changed listener:", e);
      }
    };

    setupListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleOpenFolder = async (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await invoke("open_game_folder", { path });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  const filteredGames = useMemo(() => {
    if (!stats) return [];
    let list = stats.all_games.filter((g) => {
      if (!includeUninstalled && !g.is_installed) return false;
      if (searchQuery.trim() === "") return true;
      const q = searchQuery.toLowerCase();
      return (
        g.name.toLowerCase().includes(q) ||
        g.platform.toLowerCase().includes(q) ||
        g.install_path.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      switch (sortBy) {
        case "total_size":
          return b.total_size_bytes - a.total_size_bytes;
        case "install_size":
          return b.install_size_bytes - a.install_size_bytes;
        case "cache_size":
          return b.cache_size_bytes - a.cache_size_bytes;
        case "playtime":
          return b.playtime_seconds - a.playtime_seconds;
        case "name":
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

    return list;
  }, [stats, includeUninstalled, searchQuery, sortBy]);

  const maxPlaytime = useMemo(() => {
    if (!stats || stats.top_played_games.length === 0) return 1;
    return Math.max(...stats.top_played_games.map((g) => g.playtime_seconds), 1);
  }, [stats]);

  const maxTotalSize = useMemo(() => {
    if (!stats || stats.all_games.length === 0) return 1;
    return Math.max(...stats.all_games.map((g) => g.total_size_bytes), 1);
  }, [stats]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0a0a0f] text-gray-200">
      <div className="flex items-center justify-between px-7 py-4 border-b border-white/5 flex-shrink-0 bg-[#0d0d14]/80 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <BarChart3 size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold text-white tracking-tight">Statistics</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white/5 text-gray-400 border border-white/10">
                Live Metrics
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Comprehensive playtime overview, platform distributions, and detailed disk storage footprint.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none bg-surface-900/60 hover:bg-surface-800 px-3 py-1.5 rounded-lg border border-white/5 transition-colors">
            <input
              type="checkbox"
              checked={includeUninstalled}
              onChange={(e) => setIncludeUninstalled(e.target.checked)}
              className="rounded border-white/20 bg-surface-800 text-amber-500 focus:ring-0"
            />
            <span>Include uninstalled</span>
          </label>

          <button
            onClick={fetchStats}
            disabled={loading}
            className="btn-secondary text-xs flex items-center gap-1.5 py-1.5 px-3 disabled:opacity-50"
            title="Refresh statistics and storage sizes"
          >
            <RefreshCw size={13} className={loading ? "animate-spin text-amber-400" : ""} />
            <span>{loading ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain px-7 py-6 space-y-7">
        {error && (
          <div className="p-4 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300">
            {error}
          </div>
        )}

        {stats && (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="text-amber-400">▾</span> Global
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 p-5 rounded-2xl bg-surface-900/40 border border-white/5 backdrop-blur-sm">
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Overview
                  </h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between text-gray-300">
                      <span>All</span>
                      <span className="font-mono font-medium text-white">{stats.total_games}</span>
                    </div>
                    <div className="flex items-center justify-between text-gray-300">
                      <span>Installed</span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-white">{stats.installed_games}</span>
                        <span className="text-gray-500 text-[11px]">
                          {stats.total_games > 0
                            ? `${Math.round((stats.installed_games / stats.total_games) * 100)}%`
                            : "0%"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-gray-300">
                      <span>Not installed</span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-white">{stats.not_installed_games}</span>
                        <span className="text-gray-500 text-[11px]">
                          {stats.total_games > 0
                            ? `${Math.round((stats.not_installed_games / stats.total_games) * 100)}%`
                            : "0%"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-gray-300">
                      <span>Hidden</span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-white">0</span>
                        <span className="text-gray-500 text-[11px]">0%</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-gray-300">
                      <span>Favorite</span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-white">0</span>
                        <span className="text-gray-500 text-[11px]">0%</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/5 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Total play time</span>
                      <span className="font-mono font-bold text-amber-400">
                        {formatPlaytime(stats.total_playtime_seconds)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Average play time</span>
                      <span className="font-mono text-gray-300">
                        {formatPlaytime(stats.average_playtime_seconds)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400">Total install size</span>
                      <span className="font-mono font-medium text-gray-200">
                        {formatBytes(stats.total_install_size_bytes)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Completion Status
                  </h3>
                  <div className="space-y-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-gray-300">
                        <span>Played</span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-white">{stats.played_games}</span>
                          <span className="text-amber-400 font-medium">
                            {stats.total_games > 0
                              ? `${Math.round((stats.played_games / stats.total_games) * 100)}%`
                              : "0%"}
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 bg-surface-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 transition-all duration-500"
                          style={{
                            width: `${
                              stats.total_games > 0
                                ? (stats.played_games / stats.total_games) * 100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-gray-300">
                        <span>Not Played</span>
                        <div className="flex items-center gap-2 font-mono">
                          <span className="text-white">{stats.not_played_games}</span>
                          <span className="text-gray-500">
                            {stats.total_games > 0
                              ? `${Math.round((stats.not_played_games / stats.total_games) * 100)}%`
                              : "0%"}
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 bg-surface-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gray-600 transition-all duration-500"
                          style={{
                            width: `${
                              stats.total_games > 0
                                ? (stats.not_played_games / stats.total_games) * 100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Top play time
                  </h3>
                  <div className="space-y-2 text-xs max-h-56 overflow-y-auto custom-scrollbar pr-1">
                    {stats.top_played_games.length === 0 ? (
                      <div className="text-gray-500 text-xs py-4 text-center">
                        No playtime recorded yet. Launch a game to begin tracking!
                      </div>
                    ) : (
                      stats.top_played_games.map((game) => {
                        const pctOfTotal =
                          stats.total_playtime_seconds > 0
                            ? Math.round(
                                (game.playtime_seconds / stats.total_playtime_seconds) * 100
                              )
                            : 0;
                        const barWidth =
                          maxPlaytime > 0
                            ? Math.max(Math.round((game.playtime_seconds / maxPlaytime) * 100), 4)
                            : 0;

                        return (
                          <div
                            key={game.id}
                            className="flex items-center justify-between gap-2 group py-0.5 hover:bg-white/5 px-1.5 rounded transition-colors"
                          >
                            <span className="text-gray-300 truncate max-w-[140px]" title={game.name}>
                              {game.name}
                            </span>
                            <div className="flex items-center gap-2.5 font-mono text-[11px] flex-shrink-0">
                              <span className="text-amber-400 font-medium">
                                {formatPlaytime(game.playtime_seconds)}
                              </span>
                              <div className="flex items-center gap-1.5 w-14 justify-end">
                                <span className="text-gray-500 text-[10px]">{pctOfTotal}%</span>
                                <div className="w-8 h-1.5 bg-surface-800 rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-amber-500/80 rounded-full"
                                    style={{ width: `${barWidth}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Library
                  </h3>
                  <div className="space-y-2.5 text-xs">
                    {Object.entries(stats.platform_counts).map(([plat, count]) => {
                      const pct =
                        stats.total_games > 0
                          ? Math.round((count / stats.total_games) * 100)
                          : 0;
                      return (
                        <div key={plat} className="space-y-1">
                          <div className="flex items-center justify-between text-gray-300">
                            <span className="capitalize">{plat}</span>
                            <div className="flex items-center gap-2 font-mono">
                              <span className="text-white">{count}</span>
                              <span className="text-gray-500 text-[11px]">{pct}%</span>
                            </div>
                          </div>
                          <div className="w-full h-1 bg-surface-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500/80 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-2">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                    <HardDrive size={16} className="text-indigo-400" />
                    Storage Breakdown & Disk Footprint
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Storage consumed per game across installation directories, GPU shader caches, and save backups.
                  </p>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                  <div className="relative flex-1 md:w-64">
                    <Search
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                      size={13}
                    />
                    <input
                      type="text"
                      placeholder="Search games..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-surface-900/80 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 bg-surface-900/80 border border-white/10 rounded-lg px-2 py-1.5">
                    <ArrowUpDown size={12} className="text-gray-400" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortOption)}
                      className="bg-transparent text-xs text-gray-300 focus:outline-none cursor-pointer"
                    >
                      <option value="total_size" className="bg-surface-900 text-gray-200">
                        Total Size
                      </option>
                      <option value="install_size" className="bg-surface-900 text-gray-200">
                        Install Size
                      </option>
                      <option value="cache_size" className="bg-surface-900 text-gray-200">
                        Shader Cache
                      </option>
                      <option value="playtime" className="bg-surface-900 text-gray-200">
                        Playtime
                      </option>
                      <option value="name" className="bg-surface-900 text-gray-200">
                        Alphabetical
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl bg-surface-900/60 border border-white/5">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                    Total Storage
                  </p>
                  <p className="text-lg font-bold text-white font-mono mt-1">
                    {formatBytes(stats.total_storage_used_bytes)}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Games + Shaders + Backups</p>
                </div>

                <div className="p-4 rounded-xl bg-surface-900/60 border border-white/5">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                    Game Installs
                  </p>
                  <p className="text-lg font-bold text-indigo-400 font-mono mt-1">
                    {formatBytes(stats.total_install_size_bytes)}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Physical game binaries</p>
                </div>

                <div className="p-4 rounded-xl bg-surface-900/60 border border-white/5">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                    GPU Shader Caches
                  </p>
                  <p className="text-lg font-bold text-accent-400 font-mono mt-1">
                    {formatBytes(stats.total_shader_cache_size_bytes)}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">NVIDIA, AMD & DXVK caches</p>
                </div>

                <div className="p-4 rounded-xl bg-surface-900/60 border border-white/5">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                    Save Backups
                  </p>
                  <p className="text-lg font-bold text-emerald-400 font-mono mt-1">
                    {formatBytes(stats.total_backup_size_bytes)}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Zip archive backups</p>
                </div>
              </div>

              <div className="divide-y divide-white/5 border border-white/10 rounded-2xl overflow-hidden bg-surface-900/40 shadow-sm">
                {filteredGames.length === 0 ? (
                  <div className="p-12 text-center text-xs text-gray-500">
                    No games found matching the current search filter.
                  </div>
                ) : (
                  filteredGames.map((game) => {
                    const sharePct =
                      stats.total_storage_used_bytes > 0
                        ? Math.round((game.total_size_bytes / stats.total_storage_used_bytes) * 100)
                        : 0;
                    const barWidth =
                      maxTotalSize > 0
                        ? Math.max(Math.round((game.total_size_bytes / maxTotalSize) * 100), 2)
                        : 0;

                    return (
                      <div
                        key={game.id}
                        className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="flex items-center gap-3.5 min-w-0 flex-1">
                          <div className="w-10 h-14 rounded-lg bg-surface-800 overflow-hidden flex-shrink-0 border border-white/10 flex items-center justify-center">
                            {game.cover_url ? (
                              <img
                                src={game.cover_url}
                                alt={game.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Gamepad2 size={18} className="text-gray-500" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-white truncate">
                                {game.name}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-white/5 text-gray-400 border border-white/5 uppercase">
                                {game.platform}
                              </span>
                              {!game.is_installed && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                                  Not installed
                                </span>
                              )}
                              {game.playtime_seconds > 0 && (
                                <span className="flex items-center gap-1 text-[11px] font-mono text-amber-400/90 ml-1">
                                  <Clock size={11} /> {formatPlaytime(game.playtime_seconds)}
                                </span>
                              )}
                            </div>

                            <p className="text-xs font-mono text-gray-500 truncate" title={game.install_path}>
                              {game.install_path || "No install path configured"}
                            </p>

                            <div className="w-full max-w-md h-1.5 bg-surface-800 rounded-full overflow-hidden mt-1.5">
                              <div
                                className="h-full bg-gradient-to-r from-indigo-500 via-accent-500 to-amber-400 rounded-full transition-all duration-300"
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-5 flex-shrink-0 self-end md:self-center">
                          <div className="flex items-center gap-4 text-xs font-mono">
                            <div className="text-right">
                              <span className="text-[10px] text-gray-500 block">Game Files</span>
                              <span className="text-gray-300">
                                {formatBytes(game.install_size_bytes)}
                              </span>
                            </div>

                            <div className="text-right">
                              <span className="text-[10px] text-gray-500 block">Shader Cache</span>
                              <span className="text-accent-400">
                                {formatBytes(game.cache_size_bytes)}
                              </span>
                            </div>

                            <div className="text-right min-w-[70px]">
                              <span className="text-[10px] text-gray-500 block">Total Footprint</span>
                              <span className="font-bold text-white text-sm">
                                {formatBytes(game.total_size_bytes)}
                              </span>
                            </div>

                            <div className="text-right min-w-[40px] text-[11px] text-gray-500">
                              <span>{sharePct}%</span>
                            </div>
                          </div>

                          {game.install_path && (
                            <button
                              onClick={(e) => handleOpenFolder(game.install_path, e)}
                              className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700 text-gray-300 hover:text-white border border-white/10 transition-colors"
                              title="Open game directory in Windows Explorer"
                            >
                              <FolderOpen size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Statistics;
