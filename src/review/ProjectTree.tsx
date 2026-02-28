import { useState, useEffect } from "react";
import { readDir } from "@tauri-apps/plugin-fs";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProjectNode } from "../types/git";

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
