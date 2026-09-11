import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Settings,
  Trash2,
  HardDrive,
  Gamepad2,
  Layers,
  Sparkles,
  CheckCircle2,
  FolderArchive,
  Save,
  BarChart3,
} from "lucide-react";
import clsx from "clsx";

import { useCompressor } from "../hooks/useScanner";

const NAV_ITEMS = [
  { to: "/", label: "Game Library", icon: LayoutDashboard },
  { to: "/trash", label: "Trash", icon: Trash2 },
  { to: "/compressor", label: "Compressor", icon: FolderArchive },
  { to: "/saves", label: "Save Manager", icon: Save },
  { to: "/statistics", label: "Statistics", icon: BarChart3 },
  { to: "/settings", label: "Settings", icon: Settings },
];

const PLATFORM_FILTERS = [
  { id: "all", label: "All Games", icon: Layers },
  { id: "steam", label: "Steam", icon: Gamepad2 },
  { id: "epic", label: "Epic Games", icon: Gamepad2 },
  { id: "gog", label: "GOG Galaxy", icon: Gamepad2 },
  { id: "custom", label: "Custom Added", icon: Sparkles },
];

const CACHE_FILTERS = [
  { id: "all", label: "All Cache States" },
  { id: "has_cache", label: "Cached Only" },
  { id: "no_cache", label: "No Cache" },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = new URLSearchParams(location.search);
  const currentPlatform = searchParams.get("platform") || "all";
  const currentCache = searchParams.get("cache") || "all";
  const isLibraryActive = location.pathname === "/";
  const { processingIds, activeProgress } = useCompressor();

  function setPlatformFilter(platformId: string) {
    const params = new URLSearchParams(location.search);
    if (platformId === "all") {
      params.delete("platform");
    } else {
      params.set("platform", platformId);
    }
    navigate(`/?${params.toString()}`);
  }

  function setCacheFilter(cacheId: string) {
    const params = new URLSearchParams(location.search);
    if (cacheId === "all") {
      params.delete("cache");
    } else {
      params.set("cache", cacheId);
    }
    navigate(`/?${params.toString()}`);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950">

      <aside className="w-56 flex flex-col flex-shrink-0 bg-surface-900 border-r border-white/5 h-full select-none">

        <div className="px-5 py-4 flex items-center gap-3 border-b border-white/5 flex-shrink-0">
          <div className="p-2 rounded-xl bg-gradient-accent shadow-glow-sm">
            <HardDrive size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white tracking-tight">Kcache</p>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar touch-pan-y overscroll-contain px-3 py-3 space-y-5">

          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-3 mb-1.5">
              Menu
            </p>
            <nav className="space-y-1">
              {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
                const isCompressorActive =
                  to === "/compressor" &&
                  (processingIds.size > 0 || (activeProgress && activeProgress.stage !== "done"));

                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    className={({ isActive }) =>
                      clsx(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150 relative",
                        isActive
                          ? "bg-accent-600/20 text-accent-300 border border-accent-600/30 font-semibold"
                          : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
                      )
                    }
                  >
                    <Icon size={15} className={clsx(isCompressorActive && "animate-spin text-accent-400")} />
                    <span>{label}</span>
                    {isCompressorActive && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-accent-400 animate-ping" />
                    )}
                  </NavLink>
                );
              })}
            </nav>
          </div>

          <div>
            <div className="flex items-center justify-between px-3 mb-1.5">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                Platforms
              </p>
            </div>
            <div className="space-y-1">
              {PLATFORM_FILTERS.map(({ id, label, icon: Icon }) => {
                const isActive = isLibraryActive && currentPlatform === id;
                return (
                  <button
                    key={id}
                    onClick={() => setPlatformFilter(id)}
                    className={clsx(
                      "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-all text-left",
                      isActive
                        ? "bg-white/10 text-white font-medium border border-white/10 shadow-sm"
                        : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
                    )}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Icon size={14} className={isActive ? "text-accent-400" : "text-gray-500"} />
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider px-3 mb-1.5">
              Cache State
            </p>
            <div className="space-y-1">
              {CACHE_FILTERS.map(({ id, label }) => {
                const isActive = isLibraryActive && currentCache === id;
                return (
                  <button
                    key={id}
                    onClick={() => setCacheFilter(id)}
                    className={clsx(
                      "w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-all text-left",
                      isActive
                        ? "bg-accent-600/15 text-accent-300 font-medium border border-accent-600/20"
                        : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
                    )}
                  >
                    <span className="truncate">{label}</span>
                    {isActive && <CheckCircle2 size={12} className="text-accent-400 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between flex-shrink-0 bg-surface-900/90">
          <span className="text-[11px] text-gray-500">v0.1.2</span>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        <Outlet />
      </main>
    </div>
  );
}
