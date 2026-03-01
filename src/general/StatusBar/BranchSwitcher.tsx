import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GitInfo } from "../../types/git";

interface BranchSwitcherProps {
  repoPath: string;
  info: GitInfo;
}

export function BranchSwitcher({ repoPath, info }: BranchSwitcherProps) {
  const [show, setShow] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranchName, setNewBranchName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!show) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShow(false);
        setNewBranchName("");
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [show]);

  const open = async () => {
    try {
      const list = await invoke<string[]>("git_list_branches", { repoPath });
      setBranches(list);
    } catch {
      setBranches([]);
    }
    setShow(true);
  };

  const handleCheckout = async (branch: string, isNew: boolean) => {
    try {
      await invoke("git_checkout", { repoPath, branch, newBranch: isNew });
      setShow(false);
      setNewBranchName("");
    } catch (e) {
      alert(`Checkout failed: ${e}`);
    }
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        className="flex items-center gap-2 text-[#d4d4d4] bg-transparent border-none font-mono text-[14px] cursor-pointer hover:text-white shrink-0"
        onClick={open}
        title="Switch branch"
      >
        <span className="text-[#888]">⎇</span>
        {info.branch}
        <span className="text-[#555] text-[11px]">▼</span>
      </button>
      {show && (
        <div className="absolute bottom-full left-0 mb-2 bg-[#252526] border border-[#404040] rounded shadow-[0_4px_16px_rgba(0,0,0,0.4)] max-h-[400px] w-[280px] overflow-y-auto z-50">
          <div className="px-4 py-2.5 text-[13px] text-[#888] font-semibold uppercase tracking-wider border-b border-[#404040] sticky top-0 bg-[#252526]">
            Branches
          </div>
          <form
            className="flex items-center gap-2 px-3 py-2.5 border-b border-[#404040]"
            onSubmit={(e) => {
              e.preventDefault();
              if (newBranchName.trim()) handleCheckout(newBranchName.trim(), true);
            }}
          >
            <input
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
  );
}
