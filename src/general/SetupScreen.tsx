import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";

const STORAGE_KEY = "recentFolders";
const MAX_RECENT = 5;

function loadRecentFolders(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveRecentFolder(path: string, existing: string[]): string[] {
  const updated = [path, ...existing.filter((p) => p !== path)].slice(
    0,
    MAX_RECENT
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

function folderName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

interface SetupScreenProps {
  onSelect: (folderPath: string) => void;
}

export function SetupScreen({ onSelect }: SetupScreenProps) {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);

  useEffect(() => {
    setRecentFolders(loadRecentFolders());
  }, []);

  const selectFolder = (path: string) => {
    setRecentFolders(saveRecentFolder(path, recentFolders));
    onSelect(path);
  };

  const handleOpen = async () => {
    const path = await open({ directory: true, multiple: false });
    if (path) {
      selectFolder(path);
    }
  };

  return (
    <div className="flex items-center justify-center h-screen bg-[#121212]">
      <div className="flex flex-col items-center gap-6 bg-[#1e1e1e] border border-[#333] rounded-xl px-12 py-10 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <h1 className="text-[22px] font-bold text-[#e0e0e0] tracking-wide m-0">
          greenlite
        </h1>
        <p className="text-[13px] text-[#888] m-0">
          Select a project folder to get started
        </p>
        <button
          className="px-6 py-2.5 border border-[#555] rounded-md bg-[#2a2a2a] text-[#e0e0e0] cursor-pointer text-[13px] font-semibold tracking-wider hover:bg-[#333] hover:border-[#777] transition-all duration-150"
          onClick={handleOpen}
        >
          Open Folder
        </button>
        {recentFolders.length > 0 && (
          <div className="flex flex-col gap-1 w-full mt-2">
            <span className="text-[11px] text-[#666] uppercase tracking-widest mb-1">
              Recent
            </span>
            {recentFolders.map((path) => (
              <button
                key={path}
                className="flex flex-col items-start gap-0.5 w-full px-3 py-2 rounded-md bg-transparent border border-transparent text-left cursor-pointer hover:bg-[#2a2a2a] hover:border-[#444] transition-all duration-150"
                onClick={() => selectFolder(path)}
              >
                <span className="text-[13px] text-[#e0e0e0] font-medium">
                  {folderName(path)}
                </span>
                <span className="text-[11px] text-[#666] truncate max-w-full">
                  {path}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
