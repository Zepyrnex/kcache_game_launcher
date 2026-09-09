import { useState, useMemo, useEffect } from "react";
import {
  Play,
  FolderOpen,
  Sparkles,
  HardDrive,
  Trash2,
  Calendar,
  Building,
  Gamepad2,
  Search,
  FolderSearch,
  FileCode2,
  Check,
  Copy,
  Clock,
  RotateCw,
} from "lucide-react";
import { GameCacheGroup, DetectedGame, CacheEntry, PlaytimeInfo, GameDiskSize } from "../types";
import { PlatformBadge, SourceBadge, formatBytes, formatRelativeDate } from "./ui";
import {
  launchGame,
  openGameFolder,
  deleteGame,
  softDeleteCache,
  updateGameExe,
  getGamePlaytime,
  getGameDiskSize,
  formatPlaytime,
  formatTimer,
} from "../hooks/useScanner";
import { BackupRestorePanel, DeleteConfirmDialog } from "./CacheActions";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";

interface Props {
  groups: GameCacheGroup[];
  selectedGameId: string | null;
  onSelectGame: (game: DetectedGame) => void;
  onEditMetadata: (game: DetectedGame) => void;
  onRefresh: () => void;
}

export function GameDetailsView({
  groups,
  selectedGameId,
  onSelectGame,
  onEditMetadata,
  onRefresh,
}: Props) {
  const [search, setSearch] = useState("");
  const [launching, setLaunching] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [copiedExePath, setCopiedExePath] = useState(false);
  const [changingExe, setChangingExe] = useState(false);
  const [diskSize, setDiskSize] = useState<GameDiskSize | null>(null);
  const [calculatingSize, setCalculatingSize] = useState(false);

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const term = search.toLowerCase();
    return groups.filter((g) => g.game.name.toLowerCase().includes(term));
  }, [groups, search]);

  const activeGroup = useMemo(() => {
    if (selectedGameId) {
      const found = groups.find((g) => g.game.id === selectedGameId);
      if (found) return found;
    }
    return groups[0] || null;
  }, [groups, selectedGameId]);

  if (!activeGroup) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        No games available.
      </div>
    );
  }

  const { game, caches, total_cache_size } = activeGroup;
  const hasCache = caches.length > 0;
  const heroImage = game.hero_url || game.cover_url || game.icon_url;

  const [playtimeInfo, setPlaytimeInfo] = useState<PlaytimeInfo>({
    game_id: game.id,
    total_playtime_secs: game.playtime_seconds || 0,
    is_running: false,
    session_duration_secs: 0,
  });

  useEffect(() => {
    let isMounted = true;

    setPlaytimeInfo({
      game_id: game.id,
      total_playtime_secs: game.playtime_seconds || 0,
      is_running: false,
      session_duration_secs: 0,
    });

    getGamePlaytime(game.id)
      .then((info) => {
        if (isMounted) setPlaytimeInfo(info);
      })
      .catch(console.error);

    setCalculatingSize(true);
    getGameDiskSize(game.id, false)
      .then((sz) => {
        if (isMounted) setDiskSize(sz);
      })
      .catch(console.error)
      .finally(() => {
        if (isMounted) setCalculatingSize(false);
      });

    const unlistenPromise = listen<PlaytimeInfo>("game-status-changed", (event) => {
      if (event.payload.game_id === game.id) {
        setPlaytimeInfo(event.payload);
      }
    });

    return () => {
      isMounted = false;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [game.id, game.playtime_seconds]);

  async function handleRefreshDiskSize() {
    setCalculatingSize(true);
    try {
      const sz = await getGameDiskSize(game.id, true);
      setDiskSize(sz);
    } catch (err) {
      console.error("Failed to calculate disk size:", err);
    } finally {
      setCalculatingSize(false);
    }
  }

  async function handleLaunch() {
    setLaunching(true);
    try {
      await launchGame(game.id);
    } catch (err) {
      console.error("Launch error:", err);
      alert(`Could not launch game: ${err}`);
    } finally {
      setTimeout(() => setLaunching(false), 1500);
    }
  }

  async function handleOpenFolder() {
    const target = game.exe_path || game.install_path;
    if (!target) return;
    try {
      await openGameFolder(target);
    } catch (err) {
      console.error("Open folder error:", err);
    }
  }

  async function handleChangeExe() {
    setChangingExe(true);
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: `Select Executable for ${game.name}`,
        filters: [
          { name: "Executables (*.exe)", extensions: ["exe"] },
          { name: "All Files (*.*)", extensions: ["*"] },
        ],
      });

      if (selected && typeof selected === "string") {
        await updateGameExe(game.id, selected);
        onRefresh();
      }
    } catch (err: any) {
      console.error("Failed to change executable:", err);
      const msg = err?.message || (typeof err === "string" ? err : JSON.stringify(err));
      alert(`Could not update executable: ${msg}`);
    } finally {
      setChangingExe(false);
    }
  }

  async function handleCopyExePath(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedExePath(true);
      setTimeout(() => setCopiedExePath(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }

  async function handleRemoveGame() {
    if (
      confirm(
        `Remove "${game.name}" from Kcache?\n\nThis will hide the game from your library. It will not delete or uninstall the game files from your computer.`
      )
    ) {
      try {
        await deleteGame(game.id);
        onRefresh();
      } catch (err) {
        console.error("Failed to remove game:", err);
        alert(`Could not remove game: ${err}`);
      }
    }
  }

  async function handleDeleteSingleCache(entry: CacheEntry) {
    if (confirm(`Move this cache to trash?\n${entry.path}`)) {
      setDeletingPath(entry.path);
      try {
        await softDeleteCache(entry.path, game.id, game.name);
        onRefresh();
      } catch (err: any) {
        console.error("Delete cache error:", err);
        const msg = err?.message || (typeof err === "string" ? err : JSON.stringify(err));
        alert(`Failed to delete cache: ${msg}`);
      } finally {
        setDeletingPath(null);
      }
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-surface-950">

      <div className="w-72 flex-shrink-0 flex flex-col border-r border-white/5 bg-surface-900/70 backdrop-blur-sm">

        <div className="p-3.5 border-b border-white/5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search library…"
              className="w-full bg-surface-800/80 border border-white/5 rounded-xl pl-8 pr-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent-500 transition-colors"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain divide-y divide-white/5">
          {filteredGroups.map((g) => {
            const isSelected = g.game.id === activeGroup.game.id;
            const cover = g.game.cover_url || g.game.icon_url;
            return (
              <button
                key={g.game.id}
                onClick={() => onSelectGame(g.game)}
                className={`w-full flex items-center gap-3 px-3.5 py-3 text-left transition-all ${
                  isSelected
                    ? "bg-accent-600/15 text-white border-l-4 border-accent-500 shadow-inner"
                    : "hover:bg-white/5 text-gray-400 hover:text-gray-200"
                }`}
              >

                <div className="w-9 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-surface-800 border border-white/5 relative">
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600">
                      <Gamepad2 size={16} />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate leading-snug">{g.game.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-gray-500 font-medium">{g.game.platform.toUpperCase()}</span>
                    {g.caches.length > 0 && (
                      <span className="text-[10px] font-mono text-emerald-400 font-semibold">
                        {formatBytes(g.total_cache_size)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 h-full overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain relative flex flex-col">

        <div className="relative w-full h-72 lg:h-84 flex-shrink-0 overflow-hidden bg-surface-900">
          {heroImage && (
            <img
              src={heroImage}
              alt=""
              className="w-full h-full object-cover object-top opacity-40 filter blur-[2px] scale-105"
            />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-surface-950 via-surface-950/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-surface-950/90 via-surface-950/50 to-transparent" />

          <div className="absolute inset-0 p-8 flex flex-col justify-end z-10">

            {game.logo_url ? (
              <div className="mb-4 max-w-sm max-h-24 flex items-end">
                <img
                  src={game.logo_url}
                  alt={game.name}
                  className="max-h-20 max-w-full object-contain filter drop-shadow-xl"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            ) : null}

            <h1 className="text-3xl lg:text-4xl font-extrabold text-white tracking-tight drop-shadow-lg">
              {game.name}
            </h1>

            <div className="flex items-center gap-2.5 mt-2.5 flex-wrap">
              <PlatformBadge platform={game.platform} />

              <span className="flex items-center gap-1.5 text-xs text-accent-300 font-medium bg-accent-950/60 backdrop-blur-sm px-3 py-1 rounded-full border border-accent-700/50 shadow-sm shadow-accent-950">
                <Clock size={12} className="text-accent-400" />
                Total Playtime: {formatPlaytime(playtimeInfo.total_playtime_secs)}
              </span>

              {playtimeInfo.is_running && (
                <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/80 backdrop-blur-sm px-3 py-1 rounded-full border border-emerald-500/50 shadow-md shadow-emerald-950/60 animate-pulse">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  PLAYING NOW ({formatTimer(playtimeInfo.session_duration_secs)})
                </span>
              )}

              {game.release_date && (
                <span className="flex items-center gap-1 text-xs text-gray-400 bg-surface-800/80 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/5">
                  <Calendar size={12} />
                  {game.release_date}
                </span>
              )}
              {game.developer && (
                <span className="flex items-center gap-1 text-xs text-gray-400 bg-surface-800/80 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/5">
                  <Building size={12} />
                  {game.developer}
                </span>
              )}
              {hasCache && (
                <span className="flex items-center gap-1 text-xs font-mono text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-700/40">
                  <HardDrive size={12} />
                  {formatBytes(total_cache_size)} Cache
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 mt-6 flex-wrap">
              <button
                onClick={handleLaunch}
                disabled={launching}
                className={`px-7 py-2.5 text-sm font-semibold shadow-lg transition-all flex items-center gap-2 ${
                  playtimeInfo.is_running
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-emerald-600/30 border border-emerald-400/40 ring-2 ring-emerald-500/20"
                    : "btn-accent shadow-accent-600/30"
                }`}
              >
                <Play size={16} className={launching ? "animate-spin" : "fill-white"} />
                {launching ? "Starting…" : playtimeInfo.is_running ? "Game Running" : "Play Game"}
              </button>

              {game.install_path && (
                <button onClick={handleOpenFolder} className="btn-ghost text-xs py-2 px-3">
                  <FolderOpen size={14} />
                  Open Folder
                </button>
              )}

              <button onClick={() => onEditMetadata(game)} className="btn-ghost text-xs py-2 px-3">
                <Sparkles size={14} />
                Match Steam Art
              </button>

              {hasCache && (
                <>
                  <BackupRestorePanel group={activeGroup} />
                  <DeleteConfirmDialog group={activeGroup} onDeleted={onRefresh} />
                </>
              )}

              <button
                onClick={handleRemoveGame}
                className="btn-danger text-xs ml-auto py-2 px-3 flex items-center gap-1.5"
                title="Remove from Kcache"
              >
                <Trash2 size={14} />
                Remove Game
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 bg-surface-950/70 backdrop-blur-md rounded-xl p-2.5 px-3.5 border border-white/10 max-w-2xl">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-7 h-7 rounded-lg bg-surface-800 border border-white/5 text-accent-400 flex items-center justify-center flex-shrink-0">
                  <FileCode2 size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Game Path
                    </span>
                    {game.exe_path ? (
                      <span className="text-[10px] text-emerald-400 font-mono bg-emerald-950/50 px-1.5 py-0.5 rounded border border-emerald-800/40">
                        Executable Assigned
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-400 font-mono bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-800/40">
                        Install Folder
                      </span>
                    )}
                  </div>
                  <p
                    className="text-xs font-mono text-gray-200 truncate select-all mt-0.5"
                    title={game.exe_path || game.install_path || "No executable configured"}
                  >
                    {game.exe_path || game.install_path || "No executable configured"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 flex-shrink-0">
                {(game.exe_path || game.install_path) && (
                  <button
                    onClick={() => handleCopyExePath(game.exe_path || game.install_path || "")}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                    title="Copy path to clipboard"
                  >
                    {copiedExePath ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                )}

                <button
                  onClick={handleChangeExe}
                  disabled={changingExe}
                  className="btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5 text-gray-200 hover:text-white border-white/10 hover:border-accent-500/40 bg-surface-800/80 hover:bg-surface-700"
                  title="Browse and select an executable (.exe) to run this game through"
                >
                  <FolderSearch size={13} className="text-accent-400" />
                  {changingExe ? "Selecting…" : "Change .exe"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 space-y-8 max-w-5xl">

          {game.genres && game.genres.length > 0 && (
            <div>
              <h3 className="text-xs uppercase font-semibold text-gray-500 tracking-wider mb-2.5">
                Genres
              </h3>
              <div className="flex gap-2 flex-wrap">
                {game.genres.map((g) => (
                  <span
                    key={g}
                    className="px-3 py-1 rounded-xl bg-surface-800/80 border border-white/5 text-xs text-gray-300 font-medium"
                  >
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}

          {game.description ? (
            <div>
              <h3 className="text-xs uppercase font-semibold text-gray-500 tracking-wider mb-2.5">
                About
              </h3>
              <p className="text-sm text-gray-300 leading-relaxed max-w-3xl">
                {game.description.replace(/<[^>]*>?/gm, "")}
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-surface-900/60 border border-white/5 flex items-center justify-between text-xs text-gray-400">
              <span>No Steam synopsis fetched yet.</span>
              <button
                onClick={() => onEditMetadata(game)}
                className="text-accent-400 hover:text-accent-300 font-medium flex items-center gap-1 transition-colors"
              >
                <Sparkles size={12} />
                Fetch artwork & description from Steam Store
              </button>
            </div>
          )}

          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs uppercase font-semibold text-gray-400 tracking-wider flex items-center gap-2">
                <HardDrive size={13} className="text-accent-400" />
                Storage & Playtime Activity
              </h3>
              <button
                onClick={handleRefreshDiskSize}
                disabled={calculatingSize}
                className="btn-ghost text-[11px] py-1 px-2.5 flex items-center gap-1.5 text-gray-400 hover:text-white border-white/5"
                title="Recalculate total storage space used on disk"
              >
                <RotateCw size={11} className={calculatingSize ? "animate-spin text-accent-400" : ""} />
                {calculatingSize ? "Measuring Disk…" : "Recalculate Space"}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              <div className="p-5 rounded-2xl bg-surface-900/80 border border-white/10 hover:border-white/15 transition-all shadow-md">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-300">
                    <div className="w-6 h-6 rounded-lg bg-accent-950/80 border border-accent-700/50 flex items-center justify-center text-accent-400">
                      <HardDrive size={13} />
                    </div>
                    <span>Total Space Used</span>
                  </div>
                  <span className="text-lg font-mono font-bold text-white tracking-tight">
                    {calculatingSize && !diskSize
                      ? "Measuring…"
                      : formatBytes(
                          diskSize?.total_size_bytes ??
                            (game.install_size_bytes
                              ? game.install_size_bytes + total_cache_size
                              : total_cache_size)
                        )}
                  </span>
                </div>

                {diskSize && diskSize.total_size_bytes > 0 && (
                  <div className="w-full h-2 rounded-full bg-surface-800 overflow-hidden flex mb-3.5">
                    <div
                      className="bg-accent-500 h-full rounded-l-full transition-all duration-500"
                      style={{
                        width: `${Math.max(
                          2,
                          Math.min(
                            98,
                            (diskSize.install_size_bytes / diskSize.total_size_bytes) * 100
                          )
                        )}%`,
                      }}
                      title={`Game Files: ${formatBytes(diskSize.install_size_bytes)}`}
                    />
                    <div
                      className="bg-emerald-400 h-full rounded-r-full transition-all duration-500"
                      style={{
                        width: `${Math.max(
                          2,
                          Math.min(
                            98,
                            (diskSize.cache_size_bytes / diskSize.total_size_bytes) * 100
                          )
                        )}%`,
                      }}
                      title={`Shader Caches: ${formatBytes(diskSize.cache_size_bytes)}`}
                    />
                  </div>
                )}

                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-xl bg-surface-800/60 border border-white/5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-accent-400" />
                      <span className="text-gray-400">Game Installation:</span>
                    </div>
                    <span className="font-mono text-gray-200 font-medium">
                      {calculatingSize && !diskSize
                        ? "Measuring…"
                        : formatBytes(diskSize?.install_size_bytes ?? game.install_size_bytes ?? 0)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-xl bg-surface-800/60 border border-white/5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span className="text-gray-400">Shader Cache Files:</span>
                    </div>
                    <span className="font-mono text-emerald-400 font-medium">
                      {formatBytes(diskSize?.cache_size_bytes ?? total_cache_size)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-2xl bg-surface-900/80 border border-white/10 hover:border-white/15 transition-all shadow-md flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-300">
                      <div className="w-6 h-6 rounded-lg bg-emerald-950/80 border border-emerald-700/50 flex items-center justify-center text-emerald-400">
                        <Clock size={13} />
                      </div>
                      <span>Total Playtime</span>
                    </div>
                    <span className="text-lg font-mono font-bold text-accent-300 tracking-tight">
                      {formatPlaytime(playtimeInfo.total_playtime_secs)}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between p-2 rounded-xl bg-surface-800/60 border border-white/5">
                      <span className="text-gray-400">Game Status:</span>
                      {playtimeInfo.is_running ? (
                        <span className="flex items-center gap-1.5 font-semibold text-emerald-400">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                          Running ({formatTimer(playtimeInfo.session_duration_secs)})
                        </span>
                      ) : (
                        <span className="text-gray-300 font-medium">Ready to Play</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-xl bg-surface-800/60 border border-white/5">
                      <span className="text-gray-400">Last Played:</span>
                      <span className="text-gray-300 font-medium">
                        {game.last_played ? formatRelativeDate(game.last_played) : "Never"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs uppercase font-semibold text-gray-500 tracking-wider">
                Shader Cache Files ({caches.length})
              </h3>
              {hasCache && (
                <span className="text-xs font-mono text-emerald-400">
                  Total: {formatBytes(total_cache_size)}
                </span>
              )}
            </div>

            {caches.length === 0 ? (
              <div className="p-5 rounded-2xl bg-surface-900/40 border border-dashed border-white/10 text-center text-xs text-gray-500">
                No active shader caches detected for this title on disk. Caches are generated when playing games on DirectX, Vulkan, or DXVK.
              </div>
            ) : (
              <div className="space-y-2.5">
                {caches.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-3.5 rounded-xl bg-surface-900/80 border border-white/5 hover:border-white/10 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <SourceBadge source={entry.source} />
                      <div className="min-w-0">
                        <p className="text-xs font-mono text-gray-300 truncate" title={entry.path}>
                          {entry.path}
                        </p>
                        <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-0.5">
                          <span>Modified {formatRelativeDate(entry.last_modified)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 flex-shrink-0">
                      <span className="text-xs font-mono font-semibold text-gray-200">
                        {formatBytes(entry.size_bytes)}
                      </span>
                      <button
                        onClick={() => handleDeleteSingleCache(entry)}
                        disabled={deletingPath === entry.path}
                        className="btn-danger p-1.5 rounded-lg"
                        title="Delete shader cache (moves to trash)"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
