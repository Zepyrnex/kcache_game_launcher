import { useState, useEffect } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { TrashRecord } from "../types";
import { getTrash, restoreFromTrash } from "../hooks/useScanner";
import { formatRelativeDate } from "../components/ui";

export function TrashPage() {
  const [items, setItems] = useState<TrashRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    try {
      setItems(await getTrash());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRestore(id: number) {
    setRestoringId(id);
    try {
      await restoreFromTrash(id);
      await load();
    } catch (e) {
      alert("Restore failed: " + JSON.stringify(e));
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-100">Trash</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Soft-deleted caches — can be restored this session
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar touch-pan-y overscroll-contain px-6 py-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-3 text-center">
            <div className="p-5 rounded-2xl bg-surface-800 border border-white/5">
              <Trash2 size={36} className="text-gray-600" />
            </div>
            <p className="text-gray-400 font-medium">Trash is empty</p>
            <p className="text-xs text-gray-600 max-w-xs">
              Deleted shader caches appear here and can be restored. They are permanently removed when you close Kcache.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="glass-card flex items-center gap-4 px-4 py-3 animate-fade-in"
              >
                <Trash2 size={16} className="text-red-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">
                    {item.game_name ?? "Unknown game"}
                  </p>
                  <p className="text-xs font-mono text-gray-500 truncate">
                    {item.original_path}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    Deleted {formatRelativeDate(item.deleted_at)}
                  </p>
                </div>
                <button
                  className="btn-ghost text-xs flex-shrink-0"
                  onClick={() => handleRestore(item.id)}
                  disabled={restoringId === item.id}
                >
                  <RotateCcw size={12} />
                  {restoringId === item.id ? "Restoring…" : "Restore"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
