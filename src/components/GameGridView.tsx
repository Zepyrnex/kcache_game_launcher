import { useState, useEffect } from "react";
import { Play, FolderOpen, MoreVertical, Sparkles, Gamepad2, HardDrive, Disc, Trash2 } from "lucide-react";
import { GameCacheGroup, DetectedGame } from "../types";
import { PlatformBadge, formatBytes } from "./ui";
import { launchGame, openGameFolder, deleteGame } from "../hooks/useScanner";

interface Props {
  groups: GameCacheGroup[];
  onSelectGame: (game: DetectedGame) => void;
  onEditMetadata: (game: DetectedGame) => void;
  onManageCache: (group: GameCacheGroup) => void;
  onRefresh?: () => void;
}

export function GameGridView({
  groups,
  onSelectGame,
  onEditMetadata,
  onManageCache,
  onRefresh,
}: Props) {
  const [activeMenuGameId, setActiveMenuGameId] = useState<string | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeMenuGameId) return;
    function handleClickOutside() {
      setActiveMenuGameId(null);
    }
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, [activeMenuGameId]);

  async function handleLaunch(e: React.MouseEvent, gameId: string) {
    e.stopPropagation();
    setLaunchingId(gameId);
    try {
      await launchGame(gameId);
    } catch (err) {
      console.error("Failed to launch game:", err);
      alert(`Could not launch game: ${err}`);
    } finally {
      setTimeout(() => setLaunchingId(null), 1200);
    }
  }

  async function handleOpenFolder(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    try {
      await openGameFolder(path);
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }

  return (
    <div className="h-full w-full grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-5 p-6 content-start items-start overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain">
      {groups.map((group) => {
        const { game, caches, total_cache_size } = group;
        const hasCache = caches.length > 0;
        const cover = game.cover_url || game.icon_url;
        const isLaunching = launchingId === game.id;
        const isMenuOpen = activeMenuGameId === game.id;

        return (
          <div
            key={game.id}
            onClick={() => onSelectGame(game)}
            className="group relative flex flex-col rounded-2xl cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-accent-500/20 select-none bg-surface-900/90 border border-white/10 hover:border-accent-500/60 self-start w-full h-auto"
          >

            <div className="relative aspect-[2/3] w-full rounded-t-2xl overflow-hidden bg-surface-950">
              {cover ? (
                <img
                  src={cover}
                  alt={game.name}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : null}

              <div className="absolute inset-0 -z-10 flex flex-col items-center justify-between p-4 bg-gradient-to-br from-surface-800 via-surface-900 to-surface-950 text-center">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mt-6">
                  <Gamepad2 size={24} className="text-accent-400" />
                </div>
                <div className="my-auto px-2">
                  <p className="text-xs font-bold text-gray-200 line-clamp-3 leading-snug">
                    {game.name}
                  </p>
                </div>
                <div className="opacity-40">
                  <Disc size={20} className="text-gray-500 animate-spin-slow" />
                </div>
              </div>

              <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between pointer-events-none z-10">
                <PlatformBadge platform={game.platform} />

                {hasCache && (
                  <div className="badge bg-surface-950/85 backdrop-blur-md text-emerald-400 border border-emerald-500/30 font-mono text-[10px] shadow-sm flex items-center gap-1">
                    <HardDrive size={10} />
                    {formatBytes(total_cache_size)}
                  </div>
                )}
              </div>

              <div
                className={`absolute inset-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent transition-opacity duration-200 flex flex-col justify-end p-3 z-10 ${
                  isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <p className="text-xs font-semibold text-white truncate mb-2 drop-shadow">
                  {game.name}
                </p>

                {isMenuOpen && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-2 right-2 bottom-14 rounded-xl bg-surface-900/98 backdrop-blur-xl border border-white/20 shadow-2xl py-1 z-30 text-xs animate-fade-in divide-y divide-white/5"
                  >
                    <div className="py-0.5">
                      {game.install_path && (
                        <button
                          onClick={(e) => {
                            setActiveMenuGameId(null);
                            handleOpenFolder(e, game.install_path);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-gray-200 hover:text-white hover:bg-white/10 text-left transition-colors rounded-md font-medium"
                        >
                          <FolderOpen size={13} className="text-accent-400 flex-shrink-0" />
                          <span className="truncate">Open Folder</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setActiveMenuGameId(null);
                          onManageCache(group);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-gray-200 hover:text-white hover:bg-white/10 text-left transition-colors rounded-md font-medium"
                      >
                        <HardDrive size={13} className="text-emerald-400 flex-shrink-0" />
                        <span className="truncate">Shader Cache</span>
                      </button>
                    </div>
                    <div className="py-0.5">
                      <button
                        onClick={() => {
                          setActiveMenuGameId(null);
                          onEditMetadata(game);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-gray-200 hover:text-white hover:bg-white/10 text-left transition-colors rounded-md font-medium"
                      >
                        <Sparkles size={13} className="text-amber-400 flex-shrink-0" />
                        <span className="truncate">Match Info & Art</span>
                      </button>
                    </div>
                    <div className="py-0.5">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          setActiveMenuGameId(null);
                          if (
                            confirm(
                              `Remove "${game.name}" from Kcache?\n\nThis will hide the game from your library. It will not delete or uninstall the game files from your computer.`
                            )
                          ) {
                            try {
                              await deleteGame(game.id);
                              onRefresh?.();
                            } catch (err) {
                              console.error("Failed to remove game:", err);
                              alert(`Could not remove game: ${err}`);
                            }
                          }
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/15 text-left transition-colors rounded-md font-medium"
                      >
                        <Trash2 size={13} className="text-red-400 flex-shrink-0" />
                        <span className="truncate">Remove Game</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 justify-center">
                  <button
                    onClick={(e) => handleLaunch(e, game.id)}
                    disabled={isLaunching}
                    className="flex-1 btn-accent py-2 text-xs font-semibold justify-center shadow-lg shadow-accent-600/30"
                    title="Launch Game"
                  >
                    <Play size={13} className={isLaunching ? "animate-spin" : "fill-white"} />
                    {isLaunching ? "Starting…" : "Play"}
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuGameId(isMenuOpen ? null : game.id);
                    }}
                    className={`p-2 rounded-lg border transition-colors ${
                      isMenuOpen
                        ? "bg-accent-600 text-white border-accent-500"
                        : "bg-surface-800/90 hover:bg-surface-700 text-gray-300 hover:text-white border-white/10"
                    }`}
                    title="Options"
                  >
                    <MoreVertical size={14} />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-3 flex flex-col justify-between bg-surface-900/60 rounded-b-2xl border-t border-white/5">
              <h3
                className="text-xs font-semibold text-gray-200 truncate group-hover:text-white transition-colors"
                title={game.name}
              >
                {game.name}
              </h3>
              <div className="flex items-center justify-between mt-1 text-[11px] text-gray-500">
                <span className="capitalize">{game.platform}</span>
                {hasCache ? (
                  <span className="font-mono text-emerald-400/90 font-medium">
                    {formatBytes(total_cache_size)}
                  </span>
                ) : (
                  <span className="italic text-[10px]">No cache</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
