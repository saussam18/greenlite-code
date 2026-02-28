import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { TerminalCommandSetting, ProjectSettings, SetupScreenProps } from "../types/settings";
import { getProjectSettings, saveProjectSettings } from "./settingsUtils";
import logo from "../assets/GreenliteCodeLogo.png";

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

const TERMINAL_OPTIONS: { value: TerminalCommandSetting; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Launch claude in terminal" },
  { value: "opencode", label: "OpenCode", description: "Launch opencode in terminal" },
  { value: "copilot", label: "GitHub Copilot", description: "Launch copilot in terminal" },
  { value: "custom", label: "Custom", description: "Enter a custom command" },
  { value: "none", label: "None", description: "Open a bare shell" },
];

export function SetupScreen({ onSelect }: SetupScreenProps) {
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [customCmd, setCustomCmd] = useState("");

  useEffect(() => {
    setRecentFolders(loadRecentFolders());
  }, []);

  const selectFolder = (path: string) => {
    setRecentFolders(saveRecentFolder(path, recentFolders));
    // Check if project already has a saved terminal setting
    const existing = getProjectSettings(path);
    if (existing) {
      onSelect(path);
    } else {
      setPendingPath(path);
    }
  };

  const handleOpen = async () => {
    const path = await open({ directory: true, multiple: false });
    if (path) {
      selectFolder(path);
    }
  };

  const handleTerminalSelect = (setting: TerminalCommandSetting) => {
    if (!pendingPath) return;
    if (setting === "custom") return; // handled by the custom input submit
    const settings: ProjectSettings = { terminalCommand: setting };
    saveProjectSettings(pendingPath, settings);
    onSelect(pendingPath);
  };

  const handleCustomSubmit = () => {
    if (!pendingPath || !customCmd.trim()) return;
    const settings: ProjectSettings = { terminalCommand: "custom", customCommand: customCmd.trim() };
    saveProjectSettings(pendingPath, settings);
    onSelect(pendingPath);
  };

  // Terminal command picker step
  if (pendingPath) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#121212]">
        <div className="flex flex-col items-center gap-6 bg-[#1e1e1e] border border-[#333] rounded-xl px-12 py-10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] max-w-[420px] w-full">
          <img src={logo} alt="Greenlite" className="w-12 h-12" />
          <h2 className="text-[18px] font-bold text-[#e0e0e0] tracking-wide m-0">
            Terminal Command
          </h2>
          <p className="text-[13px] text-[#888] m-0 text-center">
            Choose what to launch in the terminal for<br />
            <span className="text-[#d4d4d4] font-medium">{folderName(pendingPath)}</span>
          </p>
          <div className="flex flex-col gap-2 w-full">
            {TERMINAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className="flex items-center justify-between w-full px-4 py-3 rounded-md bg-[#2a2a2a] border border-[#404040] text-left cursor-pointer hover:bg-[#333] hover:border-[#555] transition-all duration-150"
                onClick={() => handleTerminalSelect(opt.value)}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] text-[#e0e0e0] font-medium">{opt.label}</span>
                  <span className="text-[11px] text-[#666]">{opt.description}</span>
                </div>
                {opt.value !== "custom" && (
                  <span className="text-[#555] text-[12px]">&rarr;</span>
                )}
              </button>
            ))}
          </div>
          {/* Custom command input — always visible below the "Custom" button area */}
          <form
            className="flex items-center gap-2 w-full"
            onSubmit={(e) => { e.preventDefault(); handleCustomSubmit(); }}
          >
            <input
              type="text"
              className="flex-1 bg-[#1e1e1e] border border-[#555] rounded text-[13px] text-[#d4d4d4] px-3 py-2 font-mono outline-none focus:border-[#888]"
              placeholder="Custom command..."
              value={customCmd}
              onChange={(e) => setCustomCmd(e.target.value)}
            />
            <button
              type="submit"
              disabled={!customCmd.trim()}
              className="px-4 py-2 border border-[#555] rounded text-[13px] font-semibold cursor-pointer bg-[#2a2a2a] text-[#e0e0e0] hover:bg-[#333] disabled:opacity-40 disabled:cursor-default"
            >
              Go
            </button>
          </form>
          <button
            className="text-[12px] text-[#666] hover:text-[#aaa] cursor-pointer bg-transparent border-none mt-1"
            onClick={() => setPendingPath(null)}
          >
            &larr; Back to folder selection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-screen bg-[#121212]">
      <div className="flex flex-col items-center gap-6 bg-[#1e1e1e] border border-[#333] rounded-xl px-12 py-10 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <img src={logo} alt="Greenlite" className="w-16 h-16" />
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
