import { useState } from "react";
import { Trash2, Archive, RotateCcw, AlertTriangle, X, Check } from "lucide-react";
import { GameCacheGroup, BackupRecord } from "../types";
import { formatBytes, formatRelativeDate } from "./ui";
import {
  softDeleteCache,
  backupCache,
  getBackups,
  restoreFromArchive,
} from "../hooks/useScanner";

interface DeleteProps {
  group: GameCacheGroup;
  onDeleted: () => void;
}

export function DeleteConfirmDialog({ group, onDeleted }: DeleteProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalSize = group.total_cache_size;

  async function handleDelete() {
    setLoading(true);
    setError(null);
    try {

      for (const cache of group.caches) {
        await softDeleteCache(cache.path, group.game.id, group.game.name);
      }
      setOpen(false);
      onDeleted();
    } catch (err: any) {
      const msg = err?.message ?? JSON.stringify(err);
      if (msg.includes("FILE_LOCKED") || msg.includes("locked")) {
        setError("One or more cache files are locked by a running game or driver. Close the game and try again.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        className="btn-danger text-xs py-1.5 px-3"
        onClick={() => setOpen(true)}
        title="Delete shader cache"
      >
        <Trash2 size={13} />
        Delete
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4"
          onClick={() => !loading && setOpen(false)}
        >
          <div
            className="glass-card w-full max-w-md p-6 space-y-4 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 text-amber-400">
                <AlertTriangle size={20} />
                <h3 className="font-semibold text-gray-100">Delete Shader Cache</h3>
              </div>
              <button
                className="text-gray-500 hover:text-gray-300"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs text-gray-400">
              <p>
                You are about to delete the shader cache for{" "}
                <span className="text-gray-200 font-semibold">{group.game.name}</span>.
              </p>

              <div className="bg-surface-800 rounded-lg p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span>Files to remove:</span>
                  <span className="font-mono text-gray-200">{group.caches.length} location(s)</span>
                </div>
                <div className="flex justify-between">
                  <span>Disk space freed:</span>
                  <span className="font-mono text-accent-400 font-semibold">{formatBytes(totalSize)}</span>
                </div>
              </div>

              <div className="rounded-lg bg-surface-800/60 p-3 text-[11px] text-gray-500 space-y-1">
                <p className="font-medium text-gray-400">Safety note:</p>
                <p>
                  Files are moved to the Kcache Trash. You can restore them before closing the app. The game will automatically recompile shaders on next launch.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-900/30 border border-red-800/40 text-red-400 text-xs">
                  {error}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
              <button
                className="btn-ghost text-xs"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="btn-danger text-xs font-semibold"
                onClick={handleDelete}
                disabled={loading}
              >
                {loading ? "Deleting…" : `Delete (${formatBytes(totalSize)})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface BackupProps {
  group: GameCacheGroup;
}

export function BackupRestorePanel({ group }: BackupProps) {
  const [open, setOpen] = useState(false);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loadingBackup, setLoadingBackup] = useState(false);
  const [loadingRestore, setLoadingRestore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadBackups() {
    try {
      const list = await getBackups(group.game.id);
      setBackups(list);
    } catch (_) {}
  }

  async function handleOpen() {
    setOpen(true);
    await loadBackups();
  }

  async function handleBackup() {
    setLoadingBackup(true);
    setError(null);
    setSuccess(null);
    try {
      const paths = group.caches.map((c) => c.path);
      const record = await backupCache(
        group.game.id,
        group.game.name,
        paths
      );
      setSuccess(`Backup created (${formatBytes(record.size_bytes)})`);
      await loadBackups();
    } catch (err: any) {
      setError(err?.message ?? JSON.stringify(err));
    } finally {
      setLoadingBackup(false);
    }
  }

  async function handleRestore(backup: BackupRecord) {
    setLoadingRestore(backup.id);
    setError(null);
    setSuccess(null);
    try {
      const restoreTo = backup.original_paths[0]
        ? backup.original_paths[0].split("\\").slice(0, -1).join("\\")
        : "";
      if (!restoreTo) {
        throw new Error("Cannot determine restore path from backup record.");
      }
      await restoreFromArchive(backup.archive_path, restoreTo);
      setSuccess("Cache restored successfully.");
    } catch (err: any) {
      setError(err?.message ?? JSON.stringify(err));
    } finally {
      setLoadingRestore(null);
    }
  }

  return (
    <>
      <button
        className="btn-ghost text-xs py-1.5 px-3"
        onClick={handleOpen}
        title="Backup / Restore shader cache"
      >
        <Archive size={13} />
        Backup
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-card w-full max-w-lg p-6 space-y-5 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-accent-300">
                <Archive size={18} />
                <h3 className="font-semibold text-gray-100">
                  Backup / Restore — {group.game.name}
                </h3>
              </div>
              <button
                className="text-gray-500 hover:text-gray-300"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-red-900/30 border border-red-800/40 text-red-400 text-xs">
                {error}
              </div>
            )}
            {success && (
              <div className="p-3 rounded-lg bg-green-900/30 border border-green-800/40 text-green-400 text-xs flex items-center gap-1.5">
                <Check size={14} />
                {success}
              </div>
            )}

            <div className="bg-surface-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-gray-200">Current Active Cache</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {group.caches.length} location(s) · {formatBytes(group.total_cache_size)}
                  </p>
                </div>
                <button
                  className="btn-accent text-xs font-semibold"
                  onClick={handleBackup}
                  disabled={loadingBackup || group.caches.length === 0}
                >
                  <Archive size={13} />
                  {loadingBackup ? "Archiving…" : "Create Backup"}
                </button>
              </div>
              {group.caches.length === 0 && (
                <p className="text-[11px] text-gray-500 italic">
                  No caches found to back up.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Saved Backups ({backups.length})
              </p>
              {backups.length === 0 ? (
                <p className="text-xs text-gray-600 py-3 text-center bg-surface-800/40 rounded-lg">
                  No backups found for this game yet.
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {backups.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-surface-800/60 hover:bg-surface-800 transition-colors text-xs"
                    >
                      <div>
                        <p className="font-mono text-gray-300">
                          {formatRelativeDate(b.created_at)}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {formatBytes(b.size_bytes)} compressed
                        </p>
                      </div>
                      <button
                        className="btn-ghost text-xs py-1 px-2.5"
                        onClick={() => handleRestore(b)}
                        disabled={loadingRestore === b.id}
                        title="Restore this backup"
                      >
                        <RotateCcw size={12} />
                        {loadingRestore === b.id ? "Restoring…" : "Restore"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-white/5">
              <button className="btn-ghost text-xs" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CacheActionButtons({
  group,
  onDeleted,
}: {
  group: GameCacheGroup;
  onDeleted: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <BackupRestorePanel group={group} />
      <DeleteConfirmDialog group={group} onDeleted={onDeleted} />
    </div>
  );
}
