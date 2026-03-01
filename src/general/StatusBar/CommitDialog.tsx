import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Mode } from "../../types/settings";

interface CommitDialogProps {
  repoPath: string;
  dirty: boolean;
  fileCount: number;
  onModeChange: (mode: Mode) => void;
}

export function CommitDialog({ repoPath, dirty, fileCount, onModeChange }: CommitDialogProps) {
  const [show, setShow] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (show && inputRef.current) inputRef.current.focus();
  }, [show]);

  useEffect(() => {
    if (!show) return;
    const handleClick = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setShow(false);
        setCommitMsg("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [show]);

  const handleCommitAndPush = async () => {
    if (!commitMsg.trim()) return;
    setCommitting(true);
    try {
      await invoke("git_commit_and_push", { repoPath, message: commitMsg.trim() });
      setCommitMsg("");
      setShow(false);
    } catch (e) {
      alert(`Commit failed: ${e}`);
    } finally {
      setCommitting(false);
    }
  };

  return (
    <>
      <button
        disabled={!dirty}
        onClick={() => setShow(true)}
        className={`px-3 py-1.5 border rounded text-[14px] font-bold tracking-wider cursor-pointer bg-transparent disabled:opacity-40 disabled:cursor-default shrink-0 ${
          show
            ? "text-[#6a9955] border-[#6a9955] bg-[#6a9955]/20"
            : "text-[#6a9955] border-[#6a9955]/50 hover:bg-[#6a9955]/20 hover:border-[#6a9955]"
        }`}
      >
        Commit &amp; Push
      </button>

      {show && (
        <div
          ref={dialogRef}
          className="absolute bottom-full right-0 mb-2 bg-[#252526] border border-[#404040] rounded shadow-[0_4px_16px_rgba(0,0,0,0.4)] w-[660px] z-50"
        >
          <div className="px-4 py-2.5 text-[13px] text-[#888] font-semibold uppercase tracking-wider border-b border-[#404040]">
            Commit &amp; Push
          </div>
          <div className="p-4">
            <textarea
              ref={inputRef}
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
                  setShow(false);
                  setCommitMsg("");
                }
              }}
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-[13px] text-[#555]">
                {fileCount} changed file{fileCount !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => { setShow(false); setCommitMsg(""); }}
                  className="flex-1 px-5 py-2 border rounded text-[13px] font-bold cursor-pointer bg-transparent text-[#888] border-[#404040] hover:text-[#ccc] hover:border-[#555] whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCommitAndPush}
                  disabled={!commitMsg.trim() || committing}
                  className="flex-1 px-5 py-2 border rounded text-[13px] font-bold tracking-wider cursor-pointer bg-transparent text-[#6a9955] border-[#6a9955] hover:bg-[#6a9955]/20 disabled:opacity-40 disabled:cursor-default whitespace-nowrap"
                >
                  {committing ? "Pushing…" : "Commit & Push"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    invoke("pty_write", {
                      data: "commit and push all changes",
                      terminalId: "term-0",
                    }).catch(console.error);
                    setShow(false);
                    setCommitMsg("");
                    onModeChange("build");
                  }}
                  className="flex-1 px-5 py-2 border rounded text-[13px] font-bold tracking-wider cursor-pointer bg-transparent text-[#569cd6] border-[#569cd6] hover:bg-[#569cd6]/20 whitespace-nowrap"
                >
                  Send to AI
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
