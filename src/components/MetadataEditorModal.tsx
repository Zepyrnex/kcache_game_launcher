import { useState } from "react";
import { Search, Sparkles, X, Check, RefreshCw } from "lucide-react";
import { DetectedGame, SteamSearchResult, SteamAppDetails } from "../types";
import {
  searchSteamGames,
  fetchSteamMetadata,
  updateGameMetadata,
} from "../hooks/useScanner";

interface Props {
  game: DetectedGame;
  onClose: () => void;
  onUpdated: () => void;
}

export function MetadataEditorModal({ game, onClose, onUpdated }: Props) {
  const [searchTerm, setSearchTerm] = useState(game.name);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SteamSearchResult[]>([]);
  const [directAppId, setDirectAppId] = useState(game.app_id || "");
  const [loadingAppId, setLoadingAppId] = useState(false);
  const [previewDetails, setPreviewDetails] = useState<SteamAppDetails | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSearch() {
    if (!searchTerm.trim()) return;
    setSearching(true);
    try {
      const results = await searchSteamGames(searchTerm.trim());
      setSearchResults(results);
    } catch (err) {
      console.error("Search failed:", err);
      alert(`Steam search failed: ${err}`);
    } finally {
      setSearching(false);
    }
  }

  async function handleSelectResult(appId: string | number) {
    const idStr = appId.toString();
    setDirectAppId(idStr);
    setLoadingAppId(true);
    try {
      const details = await fetchSteamMetadata(idStr);
      setPreviewDetails(details);
    } catch (err) {
      console.error("Fetch metadata failed:", err);
      alert(`Failed to fetch Steam details: ${err}`);
    } finally {
      setLoadingAppId(false);
    }
  }

  async function handleApply() {
    if (!previewDetails && !directAppId.trim()) return;

    setSaving(true);
    try {
      if (previewDetails) {
        await updateGameMetadata({
          gameId: game.id,
          name: previewDetails.name || game.name,
          appId: previewDetails.app_id,
          coverUrl: previewDetails.cover_url,
          heroUrl: previewDetails.hero_url,
          logoUrl: previewDetails.logo_url,
          description: previewDetails.short_description,
          genres: previewDetails.genres,
          developer: previewDetails.developers.join(", "),
          publisher: previewDetails.publishers.join(", "),
          releaseDate: previewDetails.release_date ?? undefined,
        });
      } else {

        const appId = directAppId.trim();
        await updateGameMetadata({
          gameId: game.id,
          appId,
          coverUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg`,
          heroUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg`,
          logoUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/logo.png`,
        });
      }

      onUpdated();
      onClose();
    } catch (err) {
      console.error("Failed to apply metadata:", err);
      alert(`Could not save metadata: ${err}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-surface-900 border border-white/10 rounded-2xl w-full max-w-2xl flex flex-col max-h-[90vh] shadow-2xl overflow-hidden">

        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent-600/20 text-accent-400 border border-accent-600/30">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Match Steam Artwork & Details</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Link "{game.name}" to Steam to download vertical covers, hero banners, and synopsis
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto flex-1">

          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-300">Search Steam Store by Title</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  placeholder="Enter game title to search…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="w-full bg-surface-800 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-accent-500"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={searching}
                className="btn-accent text-xs whitespace-nowrap"
              >
                {searching ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
                Search
              </button>
            </div>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs text-gray-400">Search Results</span>
              <div className="max-h-44 overflow-y-auto divide-y divide-white/5 rounded-xl border border-white/5 bg-surface-950/60">
                {searchResults.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelectResult(item.id)}
                    className="w-full flex items-center gap-3 p-2.5 text-left hover:bg-white/5 transition-colors group"
                  >
                    <img
                      src={item.tiny_image}
                      alt=""
                      className="w-16 h-8 object-cover rounded bg-surface-800"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-200 group-hover:text-accent-300 truncate">
                        {item.name}
                      </p>
                      <p className="text-[10px] text-gray-500 font-mono">AppID: {item.id}</p>
                    </div>
                    <span className="badge bg-surface-800 text-gray-400 group-hover:bg-accent-600/30 group-hover:text-accent-300 text-[10px]">
                      Select
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-300">Or Enter Exact Steam App ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. 620"
                value={directAppId}
                onChange={(e) => setDirectAppId(e.target.value)}
                className="flex-1 bg-surface-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono placeholder-gray-500 focus:outline-none focus:border-accent-500"
              />
              <button
                onClick={() => handleSelectResult(directAppId)}
                disabled={loadingAppId || !directAppId.trim()}
                className="btn-ghost text-xs"
              >
                {loadingAppId ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Fetch Details
              </button>
            </div>
          </div>

          {previewDetails ? (
            <div className="p-4 rounded-xl bg-surface-950 border border-white/10 space-y-3">
              <span className="text-xs uppercase font-semibold text-accent-400 tracking-wider">
                Preview Metadata
              </span>

              <div className="flex gap-4">

                <div className="w-24 aspect-[2/3] rounded-lg overflow-hidden bg-surface-900 border border-white/10 flex-shrink-0 shadow-lg">
                  <img
                    src={previewDetails.cover_url}
                    alt="Cover"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = previewDetails.header_image;
                    }}
                  />
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <h3 className="text-sm font-bold text-white truncate">{previewDetails.name}</h3>
                  <div className="flex gap-1.5 flex-wrap">
                    {previewDetails.genres.map((g) => (
                      <span key={g} className="badge bg-surface-800 text-gray-300 text-[10px]">
                        {g}
                      </span>
                    ))}
                  </div>
                  {previewDetails.release_date && (
                    <p className="text-[11px] text-gray-400">Release: {previewDetails.release_date}</p>
                  )}
                  {previewDetails.short_description && (
                    <p className="text-xs text-gray-400 line-clamp-3 leading-relaxed">
                      {previewDetails.short_description.replace(/<[^>]*>?/gm, "")}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-white/5 bg-surface-950/40">
          <button onClick={onClose} className="btn-ghost text-xs">
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={saving || (!previewDetails && !directAppId.trim())}
            className="btn-accent text-xs font-semibold"
          >
            <Check size={14} />
            {saving ? "Applying…" : "Apply Steam Artwork & Metadata"}
          </button>
        </div>
      </div>
    </div>
  );
}
