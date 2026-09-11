import { useState, useEffect, useMemo } from "react";
import {
  FolderSearch,
  FolderPlus,
  Trash2,
  Check,
  CheckSquare,
  Square,
  Gamepad2,
  X,
  Zap,
  CheckCircle2,
  Layers,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { ScanFolder, DiscoveredProgram, DetectedGame } from "../types";
import { formatBytes } from "./ui";
import {
  getScanFolders,
  addScanFolder,
  removeScanFolder,
  toggleScanFolder,
  scanCustomFolders,
  addCustomGames,
  getEverythingStatus,
} from "../hooks/useScanner";

interface Props {
  existingGames?: DetectedGame[];
  onClose: () => void;
  onAdded: () => void;
}

export function LibraryScannerDialog({ existingGames = [], onClose, onAdded }: Props) {
  const [tab, setTab] = useState<"folders" | "discovered">("folders");
  const [folders, setFolders] = useState<ScanFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [everythingActive, setEverythingActive] = useState<boolean | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredProgram[]>([]);

  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [names, setNames] = useState<Record<number, string>>({});
  const [addingGames, setAddingGames] = useState(false);

  useEffect(() => {
    loadFolders();
    getEverythingStatus().then((s) => setEverythingActive(s.http_available));
  }, []);

  async function loadFolders() {
    setLoadingFolders(true);
    try {
      const list = await getScanFolders();
      setFolders(list);
    } catch (err) {
      console.error("Failed to load scan folders:", err);
    } finally {
      setLoadingFolders(false);
    }
  }

  async function handleAddFolder() {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Games Directory to Scan",
      });

      if (selectedPath && typeof selectedPath === "string") {
        await addScanFolder(selectedPath);
        await loadFolders();
      }
    } catch (err) {
      console.error("Failed to add folder:", err);
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

  async function handleToggleFolder(id: number, currentEnabled: boolean) {
    try {
      await toggleScanFolder(id, !currentEnabled);
      setFolders((prev) =>
        prev.map((f) => (f.id === id ? { ...f, enabled: !currentEnabled } : f))
      );
    } catch (err) {
      console.error("Failed to toggle folder:", err);
    }
  }

  function checkIsInLibrary(prog: DiscoveredProgram): boolean {
    const normProgExe = prog.exe_path.toLowerCase().replace(/\//g, "\\");
    const normProgFolder = prog.folder_path.toLowerCase().replace(/\//g, "\\");

    return existingGames.some((g) => {
      if (g.exe_path) {
        const normGameExe = g.exe_path.toLowerCase().replace(/\//g, "\\");
        if (normGameExe === normProgExe) return true;
      }
      if (g.app_id && prog.matched_app_id && g.app_id === prog.matched_app_id) {
        return true;
      }
      if (g.install_path) {
        const normInstall = g.install_path.toLowerCase().replace(/\//g, "\\");
        if (normInstall === normProgFolder) return true;
      }
      return false;
    });
  }

  const inLibraryMap = useMemo(() => {
    const map: Record<number, boolean> = {};
    discovered.forEach((p, idx) => {
      map[idx] = checkIsInLibrary(p);
    });
    return map;
  }, [discovered, existingGames]);

  const newProgramsCount = useMemo(() => {
    return discovered.filter((_, idx) => !inLibraryMap[idx]).length;
  }, [discovered, inLibraryMap]);

  async function handleRunScan() {
    setScanning(true);
    setScanError(null);
    try {
      const results = await scanCustomFolders();
      setDiscovered(results);

      const initialSelected: Record<number, boolean> = {};
      const initialNames: Record<number, string> = {};
      results.forEach((p, idx) => {
        initialSelected[idx] = !checkIsInLibrary(p);
        initialNames[idx] = p.suggested_name;
      });
      setSelected(initialSelected);
      setNames(initialNames);

      setTab("discovered");
    } catch (err: any) {
      setScanError(typeof err === "string" ? err : err?.message || JSON.stringify(err));
    } finally {
      setScanning(false);
    }
  }

  function selectNewOnly() {
    const next: Record<number, boolean> = {};
    discovered.forEach((_, idx) => {
      next[idx] = !inLibraryMap[idx];
    });
    setSelected(next);
  }

  function toggleAll(value: boolean) {
    const next: Record<number, boolean> = {};
    discovered.forEach((_, idx) => {
      next[idx] = value;
    });
    setSelected(next);
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  async function handleAddSelected() {
    const toAdd = discovered
      .filter((_, idx) => selected[idx])
      .map((p, idx) => ({
        ...p,
        name: names[idx] || p.suggested_name,
      }));

    if (toAdd.length === 0) return;

    setAddingGames(true);
    try {
      await addCustomGames(toAdd);
      onAdded();
      onClose();
    } catch (err) {
      console.error("Failed to add games:", err);
      alert(`Failed to add games: ${err}`);
    } finally {
      setAddingGames(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-3xl flex flex-col max-h-[85vh] shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent-600/20 text-accent-400 border border-accent-500/30">
              <FolderSearch size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Library & Executable Scanner</h2>
              <p className="text-xs text-gray-500">Scan directories with instant NTFS MFT speed</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-6 pt-3 pb-2 bg-surface-950/60 border-b border-white/5 text-xs">
          <button
            onClick={() => setTab("folders")}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-2 ${
              tab === "folders"
                ? "bg-surface-800 text-white border border-white/10"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            <Layers size={13} />
            Scan Folders ({folders.length})
          </button>

          <button
            onClick={() => setTab("discovered")}
            disabled={discovered.length === 0}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-2 ${
              tab === "discovered"
                ? "bg-surface-800 text-white border border-white/10"
                : discovered.length > 0
                ? "text-gray-400 hover:text-gray-200"
                : "text-gray-600 cursor-not-allowed"
            }`}
          >
            <Gamepad2 size={13} />
            Discovered Games
            {discovered.length > 0 && (
              <span className="badge bg-accent-600/30 text-accent-300 font-mono text-[10px]">
                {newProgramsCount > 0 ? `${newProgramsCount} new` : discovered.length}
              </span>
            )}
          </button>

          {everythingActive !== null && (
            <div
              className={`ml-auto flex items-center gap-1.5 text-[11px] px-2.5 py-0.5 rounded-full border ${
                everythingActive
                  ? "bg-green-950/40 text-green-400 border-green-800/40"
                  : "bg-surface-800 text-gray-500 border-white/5"
              }`}
            >
              <Zap size={11} />
              MFT {everythingActive ? "Active" : "Inactive"}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === "folders" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-200">Configured Scan Folders</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Folders indexed for game executables on your drives.
                  </p>
                </div>
                <button onClick={handleAddFolder} className="btn-ghost text-xs">
                  <FolderPlus size={14} />
                  Add Folder
                </button>
              </div>

              {loadingFolders ? (
                <div className="space-y-2">
                  <div className="skeleton h-12 rounded-xl" />
                  <div className="skeleton h-12 rounded-xl" />
                </div>
              ) : folders.length === 0 ? (
                <div className="p-8 rounded-2xl bg-surface-800/40 border border-dashed border-white/10 text-center space-y-2">
                  <FolderSearch size={28} className="mx-auto text-gray-600" />
                  <p className="text-xs text-gray-400 font-medium">No custom folders configured</p>
                  <p className="text-[11px] text-gray-500 max-w-sm mx-auto">
                    Kcache will scan default Steam libraries and standard game directories (e.g. C:\Games). Add specific folders to discover external or standalone games.
                  </p>
                  <button onClick={handleAddFolder} className="btn-ghost text-xs mt-2">
                    <FolderPlus size={13} />
                    Add Folder Now
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {folders.map((folder) => (
                    <div
                      key={folder.id}
                      className="flex items-center justify-between p-3 rounded-xl bg-surface-800/70 border border-white/5 hover:border-white/10 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={folder.enabled}
                          onChange={() => handleToggleFolder(folder.id, folder.enabled)}
                          className="rounded text-accent-500 focus:ring-0 bg-surface-700 border-white/10 cursor-pointer"
                        />
                        <span
                          className={`text-xs font-mono truncate ${
                            folder.enabled ? "text-gray-200" : "text-gray-500 line-through"
                          }`}
                        >
                          {folder.path}
                        </span>
                      </div>
                      <button
                        onClick={() => handleRemoveFolder(folder.id)}
                        className="btn-danger p-1.5 rounded-lg flex-shrink-0"
                        title="Remove folder from scanner"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-accent-600/10 border border-accent-600/20 text-xs text-accent-300 flex items-start gap-2.5">
                <Zap size={16} className="text-accent-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-accent-200">Instant MFT Speed Scanning</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    Kcache uses Voidtools Everything to read the NTFS Master File Table in milliseconds, detecting game executables across millions of files without sluggish directory walks.
                  </p>
                </div>
              </div>

              {scanError && (
                <div className="p-3 rounded-xl bg-red-900/30 border border-red-800/40 text-red-400 text-xs">
                  {scanError}
                </div>
              )}
            </div>
          )}

          {tab === "discovered" && (
            <div className="space-y-3">

              <div className="flex items-center justify-between pb-2 border-b border-white/5 text-xs text-gray-400">
                <div className="flex items-center gap-3">
                  <button
                    onClick={selectNewOnly}
                    className="text-accent-400 hover:text-accent-300 font-medium transition-colors"
                  >
                    Select New Only
                  </button>
                  <span>·</span>
                  <button onClick={() => toggleAll(true)} className="hover:text-gray-200 transition-colors">
                    Select All
                  </button>
                  <span>·</span>
                  <button onClick={() => toggleAll(false)} className="hover:text-gray-200 transition-colors">
                    Deselect All
                  </button>
                </div>
                <span className="font-mono text-accent-400 font-medium">
                  {selectedCount} selected
                </span>
              </div>

              <div className="divide-y divide-white/5">
                {discovered.map((prog, idx) => {
                  const isChecked = !!selected[idx];
                  const inLib = !!inLibraryMap[idx];

                  return (
                    <div
                      key={prog.exe_path}
                      onClick={() => setSelected((prev) => ({ ...prev, [idx]: !isChecked }))}
                      className={`flex items-center gap-4 p-3 rounded-xl transition-colors cursor-pointer ${
                        isChecked
                          ? "bg-surface-800/70"
                          : inLib
                          ? "bg-surface-950/40 opacity-70 hover:opacity-90"
                          : "hover:bg-white/5 opacity-60"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected((prev) => ({ ...prev, [idx]: !isChecked }));
                        }}
                        className="text-accent-400"
                      >
                        {isChecked ? (
                          <CheckSquare size={18} />
                        ) : (
                          <Square size={18} className="text-gray-600" />
                        )}
                      </button>

                      <div className="w-10 h-14 rounded-lg bg-surface-950 border border-white/5 overflow-hidden flex-shrink-0 relative">
                        {prog.matched_cover_url ? (
                          <img
                            src={prog.matched_cover_url}
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

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={names[idx] ?? prog.suggested_name}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setNames((prev) => ({ ...prev, [idx]: e.target.value }))}
                            className="bg-surface-700/60 hover:bg-surface-700 focus:bg-surface-700 border border-transparent focus:border-accent-500 rounded px-2 py-0.5 text-sm font-medium text-white focus:outline-none flex-1 max-w-sm"
                          />
                          {inLib && (
                            <span className="badge bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 text-[10px] flex items-center gap-1 flex-shrink-0">
                              <CheckCircle2 size={10} />
                              In Library
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-mono text-gray-500 truncate" title={prog.exe_path}>
                          {prog.exe_path}
                        </p>
                      </div>

                      <div className="text-right flex-shrink-0 space-y-1">
                        <p className="text-xs font-mono text-gray-400">{formatBytes(prog.size_bytes)}</p>
                        {prog.matched_app_id && (
                          <span className="badge bg-blue-950/60 text-blue-400 border border-blue-800/40 text-[10px]">
                            Steam #{prog.matched_app_id}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-white/5 bg-surface-950/40">
          <p className="text-xs text-gray-500">
            {tab === "folders"
              ? "Click 'Scan Folders Now' to query MFT for game executables."
              : `${selectedCount} game(s) selected to add to your library.`}
          </p>

          <div className="flex items-center gap-3">
            <button onClick={onClose} className="btn-ghost text-xs">
              Close
            </button>

            {tab === "folders" ? (
              <button
                onClick={handleRunScan}
                disabled={scanning}
                className="btn-accent text-xs font-semibold"
              >
                <Zap size={14} className={scanning ? "animate-spin" : ""} />
                {scanning ? "Scanning…" : "Scan Folders Now"}
              </button>
            ) : (
              <button
                onClick={handleAddSelected}
                disabled={selectedCount === 0 || addingGames}
                className="btn-accent text-xs font-semibold"
              >
                <Check size={14} />
                {addingGames ? "Adding…" : `Add ${selectedCount} Selected Games`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
