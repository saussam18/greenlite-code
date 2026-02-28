import { useState, useEffect, useRef } from "react";
import { readDir, writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { ChevronDown, ChevronRight, FilePlus, FolderPlus } from "lucide-react";

export interface ChangedFile {
  status: string;
  path: string;
}

// --- Tree helpers ---

interface TreeNode {
  name: string;
  fullPath: string;
  status?: string;
  children: TreeNode[];
  isFile: boolean;
}

function buildTree(files: ChangedFile[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const f of files) {
    const parts = f.path.split("/");
    let current = root;
    let pathSoFar = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      const isFile = i === parts.length - 1;

      let existing = current.find((n) => n.name === part && n.isFile === isFile);
      if (!existing) {
        existing = {
          name: part,
          fullPath: pathSoFar,
          children: [],
          isFile,
          ...(isFile ? { status: f.status } : {}),
        };
        current.push(existing);
      }
      current = existing.children;
    }
  }

  return root;
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

function FileTree({
  nodes,
  selectedPath,
  onSelect,
}: {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <FileTreeNode
          key={node.fullPath}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function FileTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.isFile) {
    const isSelected = selectedPath === node.fullPath;
    return (
      <div
        className={`flex items-center py-[3px] cursor-pointer text-[13px] hover:bg-white/[0.05] ${
          isSelected ? "bg-white/[0.1]" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: 8 }}
        onClick={() => onSelect(node.fullPath)}
      >
        <span className={`font-mono text-[12px] w-[18px] shrink-0 text-center ${statusColor(node.status || "")}`}>
          {node.status || "?"}
        </span>
        <span className="text-[#d4d4d4] ml-2 truncate min-w-0">{node.name}</span>
      </div>
    );
  }

  return (
    <div>
      <div
        className="flex items-center gap-2 py-[3px] cursor-pointer text-[13px] text-[#ccc] hover:bg-white/[0.05]"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={12} className="shrink-0 text-[#888]" /> : <ChevronRight size={12} className="shrink-0 text-[#888]" />}
        <span className="truncate">{node.name}</span>
      </div>
      {expanded &&
        node.children.map((child) => (
          <FileTreeNode
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

// --- Project tree (full directory listing) ---

interface ProjectNode {
  name: string;
  fullPath: string;
  isFile: boolean;
  children: ProjectNode[] | null;
}

const IGNORED_DIRS = new Set([
  ".git", "node_modules", "target", "dist", ".next",
  ".turbo", ".cache", "__pycache__", ".DS_Store", "coverage",
]);

async function loadDirChildren(dirPath: string): Promise<ProjectNode[]> {
  const entries = await readDir(dirPath);
  const nodes: ProjectNode[] = [];
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    nodes.push({
      name: entry.name,
      fullPath: `${dirPath}/${entry.name}`,
      isFile: !entry.isDirectory,
      children: entry.isDirectory ? null : [],
    });
  }
  nodes.sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

function ProjectTree({
  cwd,
  selectedPath,
  onSelect,
  refreshKey,
}: {
  cwd: string;
  selectedPath: string | null;
  onSelect: (fullPath: string) => void;
  refreshKey: number;
}) {
  const [roots, setRoots] = useState<ProjectNode[] | null>(null);

  useEffect(() => {
    loadDirChildren(cwd).then(setRoots).catch(() => setRoots([]));
  }, [cwd, refreshKey]);

  if (roots === null) {
    return <div className="px-3 py-4 text-[13px] text-[#555]">Loading...</div>;
  }
  if (roots.length === 0) {
    return <div className="px-3 py-4 text-[13px] text-[#555]">Empty directory</div>;
  }

  return (
    <>
      {roots.map((node) => (
        <ProjectTreeNode
          key={node.fullPath}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function ProjectTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: ProjectNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (fullPath: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<ProjectNode[] | null>(node.children);

  if (node.isFile) {
    const isSelected = selectedPath === node.fullPath;
    return (
      <div
        className={`flex items-center py-[3px] cursor-pointer text-[13px] hover:bg-white/[0.05] ${
          isSelected ? "bg-white/[0.1]" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 24}px`, paddingRight: 8 }}
        onClick={() => onSelect(node.fullPath)}
      >
        <span className="text-[#d4d4d4] truncate min-w-0">{node.name}</span>
      </div>
    );
  }

  const handleToggle = async () => {
    if (!expanded && children === null) {
      try {
        const loaded = await loadDirChildren(node.fullPath);
        setChildren(loaded);
      } catch {
        setChildren([]);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div>
      <div
        className="flex items-center gap-2 py-[3px] cursor-pointer text-[13px] text-[#ccc] hover:bg-white/[0.05]"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleToggle}
      >
        {expanded ? <ChevronDown size={12} className="shrink-0 text-[#888]" /> : <ChevronRight size={12} className="shrink-0 text-[#888]" />}
        <span className="truncate">{node.name}</span>
      </div>
      {expanded && children !== null &&
        children.map((child) => (
          <ProjectTreeNode
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      {expanded && children === null && (
        <div className="text-[12px] text-[#555] pl-8" style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}>
          Loading...
        </div>
      )}
    </div>
  );
}

// --- Sidebar component ---

interface ReviewSidebarProps {
  sidebarTab: "changes" | "files";
  setSidebarTab: (tab: "changes" | "files") => void;
  files: ChangedFile[];
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
  setSelectedStatus: (status: string | null) => void;
  browseSelectedFile: string | null;
  setBrowseSelectedFile: (path: string | null) => void;
  viewMode: "diff" | "file";
  setViewMode: (mode: "diff" | "file") => void;
  clearSelection: () => void;
  cwd: string;
  width?: number;
}

export function ReviewSidebar({
  sidebarTab,
  setSidebarTab,
  files,
  selectedFile,
  setSelectedFile,
  setSelectedStatus,
  browseSelectedFile,
  setBrowseSelectedFile,
  setViewMode,
  clearSelection,
  cwd,
  width,
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
              setSelectedFile(path);
              const f = files.find((f) => f.path === path);
              setSelectedStatus(f?.status || null);
              setViewMode("diff");
              setBrowseSelectedFile(null);
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
                setBrowseSelectedFile(fullPath);
                setViewMode("file");
                setSelectedFile(null);
                setSelectedStatus(null);
                clearSelection();
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
