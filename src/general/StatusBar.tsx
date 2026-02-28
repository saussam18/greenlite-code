import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TerminalCommandSetting } from "./SetupScreen";

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
  onChangeProject: () => void;
  terminalSetting: TerminalCommandSetting;
  customCommand?: string;
  onChangeTerminalCommand: (setting: TerminalCommandSetting, customCmd?: string) => void;
}

const TERMINAL_LABELS: Record<TerminalCommandSetting, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  copilot: "Copilot",
  custom: "Custom",
  none: "None",
};

const TERMINAL_OPTIONS: { value: TerminalCommandSetting; label: string }[] = [
  { value: "claude", label: "Claude Code" },
  { value: "opencode", label: "OpenCode" },
  { value: "copilot", label: "GitHub Copilot" },
  { value: "custom", label: "Custom..." },
  { value: "none", label: "None (bare shell)" },
];

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

export function StatusBar({ repoPath, activeMode, onModeChange, onChangeProject, terminalSetting, customCommand, onChangeTerminalCommand }: StatusBarProps) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const [showCommit, setShowCommit] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranchName, setNewBranchName] = useState("");
  const [showTerminalPicker, setShowTerminalPicker] = useState(false);
  const [terminalCustomCmd, setTerminalCustomCmd] = useState("");
  const intervalRef = useRef<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const commitInputRef = useRef<HTMLTextAreaElement>(null);
  const commitDialogRef = useRef<HTMLDivElement>(null);
  const branchPopoverRef = useRef<HTMLDivElement>(null);
  const newBranchInputRef = useRef<HTMLInputElement>(null);
  const terminalPickerRef = useRef<HTMLDivElement>(null);

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

  // Close branch popover on click outside
  useEffect(() => {
    if (!showBranches) return;
    const handleClick = (e: MouseEvent) => {
      if (branchPopoverRef.current && !branchPopoverRef.current.contains(e.target as Node)) {
        setShowBranches(false);
        setNewBranchName("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showBranches]);

  useEffect(() => {
    if (showCommit && commitInputRef.current) {
      commitInputRef.current.focus();
    }
  }, [showCommit]);

  // Close commit dialog on click outside
  useEffect(() => {
    if (!showCommit) return;
    const handleClick = (e: MouseEvent) => {
      if (commitDialogRef.current && !commitDialogRef.current.contains(e.target as Node)) {
        setShowCommit(false);
        setCommitMsg("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCommit]);

  const openBranchSwitcher = async () => {
    try {
      const list = await invoke<string[]>("git_list_branches", { repoPath });
      console.log("git_list_branches result:", list);
      setBranches(list);
    } catch (e) {
      console.error("git_list_branches failed:", e);
      setBranches([]);
    }
    setShowBranches(true);
  };

  const handleCheckout = async (branch: string, isNew: boolean) => {
    try {
      await invoke("git_checkout", { repoPath, branch, newBranch: isNew });
      setShowBranches(false);
      setNewBranchName("");
    } catch (e) {
      alert(`Checkout failed: ${e}`);
    }
  };

  const handleCommitAndPush = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      await invoke("git_commit_and_push", { repoPath, message: commitMsg.trim() });
      setCommitMsg("");
      setShowCommit(false);
    } catch (e) {
      alert(`Commit failed: ${e}`);
    } finally {
      setCommitting(false);
    }
  };

  const handleRevert = async () => {
    if (!window.confirm("Revert ALL changes? This cannot be undone.")) return;
    try {
      await invoke("git_revert_all", { repoPath });
    } catch (e) {
      alert(`Revert failed: ${e}`);
    }
  };

  // Close terminal picker on click outside
  useEffect(() => {
    if (!showTerminalPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (terminalPickerRef.current && !terminalPickerRef.current.contains(e.target as Node)) {
        setShowTerminalPicker(false);
        setTerminalCustomCmd("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showTerminalPicker]);

  const terminalDisplayLabel = terminalSetting === "custom" && customCommand
    ? customCommand
    : TERMINAL_LABELS[terminalSetting];

  const tabClass = (mode: Mode) =>
    `px-5 py-1.5 border rounded text-[14px] font-bold tracking-wider cursor-pointer transition-all duration-150 bg-transparent ${
      activeMode === mode
        ? "text-[#e0e0e0] bg-[#2a2a2a] border-[#666]"
        : "text-[#666] border-[#404040] hover:text-[#aaa] hover:border-[#555]"
    }`;

  return (
    <div className="flex items-center justify-between shrink-0 bg-[#181818] border-t border-[#404040] px-5 py-4 text-[14px] font-mono text-[#888] select-none min-h-[56px] gap-5">
      {/* Left: project name + git info */}
      <div className="flex items-center gap-4 shrink-0 min-w-0 flex-1">
        <button
          className="flex items-center gap-2 text-[14px] text-[#d4d4d4] hover:text-white cursor-pointer bg-transparent border-none font-mono shrink-0"
          onClick={onChangeProject}
          title="Switch project"
        >
          <span className="text-[#888]">📁</span>
          {repoPath.split("/").pop()}
        </button>
        <span className="text-[#404040] shrink-0">│</span>
        <div className="relative shrink-0">
          <button
            className="flex items-center gap-1.5 text-[13px] text-[#888] hover:text-[#ccc] cursor-pointer bg-transparent border-none font-mono shrink-0"
            onClick={() => setShowTerminalPicker(!showTerminalPicker)}
            title="Change terminal command (takes effect on next terminal)"
          >
            <span className="text-[#569cd6]">&gt;_</span>
            <span>{terminalDisplayLabel}</span>
            <span className="text-[#555] text-[11px]">▼</span>
          </button>
          {showTerminalPicker && (
            <div
              ref={terminalPickerRef}
              className="absolute bottom-full left-0 mb-2 bg-[#252526] border border-[#404040] rounded shadow-[0_4px_16px_rgba(0,0,0,0.4)] w-[240px] z-50"
            >
              <div className="px-4 py-2.5 text-[13px] text-[#888] font-semibold uppercase tracking-wider border-b border-[#404040] sticky top-0 bg-[#252526]">
                Terminal Command
              </div>
              {TERMINAL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`flex items-center gap-3 w-full px-4 py-[8px] text-[14px] text-left bg-transparent border-none font-mono cursor-pointer hover:bg-white/[0.05] ${
                    opt.value === terminalSetting ? "text-[#569cd6]" : "text-[#d4d4d4]"
                  }`}
                  onClick={() => {
                    if (opt.value === "custom") {
                      // Don't close — show custom input
                      return;
                    }
                    onChangeTerminalCommand(opt.value);
                    setShowTerminalPicker(false);
                  }}
                >
                  <span className="w-[16px] shrink-0 text-[12px]">
                    {opt.value === terminalSetting ? "●" : ""}
                  </span>
                  <span>{opt.label}</span>
                </button>
              ))}
              <form
                className="flex items-center gap-2 px-3 py-2.5 border-t border-[#404040]"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (terminalCustomCmd.trim()) {
                    onChangeTerminalCommand("custom", terminalCustomCmd.trim());
                    setShowTerminalPicker(false);
                    setTerminalCustomCmd("");
                  }
                }}
              >
                <input
                  type="text"
                  className="bg-[#1e1e1e] border border-[#555] rounded text-[13px] text-[#d4d4d4] px-2.5 py-1 h-[30px] flex-1 min-w-0 font-mono outline-none focus:border-[#888]"
                  placeholder="Custom command..."
                  value={terminalCustomCmd}
                  onChange={(e) => setTerminalCustomCmd(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={!terminalCustomCmd.trim()}
                  className="px-2.5 py-1 border rounded text-[13px] font-bold cursor-pointer bg-transparent text-[#569cd6] border-[#569cd6] hover:bg-[#569cd6]/20 disabled:opacity-40 disabled:cursor-default h-[30px] shrink-0"
                >
                  Set
                </button>
              </form>
            </div>
          )}
        </div>
        <span className="text-[#404040] shrink-0">│</span>
        {info ? (
          <>
            <div className="relative shrink-0">
              <button
                className="flex items-center gap-2 text-[#d4d4d4] bg-transparent border-none font-mono text-[14px] cursor-pointer hover:text-white shrink-0"
                onClick={openBranchSwitcher}
                title="Switch branch"
              >
                <span className="text-[#888]">⎇</span>
                {info.branch}
                <span className="text-[#555] text-[11px]">▼</span>
              </button>
              {showBranches && (
                <div
                  ref={branchPopoverRef}
                  className="absolute bottom-full left-0 mb-2 bg-[#252526] border border-[#404040] rounded shadow-[0_4px_16px_rgba(0,0,0,0.4)] max-h-[400px] w-[280px] overflow-y-auto z-50"
                >
                  <div className="px-4 py-2.5 text-[13px] text-[#888] font-semibold uppercase tracking-wider border-b border-[#404040] sticky top-0 bg-[#252526]">
                    Branches
                  </div>
                  {/* New branch input */}
                  <form
                    className="flex items-center gap-2 px-3 py-2.5 border-b border-[#404040]"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newBranchName.trim()) handleCheckout(newBranchName.trim(), true);
                    }}
                  >
                    <input
                      ref={newBranchInputRef}
                      type="text"
                      className="bg-[#1e1e1e] border border-[#555] rounded text-[14px] text-[#d4d4d4] px-2.5 py-1 h-[32px] flex-1 min-w-0 font-mono outline-none focus:border-[#888]"
                      placeholder="New branch…"
                      value={newBranchName}
                      onChange={(e) => setNewBranchName(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="submit"
                      disabled={!newBranchName.trim()}
                      className="px-2.5 py-1 border rounded text-[14px] font-bold cursor-pointer bg-transparent text-[#6a9955] border-[#6a9955] hover:bg-[#6a9955]/20 disabled:opacity-40 disabled:cursor-default h-[32px] shrink-0"
                    >
                      +
                    </button>
                  </form>
                  {/* Existing branches */}
                  {branches.map((b) => (
                    <button
                      key={b}
                      className={`flex items-center gap-3 w-full px-4 py-[8px] text-[14px] text-left bg-transparent border-none font-mono cursor-pointer hover:bg-white/[0.05] ${
                        b === info.branch ? "text-[#6a9955]" : "text-[#d4d4d4]"
                      }`}
                      onClick={() => {
                        if (b !== info.branch) handleCheckout(b, false);
                      }}
                    >
                      <span className="w-[16px] shrink-0 text-[12px]">
                        {b === info.branch ? "●" : ""}
                      </span>
                      <span className="truncate min-w-0">{b}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
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
      <div className="flex items-center gap-2 shrink-0">
        <button className={tabClass("build")} onClick={() => onModeChange("build")}>
          BUILD
        </button>
        <button className={tabClass("review")} onClick={() => onModeChange("review")}>
          REVIEW
        </button>
      </div>

      {/* Right: git actions + changed files summary */}
      <div className="relative flex items-center justify-end flex-1 min-w-0 gap-3">
        {/* Commit + Push */}
        <button
          disabled={!info?.dirty}
          onClick={() => setShowCommit(true)}
          className={`px-3 py-1.5 border rounded text-[14px] font-bold tracking-wider cursor-pointer bg-transparent disabled:opacity-40 disabled:cursor-default shrink-0 ${
            showCommit
              ? "text-[#6a9955] border-[#6a9955] bg-[#6a9955]/20"
              : "text-[#6a9955] border-[#6a9955]/50 hover:bg-[#6a9955]/20 hover:border-[#6a9955]"
          }`}
        >
          Commit &amp; Push
        </button>

        {showCommit && (
          <div
            ref={commitDialogRef}
            className="absolute bottom-full right-0 mb-2 bg-[#252526] border border-[#404040] rounded shadow-[0_4px_16px_rgba(0,0,0,0.4)] w-[460px] z-50"
          >
            <div className="px-4 py-2.5 text-[13px] text-[#888] font-semibold uppercase tracking-wider border-b border-[#404040]">
              Commit &amp; Push
            </div>
            <div className="p-4">
              <textarea
                ref={commitInputRef}
                className="w-full min-h-[140px] bg-[#1e1e1e] border border-[#555] rounded text-[15px] text-[#d4d4d4] px-4 py-3 font-mono outline-none focus:border-[#6a9955] resize-y"
                placeholder="Commit message…"
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                disabled={committing}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleCommitAndPush();
                  }
                  if (e.key === "Escape") {
                    setShowCommit(false);
                    setCommitMsg("");
                  }
                }}
              />
              <div className="flex items-center justify-between mt-3">
                <span className="text-[13px] text-[#555]">
                  {files.length} changed file{files.length !== 1 ? "s" : ""}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[12px] text-[#555]">Cmd+Enter to submit</span>
                  <button
                    type="button"
                    onClick={() => { setShowCommit(false); setCommitMsg(""); }}
                    className="px-4 py-1.5 border rounded text-[13px] font-bold cursor-pointer bg-transparent text-[#888] border-[#404040] hover:text-[#ccc] hover:border-[#555]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCommitAndPush}
                    disabled={!commitMsg.trim() || committing}
                    className="px-4 py-1.5 border rounded text-[13px] font-bold tracking-wider cursor-pointer bg-transparent text-[#6a9955] border-[#6a9955] hover:bg-[#6a9955]/20 disabled:opacity-40 disabled:cursor-default"
                  >
                    {committing ? "Pushing…" : "Commit & Push"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Revert All */}
        <button
          disabled={!info?.dirty}
          onClick={handleRevert}
          className="px-3 py-1.5 border rounded text-[14px] font-bold tracking-wider cursor-pointer bg-transparent text-[#f44747] border-[#f44747]/50 hover:bg-[#f44747]/20 disabled:opacity-40 disabled:cursor-default shrink-0"
        >
          Revert
        </button>

        <span className="text-[#404040] shrink-0">│</span>

        {files.length > 0 ? (
          <button
            className="flex items-center gap-2 text-[14px] text-[#888] hover:text-[#ccc] cursor-pointer bg-transparent border-none font-mono"
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
            className="absolute bottom-full right-0 mb-2 bg-[#252526] border border-[#404040] rounded shadow-[0_4px_16px_rgba(0,0,0,0.4)] max-h-[400px] w-[400px] overflow-y-auto z-50"
          >
            <div className="px-4 py-2.5 text-[13px] text-[#888] font-semibold uppercase tracking-wider border-b border-[#404040] sticky top-0 bg-[#252526]">
              Changed Files ({files.length})
            </div>
            {files.map((f, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-[7px] text-[14px] hover:bg-white/[0.05]"
                title={f.path}
              >
                <span className={`font-mono font-bold w-[22px] text-center shrink-0 ${statusColor(f.status)}`}>
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
