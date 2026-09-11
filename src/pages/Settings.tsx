import { useState, useEffect } from "react";
import {
  Palette,
  Shield,
  Database,
  Key,
  RefreshCw,
  FolderPlus,
  Trash2,
  Folder,
  EyeOff,
  RotateCcw,
} from "lucide-react";
import {
  getSettings,
  setSetting,
  getEverythingStatus,
  detectSteamId,
  syncSteamWebApi,
  getScanFolders,
  addScanFolder,
  removeScanFolder,
  toggleScanFolder,
  getExcludedGames,
  restoreGame,
} from "../hooks/useScanner";
import { EverythingStatus, ScanFolder, ExcludedGame } from "../types";
import { open } from "@tauri-apps/plugin-dialog";
import { useAuth } from "../contexts/AuthContext";
import { LogOut, User as UserIcon } from "lucide-react";
import { Link } from "react-router-dom";

export function Settings() {
  const { session, user, signOut } = useAuth();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [everythingStatus, setEverythingStatus] = useState<EverythingStatus | null>(null);

  const [steamApiKey, setSteamApiKey] = useState("");
  const [steamId, setSteamId] = useState("");
  const [detectingSteam, setDetectingSteam] = useState(false);
  const [syncingSteam, setSyncingSteam] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const [folders, setFolders] = useState<ScanFolder[]>([]);
  const [manualFolderPath, setManualFolderPath] = useState("");

  const [excludedGames, setExcludedGames] = useState<ExcludedGame[]>([]);

  useEffect(() => {
    getSettings().then((s) => {
      setSettings(s);
      setSteamApiKey(s.steam_api_key ?? "");
      setSteamId(s.steam_id ?? "");
    });
    getEverythingStatus().then(setEverythingStatus);
    loadScanFolders();
    loadExcludedGames();
  }, []);

  async function loadExcludedGames() {
    try {
      const list = await getExcludedGames();
      setExcludedGames(list);
    } catch (err) {
      console.error("Failed to load excluded games:", err);
    }
  }

  async function handleRestoreGame(id: string) {
    try {
      await restoreGame(id);
      await loadExcludedGames();
    } catch (err) {
      console.error("Failed to restore game:", err);
      alert(`Could not restore game: ${err}`);
    }
  }

  async function loadScanFolders() {
    try {
      setFolders(await getScanFolders());
    } catch (err) {
      console.error("Failed to load scan folders:", err);
    }
  }

  async function save(key: string, value: string) {
    try {
      await setSetting(key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
    } catch (err) {
      console.error(`Failed to save ${key}:`, err);
    }
  }

  async function handleAutoDetectSteamId() {
    setDetectingSteam(true);
    try {
      const detected = await detectSteamId();
      if (detected) {
        setSteamId(detected);
        await save("steam_id", detected);
        alert(`Detected Steam ID: ${detected}`);
      } else {
        alert("Could not automatically find Steam ID in loginusers.vdf. Please enter manually.");
      }
    } catch (err) {
      alert(`Detection failed: ${err}`);
    } finally {
      setDetectingSteam(false);
    }
  }

  async function handleSyncSteam() {
    if (!steamApiKey.trim()) {
      alert("Please enter a Steam Web API Key first.");
      return;
    }
    setSyncingSteam(true);
    setSyncResult(null);
    try {
      const count = await syncSteamWebApi(steamApiKey.trim(), steamId.trim() || undefined);
      setSyncResult(`Successfully synced ${count} games from Steam!`);
    } catch (err) {
      console.error("Sync failed:", err);
      alert(`Steam sync failed: ${err}`);
    } finally {
      setSyncingSteam(false);
    }
  }

  async function handleBrowseFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Games Directory to Scan",
      });
      if (selected && typeof selected === "string") {
        await addScanFolder(selected);
        await loadScanFolders();
      }
    } catch (err) {
      console.error("Browse failed:", err);
    }
  }

  async function handleAddManualFolder() {
    if (!manualFolderPath.trim()) return;
    try {
      await addScanFolder(manualFolderPath.trim());
      setManualFolderPath("");
      await loadScanFolders();
    } catch (err) {
      alert(`Could not add folder: ${err}`);
    }
  }

  async function handleRemoveFolder(id: number) {
    try {
      await removeScanFolder(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
    } catch (err) {
      console.error("Failed to remove folder:", err);
    }
  }

  async function handleToggleFolder(id: number, current: boolean) {
    try {
      await toggleScanFolder(id, !current);
      setFolders((prev) =>
        prev.map((f) => (f.id === id ? { ...f, enabled: !current } : f))
      );
    } catch (err) {
      console.error("Failed to toggle folder:", err);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain px-6 py-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-gray-100">Settings</h1>
        <p className="text-xs text-gray-500 mt-0.5">Configure Kcache launcher and scanner options</p>
      </div>

      <section className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <UserIcon size={16} className="text-accent-400" />
          <div>
            <h2 className="font-semibold text-gray-200">Account</h2>
            <p className="text-xs text-gray-500">Manage your Kcache profile & sync</p>
          </div>
        </div>

        {session && user ? (
          <div className="flex items-center justify-between bg-surface-900/60 border border-white/5 p-4 rounded-xl">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-accent-600/20 text-accent-400 rounded-full flex items-center justify-center font-bold text-lg">
                {user.user_metadata?.full_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-200">{user.user_metadata?.full_name || "Vault Hunter"}</p>
                <p className="text-xs text-gray-500">{user.email}</p>
              </div>
            </div>
            <button onClick={signOut} className="btn-ghost text-xs flex items-center gap-2 hover:text-red-400">
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        ) : (
          <div className="bg-surface-900/60 border border-info/30 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-200">Guest Mode (Local Only)</p>
              <p className="text-xs text-gray-500 mt-0.5">Sign in to sync your vault across devices.</p>
            </div>
            <Link to="/login" onClick={signOut} className="btn-accent text-xs px-4">
              Sign In to Sync
            </Link>
          </div>
        )}
      </section>

      <section className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Key size={16} className="text-accent-400" />
          <div>
            <h2 className="font-semibold text-gray-200">Steam Web API Integration</h2>
            <p className="text-xs text-gray-500">Automatically sync your owned game library and playtime</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Steam Web API Key</label>
            <input
              type="password"
              className="w-full bg-surface-700 border border-white/5 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-accent-500"
              placeholder="Enter your Steam Web API Key"
              value={steamApiKey}
              onChange={(e) => setSteamApiKey(e.target.value)}
              onBlur={(e) => save("steam_api_key", e.target.value)}
            />
            <p className="text-[11px] text-gray-600 mt-1">
              Obtain your free API key at{" "}
              <a
                href="https://steamcommunity.com/dev/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-accent-400 hover:underline"
              >
                steamcommunity.com/dev/apikey
              </a>
            </p>
          </div>

          <div>
            <label className="text-xs text-gray-400 block mb-1">64-bit Steam ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 bg-surface-700 border border-white/5 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-accent-500"
                placeholder="e.g. 76561198012345678"
                value={steamId}
                onChange={(e) => setSteamId(e.target.value)}
                onBlur={(e) => save("steam_id", e.target.value)}
              />
              <button
                onClick={handleAutoDetectSteamId}
                disabled={detectingSteam}
                className="btn-ghost text-xs whitespace-nowrap"
                title="Read loginusers.vdf from your local Steam config"
              >
                {detectingSteam ? <RefreshCw size={13} className="animate-spin" /> : null}
                Auto-Detect ID
              </button>
            </div>
          </div>

          <div className="pt-1 flex items-center gap-3">
            <button
              onClick={handleSyncSteam}
              disabled={syncingSteam || !steamApiKey.trim()}
              className="btn-accent text-xs"
            >
              {syncingSteam ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Sync Owned Games
            </button>
            {syncResult && <span className="text-xs text-green-400">{syncResult}</span>}
          </div>
        </div>
      </section>

      <section className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Folder size={16} className="text-accent-400" />
          <div>
            <h2 className="font-semibold text-gray-200">Custom Game Scan Folders</h2>
            <p className="text-xs text-gray-500">Directories scanned for .exe games using MFT</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. D:\Games"
              value={manualFolderPath}
              onChange={(e) => setManualFolderPath(e.target.value)}
              className="flex-1 bg-surface-700 border border-white/5 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-accent-500"
            />
            <button onClick={handleAddManualFolder} className="btn-ghost text-xs">
              Add
            </button>
            <button onClick={handleBrowseFolder} className="btn-accent text-xs">
              <FolderPlus size={14} />
              Browse…
            </button>
          </div>

          <div className="divide-y divide-white/5 rounded-xl border border-white/5 bg-surface-900/60 max-h-44 overflow-y-auto">
            {folders.length === 0 ? (
              <p className="p-4 text-xs text-gray-500 text-center">
                No custom folders configured. Default game paths will be checked automatically.
              </p>
            ) : (
              folders.map((f) => (
                <div key={f.id} className="flex items-center justify-between p-3 gap-3">
                  <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={f.enabled}
                      onChange={() => handleToggleFolder(f.id, f.enabled)}
                      className="rounded bg-surface-800 border-white/10 text-accent-500"
                    />
                    <span className={`text-xs font-mono truncate ${f.enabled ? "text-gray-200" : "text-gray-500 line-through"}`}>
                      {f.path}
                    </span>
                  </label>
                  <button
                    onClick={() => handleRemoveFolder(f.id)}
                    className="text-gray-500 hover:text-red-400 p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <EyeOff size={16} className="text-accent-400" />
          <div>
            <h2 className="font-semibold text-gray-200">Removed & Hidden Games</h2>
            <p className="text-xs text-gray-500">
              Games you have removed from Kcache. They will not be scanned or shown in your library.
            </p>
          </div>
        </div>

        <div className="divide-y divide-white/5 rounded-xl border border-white/5 bg-surface-900/60 max-h-52 overflow-y-auto">
          {excludedGames.length === 0 ? (
            <p className="p-4 text-xs text-gray-500 text-center">
              No games currently hidden. Removed games will appear here and can be restored at any time.
            </p>
          ) : (
            excludedGames.map((eg) => (
              <div key={eg.id} className="flex items-center justify-between p-3 gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-200 truncate">{eg.name}</p>
                  <p className="text-[11px] text-gray-500 font-mono truncate">
                    Platform: {eg.platform} {eg.app_id ? `• App #${eg.app_id}` : ""}
                  </p>
                </div>
                <button
                  onClick={() => handleRestoreGame(eg.id)}
                  className="btn-ghost text-xs py-1.5 px-2.5 flex items-center gap-1.5 text-accent-400 hover:text-white border-white/10 hover:border-accent-500/40"
                  title="Restore this game to your library"
                >
                  <RotateCcw size={12} />
                  Restore
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Database size={16} className="text-accent-400" />
          <h2 className="font-semibold text-gray-200">Backup Storage</h2>
        </div>
        <div className="space-y-2">
          <label className="text-xs text-gray-400">Backup directory</label>
          <input
            type="text"
            className="w-full bg-surface-700 border border-white/5 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-accent-500"
            placeholder="Default: Documents\Kcache\Backups"
            value={settings.backup_dir ?? ""}
            onChange={(e) => setSettings((p) => ({ ...p, backup_dir: e.target.value }))}
            onBlur={(e) => save("backup_dir", e.target.value)}
          />
          <p className="text-xs text-gray-600">Leave blank to use the default Documents folder location.</p>
        </div>
      </section>

      <section className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Palette size={16} className="text-accent-400" />
          <h2 className="font-semibold text-gray-200">Appearance</h2>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-300">Theme</p>
              <p className="text-xs text-gray-500">Dark mode is recommended for gaming aesthetics</p>
            </div>
            <select
              className="bg-surface-700 border border-white/5 text-sm text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none"
              value={settings.theme ?? "dark"}
              onChange={(e) => save("theme", e.target.value)}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
        </div>
      </section>

      <section className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Shield size={16} className="text-accent-400" />
          <h2 className="font-semibold text-gray-200">Everything (MFT) Integration</h2>
        </div>
        {everythingStatus ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-300">Status</p>
              <span
                className={`badge ${
                  everythingStatus.http_available
                    ? "bg-green-900/40 text-green-400 border-green-900/40"
                    : everythingStatus.installed
                    ? "bg-amber-900/40 text-amber-400 border-amber-900/40"
                    : "bg-surface-700 text-gray-500 border-white/5"
                }`}
              >
                {everythingStatus.http_available
                  ? "✓ Active (MFT Indexed)"
                  : everythingStatus.installed
                  ? "⚠ Installed (HTTP Server Off)"
                  : "Not installed"}
              </span>
            </div>
            {everythingStatus.installed && !everythingStatus.http_available && (
              <div className="p-3 rounded-lg bg-amber-900/15 border border-amber-900/30 text-xs text-amber-400">
                Everything is installed but its HTTP server is disabled.
                Enable it via: <span className="font-mono">Everything → Tools → Options → HTTP Server</span>.
                This enables millisecond MFT folder scanning and full-system DXVK cache discovery.
              </div>
            )}
            {!everythingStatus.installed && (
              <p className="text-xs text-gray-500">
                Install <strong className="text-gray-300">Everything by voidtools</strong> (free) to enable instant
                MFT-powered executable detection and full-system cache discovery across all drives.
              </p>
            )}
          </div>
        ) : (
          <div className="skeleton h-16 rounded-lg" />
        )}
      </section>
    </div>
  );
}
