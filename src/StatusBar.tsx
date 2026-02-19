import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface GitInfo {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  last_commit_hash: string;
  last_commit_message: string;
}

interface ChangedFile {
  status: string;
  path: string;
}

type Mode = "build" | "review";

interface StatusBarProps {
  repoPath: string;
  activeMode: Mode;
  onModeChange: (mode: Mode) => void;
}

function statusColor(status: string) {
  switch (status) {
    case "M":
      return "text-[#dcdcaa]";
    case "A":
      return "text-[#6a9955]";
    case "D":
      return "text-[#f44747]";
    default:
      return "text-[#d4d4d4]";
  }
}

export function StatusBar({ repoPath, activeMode, onModeChange }: StatusBarProps) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetch = () => {
      invoke<GitInfo>("git_info", { repoPath }).then(setInfo).catch(() => {});
      invoke<ChangedFile[]>("git_changed_files", { repoPath })
        .then(setFiles)
        .catch(() => {});
    };

    fetch();
    intervalRef.current = window.setInterval(fetch, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [repoPath]);

  // Close popover on click outside
  useEffect(() => {
    if (!showFiles) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowFiles(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showFiles]);

  const tabClass = (mode: Mode) =>
    `px-4 py-0.5 border rounded text-[11px] font-bold tracking-wider cursor-pointer transition-all duration-150 bg-transparent ${
      activeMode === mode
        ? "text-[#e0e0e0] bg-[#2a2a2a] border-[#666]"
        : "text-[#666] border-[#404040] hover:text-[#aaa] hover:border-[#555]"
    }`;

  return (
    <div className="flex items-center justify-between shrink-0 bg-[#181818] border-t border-[#404040] px-3 py-1 text-[11px] font-mono text-[#888] select-none min-h-[28px] gap-4">
      {/* Left: git info */}
      <div className="flex items-center gap-3 shrink-0 overflow-hidden min-w-0 flex-1">
        {info ? (
          <>
            <span className="flex items-center gap-1 text-[#d4d4d4] shrink-0">
              <span className="text-[#888]">⎇</span>
              {info.branch}
            </span>
            <span
              className={`shrink-0 ${info.dirty ? "text-[#dcdcaa]" : "text-[#6a9955]"}`}
              title={info.dirty ? "Uncommitted changes" : "Clean"}
            >
              {info.dirty ? "●" : "○"}
            </span>
            {(info.ahead > 0 || info.behind > 0) && (
              <span className="text-[#888] shrink-0">
                {info.ahead > 0 && `↑${info.ahead}`}
                {info.ahead > 0 && info.behind > 0 && " "}
                {info.behind > 0 && `↓${info.behind}`}
              </span>
            )}
            {info.last_commit_hash && (
              <span className="text-[#666] overflow-hidden text-ellipsis whitespace-nowrap">
                <span className="text-[#888]">{info.last_commit_hash}</span>
                {" "}
                {info.last_commit_message}
              </span>
            )}
          </>
        ) : (
          <span>No git info</span>
        )}
      </div>

      {/* Center: mode tabs */}
      <div className="flex items-center gap-1 shrink-0">
        <button className={tabClass("build")} onClick={() => onModeChange("build")}>
          BUILD
        </button>
        <button className={tabClass("review")} onClick={() => onModeChange("review")}>
          REVIEW
        </button>
      </div>

      {/* Right: changed files summary */}
      <div className="relative flex items-center justify-end flex-1 min-w-0">
        {files.length > 0 ? (
          <button
            className="flex items-center gap-1.5 text-[11px] text-[#888] hover:text-[#ccc] cursor-pointer bg-transparent border-none font-mono"
            onClick={() => setShowFiles(!showFiles)}
          >
            {(() => {
              const counts: Record<string, number> = {};
              for (const f of files) {
                const label = f.status;
                counts[label] = (counts[label] || 0) + 1;
              }
              return Object.entries(counts).map(([label, count]) => (
                <span key={label} className="flex items-center gap-0.5">
                  <span className={`font-bold ${statusColor(label)}`}>{label}</span>
                  <span>{count}</span>
                </span>
              ));
            })()}
            <span className="text-[#555]">({files.length})</span>
          </button>
        ) : (
          <span className="text-[#555]">No changes</span>
        )}

        {showFiles && files.length > 0 && (
          <div
            ref={popoverRef}
            className="absolute bottom-full right-0 mb-1 bg-[#252526] border border-[#404040] rounded shadow-[0_4px_16px_rgba(0,0,0,0.4)] max-h-[300px] w-[320px] overflow-y-auto z-50"
          >
            <div className="px-3 py-1.5 text-[11px] text-[#888] font-semibold uppercase tracking-wider border-b border-[#404040] sticky top-0 bg-[#252526]">
              Changed Files ({files.length})
            </div>
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-[3px] text-[12px] hover:bg-white/[0.05]"
                title={f.path}
              >
                <span className={`font-mono font-bold w-[18px] text-center shrink-0 ${statusColor(f.status)}`}>
                  {f.status}
                </span>
                <span className="text-[#d4d4d4] truncate min-w-0">{f.path}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
