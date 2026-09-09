import { CacheSource, GamePlatform } from "../types";

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1))} ${sizes[i]}`;
}

export function formatDate(unixTs: number | null): string {
  if (!unixTs || unixTs === 0) return "Never";
  const d = new Date(unixTs * 1000);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatRelativeDate(unixTs: number | null): string {
  if (!unixTs || unixTs === 0) return "Never";
  const now = Date.now() / 1000;
  const diff = now - unixTs;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(unixTs);
}

const PLATFORM_LABELS: Record<GamePlatform, string> = {
  steam:   "Steam",
  epic:    "Epic",
  gog:     "GOG",
  xbox:    "Xbox",
  custom:  "Custom",
  unknown: "Unknown",
};

const PLATFORM_BADGE_CLASS: Record<GamePlatform, string> = {
  steam:   "badge badge-steam",
  epic:    "badge badge-epic",
  gog:     "badge badge-gog",
  xbox:    "badge bg-green-900/40 text-green-300 border border-green-900/40",
  custom:  "badge bg-amber-900/40 text-amber-300 border border-amber-900/40",
  unknown: "badge bg-gray-800/40 text-gray-400 border border-gray-700/40",
};

export function PlatformBadge({ platform }: { platform: GamePlatform }) {
  return (
    <span className={PLATFORM_BADGE_CLASS[platform]}>
      {PLATFORM_LABELS[platform]}
    </span>
  );
}

const SOURCE_LABELS: Record<CacheSource, string> = {
  nvidia_dx:            "NVIDIA DX",
  nvidia_gl:            "NVIDIA GL",
  amd_dx:               "AMD DX",
  amd_dxc:              "AMD DXC",
  intel_shader:         "Intel",
  steam_shader_precache:"Steam",
  dxvk:                 "DXVK",
  vkd3d:                "VKD3D",
  unity_engine:         "Unity",
  unreal_engine:        "Unreal",
  unknown:              "?",
};

const SOURCE_BADGE_CLASS: Record<CacheSource, string> = {
  nvidia_dx:            "badge badge-nvidia",
  nvidia_gl:            "badge badge-nvidia",
  amd_dx:               "badge badge-amd",
  amd_dxc:              "badge badge-amd",
  intel_shader:         "badge badge-intel",
  steam_shader_precache:"badge badge-steam",
  dxvk:                 "badge badge-dxvk",
  vkd3d:                "badge badge-dxvk",
  unity_engine:         "badge bg-gray-800/40 text-gray-300 border border-gray-700",
  unreal_engine:        "badge bg-gray-800/40 text-gray-300 border border-gray-700",
  unknown:              "badge bg-gray-800/40 text-gray-400 border border-gray-700",
};

export function SourceBadge({ source }: { source: CacheSource }) {
  return (
    <span className={SOURCE_BADGE_CLASS[source]}>
      {SOURCE_LABELS[source]}
    </span>
  );
}

const GPU_SOURCES: CacheSource[] = ["nvidia_dx", "nvidia_gl", "amd_dx", "amd_dxc", "intel_shader"];
export function isGpuCache(source: CacheSource): boolean {
  return GPU_SOURCES.includes(source);
}
