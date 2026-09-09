import React from "react";
import { ScanProgress } from "../types";
import { Cpu, Search, Database } from "lucide-react";

interface Props {
  progress: ScanProgress | null;
}

export function ScanProgressBar({ progress }: Props) {
  const stages: { key: string; label: string; icon: React.ReactNode }[] = [
    { key: "library", label: "Game Libraries", icon: <Database size={14} /> },
    { key: "gpu",     label: "GPU Caches",     icon: <Cpu size={14} /> },
    { key: "match",   label: "Matching",        icon: <Search size={14} /> },
  ];

  const stage = progress?.stage ?? "";
  const isGpu    = stage.toLowerCase().includes("gpu") || stage.toLowerCase().includes("nvidia") || stage.toLowerCase().includes("amd");
  const isMatch  = stage.toLowerCase().includes("match") || stage.toLowerCase().includes("saving");
  const isDone   = stage.toLowerCase().includes("complete");

  const activeIndex = isDone ? 3 : isMatch ? 2 : isGpu ? 1 : 0;

  return (
    <div className="space-y-4 py-6 animate-fade-in">

      <div className="flex items-center justify-center gap-2">
        {stages.map((s, i) => (
          <React.Fragment key={s.key}>
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${
                i < activeIndex
                  ? "bg-accent-600/30 text-accent-300 border border-accent-600/40"
                  : i === activeIndex
                  ? "bg-accent-600 text-white shadow-glow-sm"
                  : "bg-surface-700 text-gray-500 border border-white/5"
              }`}
            >
              {s.icon}
              {s.label}
            </div>
            {i < stages.length - 1 && (
              <div className={`h-px w-8 transition-all duration-300 ${i < activeIndex ? "bg-accent-600" : "bg-surface-700"}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-gray-200">
          {progress?.stage ?? "Initializing…"}
        </p>
        {progress?.current_path && (
          <p className="text-xs text-gray-500 font-mono truncate max-w-md mx-auto">
            {progress.current_path}
          </p>
        )}
      </div>

      <div className="max-w-xs mx-auto h-1 bg-surface-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-accent rounded-full animate-pulse-accent"
          style={{ width: isDone ? "100%" : "60%" }}
        />
      </div>

      {(progress?.items_found ?? 0) > 0 && (
        <p className="text-center text-xs text-gray-500">
          Found {progress!.items_found} entries
        </p>
      )}
    </div>
  );
}
