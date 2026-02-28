import { useState, useEffect, useRef } from "react";
import { writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { FilePlus, FolderPlus } from "lucide-react";
import type { ChangedFile } from "../types/git";
import { FileTree, buildTree } from "./FileTree";
import { ProjectTree } from "./ProjectTree";

interface ReviewSidebarProps {
  sidebarTab: "changes" | "files";
  setSidebarTab: (tab: "changes" | "files") => void;
  files: ChangedFile[];
  selectedFile: string | null;
  browseSelectedFile: string | null;
  clearSelection: () => void;
  cwd: string;
  width?: number;
  onSelectDiff: (path: string, status: string) => void;
  onSelectFile: (fullPath: string) => void;
}

export function ReviewSidebar({
  sidebarTab,
  setSidebarTab,
  files,
  selectedFile,
  browseSelectedFile,
  clearSelection,
  cwd,
  width,
  onSelectDiff,
  onSelectFile,
}: ReviewSidebarProps) {
  const tree = buildTree(files);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [createName, setCreateName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating && inputRef.current) inputRef.current.focus();
  }, [creating]);

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) { setCreating(null); return; }
    const fullPath = `${cwd}/${name}`;
    try {
      if (creating === "folder") {
        await mkdir(fullPath, { recursive: true });
      } else {
        const lastSlash = name.lastIndexOf("/");
        if (lastSlash !== -1) {
          await mkdir(`${cwd}/${name.substring(0, lastSlash)}`, { recursive: true });
        }
        await writeTextFile(fullPath, "");
      }
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      alert(err?.message || String(err));
    }
    setCreating(null);
    setCreateName("");
  };

  return (
    <div className="bg-[#252526] overflow-y-auto shrink-0 flex flex-col" style={{ width: width ?? 240 }}>
      {/* Sidebar tabs */}
      <div className="flex border-b border-[#404040] shrink-0">
        <button
          className={`flex-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider cursor-pointer border-b-2 ${
            sidebarTab === "changes"
              ? "text-[#d4d4d4] border-[#4e9a06] bg-[#2d2d30]"
              : "text-[#888] border-transparent hover:text-[#ccc] hover:bg-white/[0.03]"
          }`}
          onClick={() => setSidebarTab("changes")}
        >
          Changes ({files.length})
        </button>
        <button
          className={`flex-1 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider cursor-pointer border-b-2 ${
            sidebarTab === "files"
              ? "text-[#d4d4d4] border-[#4e9a06] bg-[#2d2d30]"
              : "text-[#888] border-transparent hover:text-[#ccc] hover:bg-white/[0.03]"
          }`}
          onClick={() => setSidebarTab("files")}
        >
          Files
        </button>
      </div>
      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {sidebarTab === "changes" ? (
          files.length === 0 ? (
            <div className="px-3 py-4 text-[13px] text-[#555]">No changes detected</div>
          ) : (
            <FileTree nodes={tree} selectedPath={selectedFile} onSelect={(path) => {
              const f = files.find((f) => f.path === path);
              onSelectDiff(path, f?.status || "M");
            }} />
          )
        ) : (
          <>
            {/* Create file/folder toolbar */}
            <div className="flex items-center justify-end gap-1 px-2 py-1.5 border-b border-[#404040]">
              {creating === null ? (
                <>
                  <button
                    className="p-1 text-[#aaa] hover:text-[#ddd] hover:bg-white/[0.06] rounded cursor-pointer"
                    onClick={() => { setCreating("file"); setCreateName(""); }}
                    title="New file"
                  >
                    <FilePlus size={14} />
                  </button>
                  <button
                    className="p-1 text-[#aaa] hover:text-[#ddd] hover:bg-white/[0.06] rounded cursor-pointer"
                    onClick={() => { setCreating("folder"); setCreateName(""); }}
                    title="New folder"
                  >
                    <FolderPlus size={14} />
                  </button>
                </>
              ) : (
                <input
                  ref={inputRef}
                  className="flex-1 bg-[#1e1e1e] border border-[#555] rounded px-1.5 py-0.5 text-[12px] text-[#d4d4d4] outline-none focus:border-[#4e9a06] min-w-0"
                  placeholder={creating === "file" ? "file path..." : "folder path..."}
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setCreating(null); setCreateName(""); }
                  }}
                  onBlur={() => { setCreating(null); setCreateName(""); }}
                />
              )}
            </div>
            <ProjectTree
              cwd={cwd}
              selectedPath={browseSelectedFile}
              refreshKey={refreshKey}
              onSelect={(fullPath) => {
                onSelectFile(fullPath);
                clearSelection();
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
