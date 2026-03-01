import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Send } from "lucide-react";
import type { TerminalCommandSetting, Mode } from "../types/settings";
import type { ReviewInfo } from "../types/review";
import type { GitInfo, ChangedFile } from "../types/git";
import { TerminalPicker } from "./StatusBar/TerminalPicker";
import { BranchSwitcher } from "./StatusBar/BranchSwitcher";
import { CommitDialog } from "./StatusBar/CommitDialog";
import { ChangedFilesPopover } from "./StatusBar/ChangedFilesPopover";
import { CommentsMenu } from "./StatusBar/CommentsMenu";

interface StatusBarProps {
  repoPath: string;
  activeMode: Mode;
  onModeChange: (mode: Mode) => void;
  onChangeProject: () => void;
  terminalSetting: TerminalCommandSetting;
  customCommand?: string;
  onChangeTerminalCommand: (setting: TerminalCommandSetting, customCmd?: string) => void;
  reviewInfo?: ReviewInfo | null;
}

export function StatusBar({ repoPath, activeMode, onModeChange, onChangeProject, terminalSetting, customCommand, onChangeTerminalCommand, reviewInfo }: StatusBarProps) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const intervalRef = useRef<number | null>(null);

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

  const handleRevert = async () => {
    if (!window.confirm("Revert ALL changes? This cannot be undone.")) return;
    try {
      await invoke("git_revert_all", { repoPath });
    } catch (e) {
      alert(`Revert failed: ${e}`);
    }
  };

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

        <TerminalPicker
          terminalSetting={terminalSetting}
          customCommand={customCommand}
          onChangeTerminalCommand={onChangeTerminalCommand}
        />

        <span className="text-[#404040] shrink-0">│</span>
        {info ? (
          <>
            <BranchSwitcher repoPath={repoPath} info={info} />
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

      {/* Right: actions */}
      <div className="relative flex items-center justify-end flex-1 min-w-0 gap-3">
        {reviewInfo && (
          <>
            <CommentsMenu reviewInfo={reviewInfo} />

            <button
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[#4e9a06] rounded bg-[#2e6b30] text-[#e0e0e0] cursor-pointer text-[14px] font-bold tracking-wider hover:bg-[#3a8a3c] disabled:opacity-40 disabled:cursor-default disabled:border-[#555] shrink-0"
              onClick={reviewInfo.onSendToClaude}
              disabled={reviewInfo.openComments.length === 0}
            >
              <Send size={13} /> AI Revise
            </button>

            <span className="text-[#404040] shrink-0">│</span>
          </>
        )}

        <CommitDialog
          repoPath={repoPath}
          dirty={!!info?.dirty}
          fileCount={files.length}
          onModeChange={onModeChange}
        />

        <button
          disabled={!info?.dirty}
          onClick={handleRevert}
          className="px-3 py-1.5 border rounded text-[14px] font-bold tracking-wider cursor-pointer bg-transparent text-[#f44747] border-[#f44747]/50 hover:bg-[#f44747]/20 disabled:opacity-40 disabled:cursor-default shrink-0"
        >
          Revert
        </button>

        <span className="text-[#404040] shrink-0">│</span>

        <ChangedFilesPopover files={files} />
      </div>
    </div>
  );
}
