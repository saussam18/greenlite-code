import { useState, useEffect, useRef, useCallback } from "react";
import { readDir, rename } from "@tauri-apps/plugin-fs";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProjectNode } from "../../types/git";

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

function parentDir(fullPath: string): string {
  const idx = fullPath.lastIndexOf("/");
  return idx > 0 ? fullPath.slice(0, idx) : "/";
}

interface ProjectTreeProps {
  cwd: string;
  selectedPath: string | null;
  onSelect: (fullPath: string) => void;
  refreshKey: number;
}

export function ProjectTree({
  cwd,
  selectedPath,
  onSelect,
  refreshKey,
}: ProjectTreeProps) {
  const [roots, setRoots] = useState<ProjectNode[] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: ProjectNode } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    loadDirChildren(cwd).then(setRoots).catch(() => setRoots([]));
  }, [cwd, refreshKey, localRefresh]);

  const handleContextMenu = useCallback((x: number, y: number, node: ProjectNode) => {
    setContextMenu({ x, y, node });
  }, []);

  const handleStartRename = useCallback(() => {
    if (!contextMenu) return;
    setRenamingPath(contextMenu.node.fullPath);
    setRenameValue(contextMenu.node.name);
    setContextMenu(null);
  }, [contextMenu]);

  const handleRename = useCallback(async (oldPath: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldPath.slice(oldPath.lastIndexOf("/") + 1)) {
      setRenamingPath(null);
      return;
    }
    const newPath = `${parentDir(oldPath)}/${trimmed}`;
    try {
      await rename(oldPath, newPath);
      setLocalRefresh((k) => k + 1);
    } catch (err) {
      console.error("Rename failed:", err);
    }
    setRenamingPath(null);
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenamingPath(null);
  }, []);

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
          onContextMenu={handleContextMenu}
          renamingPath={renamingPath}
          renameValue={renameValue}
          onRenameValueChange={setRenameValue}
          onRenameCommit={handleRename}
          onRenameCancel={handleCancelRename}
        />
      ))}

      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-50"
            onMouseDown={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 bg-[#252526] border border-[#454545] rounded shadow-lg py-1 min-w-[120px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1 text-[13px] text-[#ccc] hover:bg-[#094771] cursor-pointer"
              onClick={handleStartRename}
            >
              Rename
            </button>
          </div>
        </>
      )}
    </>
  );
}

interface ProjectTreeNodeProps {
  node: ProjectNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (fullPath: string) => void;
  onContextMenu: (x: number, y: number, node: ProjectNode) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameCommit: (oldPath: string, newName: string) => void;
  onRenameCancel: () => void;
}

function ProjectTreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  onContextMenu,
  renamingPath,
  renameValue,
  onRenameValueChange,
  onRenameCommit,
  onRenameCancel,
}: ProjectTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<ProjectNode[] | null>(node.children);
  const inputRef = useRef<HTMLInputElement>(null);
  const isRenaming = renamingPath === node.fullPath;
  const committedRef = useRef(false);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      committedRef.current = false;
    }
  }, [isRenaming]);

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e.clientX, e.clientY, node);
  };

  const commitRename = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onRenameCommit(node.fullPath, renameValue);
  };

  const nameContent = isRenaming ? (
    <input
      ref={inputRef}
      className="bg-[#3c3c3c] text-[#d4d4d4] text-[13px] border border-[#007acc] outline-none px-1 rounded min-w-0 w-full"
      value={renameValue}
      onChange={(e) => onRenameValueChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitRename();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          committedRef.current = true;
          onRenameCancel();
        }
      }}
      onBlur={commitRename}
      onClick={(e) => e.stopPropagation()}
    />
  ) : (
    <span className="text-[#d4d4d4] truncate min-w-0">{node.name}</span>
  );

  if (node.isFile) {
    const isSelected = selectedPath === node.fullPath;
    return (
      <div
        className={`flex items-center py-[3px] cursor-pointer text-[13px] hover:bg-white/[0.05] ${
          isSelected ? "bg-white/[0.1]" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 24}px`, paddingRight: 8 }}
        onClick={() => onSelect(node.fullPath)}
        onContextMenu={handleRightClick}
      >
        {nameContent}
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
        onContextMenu={handleRightClick}
      >
        {expanded ? <ChevronDown size={12} className="shrink-0 text-[#888]" /> : <ChevronRight size={12} className="shrink-0 text-[#888]" />}
        {nameContent}
      </div>
      {expanded && children !== null &&
        children.map((child) => (
          <ProjectTreeNode
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
            renamingPath={renamingPath}
            renameValue={renameValue}
            onRenameValueChange={onRenameValueChange}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
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
