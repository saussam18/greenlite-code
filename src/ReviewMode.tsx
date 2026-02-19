import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { detectLanguage, tokenizeLine, type Language } from "./syntax";

interface ChangedFile {
  status: string;
  path: string;
}

interface FileDiff {
  old_content: string;
  new_content: string;
}

interface Comment {
  id: string;
  side: "old" | "new";
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  createdAt: string;
}

interface ReviewModeProps {
  isVisible: boolean;
  cwd: string;
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
        <span className="text-[10px] w-3 shrink-0">{expanded ? "▼" : "▶"}</span>
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

// --- Diff algorithm (LCS-based) ---

interface DiffLine {
  type: "unchanged" | "added" | "removed";
  text: string;
  oldLineNum?: number;
  newLineNum?: number;
}

function computeDiff(oldText: string, newText: string): { left: DiffLine[]; right: DiffLine[] } {
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];

  // LCS via DP
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table (space-optimized would be nice but clarity wins here)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let i = m;
  let j = n;

  const leftStack: DiffLine[] = [];
  const rightStack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      leftStack.push({ type: "unchanged", text: oldLines[i - 1], oldLineNum: i });
      rightStack.push({ type: "unchanged", text: newLines[j - 1], newLineNum: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Added line on right
      leftStack.push({ type: "added", text: "" }); // blank spacer on left
      rightStack.push({ type: "added", text: newLines[j - 1], newLineNum: j });
      j--;
    } else {
      // Removed line on left
      leftStack.push({ type: "removed", text: oldLines[i - 1], oldLineNum: i });
      rightStack.push({ type: "removed", text: "" }); // blank spacer on right
      i--;
    }
  }

  leftStack.reverse();
  rightStack.reverse();
  left.push(...leftStack);
  right.push(...rightStack);

  return { left, right };
}

// --- Comments storage ---

function commentsKey(repoPath: string): string {
  return `comments:${repoPath}`;
}

function loadComments(repoPath: string): Comment[] {
  try {
    const raw = localStorage.getItem(commentsKey(repoPath));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveComments(repoPath: string, comments: Comment[]): void {
  localStorage.setItem(commentsKey(repoPath), JSON.stringify(comments));
}

// --- Main component ---

export function ReviewMode({ isVisible, cwd }: ReviewModeProps) {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ left: DiffLine[]; right: DiffLine[] } | null>(null);
  const [plainContent, setPlainContent] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);

  // Selection state
  const [selectingSide, setSelectingSide] = useState<"old" | "new" | null>(null);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  // Comment input
  const [commentInput, setCommentInput] = useState("");
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);

  // Load comments from localStorage
  useEffect(() => {
    setComments(loadComments(cwd));
  }, [cwd]);

  // Poll for changed files
  const fetchFiles = useCallback(() => {
    invoke<ChangedFile[]>("git_changed_files", { repoPath: cwd })
      .then(setFiles)
      .catch(() => {});
  }, [cwd]);

  useEffect(() => {
    if (!isVisible) return;
    fetchFiles();
    pollRef.current = window.setInterval(fetchFiles, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isVisible, fetchFiles]);

  // Load diff or plain content when file selected
  useEffect(() => {
    if (!selectedFile) {
      setDiff(null);
      setPlainContent(null);
      return;
    }
    if (selectedStatus === "A" || selectedStatus === "D") {
      setDiff(null);
      invoke<FileDiff>("git_file_diff", { repoPath: cwd, filePath: selectedFile })
        .then((result) => {
          setPlainContent(selectedStatus === "A" ? result.new_content : result.old_content);
        })
        .catch(() => setPlainContent(null));
    } else {
      setPlainContent(null);
      invoke<FileDiff>("git_file_diff", { repoPath: cwd, filePath: selectedFile })
        .then((result) => {
          setDiff(computeDiff(result.old_content, result.new_content));
        })
        .catch(() => setDiff(null));
    }
  }, [selectedFile, selectedStatus, cwd]);

  const clearSelection = () => {
    setSelectingSide(null);
    setSelectionStart(null);
    setSelectionEnd(null);
    setShowCommentInput(false);
    setCommentInput("");
    setActiveCommentId(null);
  };

  const handleLineMouseDown = (side: "old" | "new", lineNum: number) => {
    setIsSelecting(true);
    setSelectingSide(side);
    setSelectionStart(lineNum);
    setSelectionEnd(lineNum);
    setShowCommentInput(false);
    setCommentInput("");
    setActiveCommentId(null);
  };

  const handleLineMouseEnter = (side: "old" | "new", lineNum: number | null) => {
    if (isSelecting && side === selectingSide && lineNum != null) {
      setSelectionEnd(lineNum);
    }
  };

  const handleMouseUp = () => {
    if (isSelecting) setIsSelecting(false);
  };

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  });

  const isLineSelected = (side: "old" | "new", lineNum: number): boolean => {
    if (selectingSide !== side || selectionStart === null || selectionEnd === null) return false;
    const min = Math.min(selectionStart, selectionEnd);
    const max = Math.max(selectionStart, selectionEnd);
    return lineNum >= min && lineNum <= max;
  };

  const fileComments = selectedFile
    ? comments.filter((c) => c.filePath === selectedFile)
    : [];

  const findComment = (side: "old" | "new", lineNum: number): Comment | undefined => {
    return fileComments.find(
      (c) => c.side === side && lineNum >= c.startLine && lineNum <= c.endLine
    );
  };

  const handleAddComment = () => setShowCommentInput(true);

  const handleSubmitComment = () => {
    if (
      !commentInput.trim() ||
      !selectedFile ||
      !selectingSide ||
      selectionStart === null ||
      selectionEnd === null
    )
      return;

    const newComment: Comment = {
      id: crypto.randomUUID(),
      side: selectingSide,
      filePath: selectedFile,
      startLine: Math.min(selectionStart, selectionEnd),
      endLine: Math.max(selectionStart, selectionEnd),
      text: commentInput.trim(),
      createdAt: new Date().toISOString(),
    };

    const updated = [...comments, newComment];
    setComments(updated);
    saveComments(cwd, updated);
    clearSelection();
  };

  const handleDeleteComment = (id: string) => {
    const updated = comments.filter((c) => c.id !== id);
    setComments(updated);
    saveComments(cwd, updated);
    setActiveCommentId(null);
  };

  const handleCommentMarkerClick = (e: React.MouseEvent, comment: Comment) => {
    e.stopPropagation();
    setActiveCommentId(activeCommentId === comment.id ? null : comment.id);
    clearSelectionOnly();
  };

  const clearSelectionOnly = () => {
    setSelectingSide(null);
    setSelectionStart(null);
    setSelectionEnd(null);
    setShowCommentInput(false);
    setCommentInput("");
  };

  // Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;
      if (e.key === "Escape") clearSelection();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible]);

  const selMin =
    selectionStart !== null && selectionEnd !== null
      ? Math.min(selectionStart, selectionEnd)
      : null;
  const selMax =
    selectionStart !== null && selectionEnd !== null
      ? Math.max(selectionStart, selectionEnd)
      : null;

  const tree = buildTree(files);
  const lang: Language = useMemo(
    () => (selectedFile ? detectLanguage(selectedFile) : null),
    [selectedFile]
  );

  const renderHighlightedLine = (text: string) => {
    const tokens = tokenizeLine(text, lang);
    return tokens.map((t, i) => (
      <span key={i} style={{ color: t.color }}>
        {t.text}
      </span>
    ));
  };

  const renderPlainPane = (label: string, content: string, side: "old" | "new") => {
    const lines = content.split("\n");
    return (
      <div className="flex-1 overflow-auto min-w-0 relative bg-[#1e1e1e]">
        <div className="sticky top-0 z-10 px-3 py-1 bg-[#2d2d2d] border-b border-[#404040] text-[11px] text-[#888] font-semibold uppercase tracking-wider">
          {label}
        </div>
        <pre className="m-0 p-0 bg-transparent">
          <code className="block">
            {lines.map((line, i) => {
              const lineNum = i + 1;
              const selected = isLineSelected(side, lineNum);
              const comment = findComment(side, lineNum);
              const isFirstCommentLine = comment && comment.startLine === lineNum;

              let bgClass = "";
              if (selected) bgClass = "!bg-[rgba(38,79,120,0.4)]";
              else if (comment) bgClass = "bg-[rgba(78,154,6,0.08)]";

              return (
                <div
                  key={i}
                  className={`flex items-stretch min-h-[21px] leading-[21px] select-none cursor-pointer hover:bg-white/[0.03] ${bgClass}`}
                  onMouseDown={() => handleLineMouseDown(side, lineNum)}
                  onMouseEnter={() => handleLineMouseEnter(side, lineNum)}
                >
                  <span className="inline-flex items-center justify-end w-[50px] min-w-[50px] pr-2 font-mono text-[13px] text-[#555] text-right shrink-0 gap-1">
                    {comment ? (
                      <span
                        className="text-[#4e9a06] cursor-pointer text-[10px] shrink-0 hover:text-[#73d216]"
                        onClick={(e) => handleCommentMarkerClick(e, comment)}
                        title={comment.text}
                      >
                        ●
                      </span>
                    ) : null}
                    {lineNum}
                  </span>
                  <span className="flex-1 pl-2 font-mono text-[13px] whitespace-pre">
                    {line ? renderHighlightedLine(line) : " "}
                  </span>

                  {isFirstCommentLine && activeCommentId === comment!.id && (
                    <div className="absolute right-4 z-10 bg-[#2d2d30] border border-[#4e9a06] rounded-md px-3.5 py-2.5 max-w-[360px] min-w-[200px] shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
                      <div className="text-[13px] text-[#d4d4d4] whitespace-pre-wrap mb-1.5">
                        {comment!.text}
                      </div>
                      <div className="text-[11px] text-[#777] mb-1.5">
                        Lines {comment!.startLine}–{comment!.endLine}
                      </div>
                      <button
                        className="px-2 py-0.5 border border-[#555] rounded-sm bg-transparent text-[#f44747] cursor-pointer text-[11px] hover:bg-[rgba(244,71,71,0.15)]"
                        onClick={() => handleDeleteComment(comment!.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </code>
        </pre>

        {/* Add comment popover */}
        {selectingSide === side && selMin !== null && selMax !== null && !isSelecting && (
          <div
            className="absolute right-4 z-20"
            style={{ top: `${(selMax) * 21 + 28}px` }}
          >
            {!showCommentInput ? (
              <button
                className="px-3 py-1 border border-[#4e9a06] rounded bg-[#2d2d30] text-[#4e9a06] cursor-pointer text-xs font-semibold whitespace-nowrap hover:bg-[#3c3c3c]"
                onClick={handleAddComment}
              >
                + Comment (L{selMin}
                {selMin !== selMax ? `–L${selMax}` : ""})
              </button>
            ) : (
              <div className="bg-[#2d2d30] border border-[#4e9a06] rounded-md p-2 w-80 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
                <textarea
                  className="w-full min-h-[60px] px-2 py-1.5 border border-[#555] rounded bg-[#1e1e1e] text-[#d4d4d4] font-[inherit] text-[13px] resize-y outline-none focus:border-[#4e9a06]"
                  placeholder="Add a comment..."
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleSubmitComment();
                    }
                  }}
                />
                <div className="flex justify-end gap-1.5 mt-1.5">
                  <button
                    className="px-3 py-1 border border-[#555] rounded bg-[#3c3c3c] text-[#d4d4d4] cursor-pointer text-xs hover:bg-[#4a4a4a]"
                    onClick={clearSelection}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1 border border-[#4e9a06] rounded bg-[#2e6b30] text-[#e0e0e0] cursor-pointer text-xs hover:bg-[#3a8a3c] disabled:opacity-40 disabled:cursor-default"
                    onClick={handleSubmitComment}
                    disabled={!commentInput.trim()}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderPane = (side: "old" | "new", lines: DiffLine[]) => {
    return (
      <div className="flex-1 overflow-auto min-w-0 relative bg-[#1e1e1e]">
        <div className="sticky top-0 z-10 px-3 py-1 bg-[#2d2d2d] border-b border-[#404040] text-[11px] text-[#888] font-semibold uppercase tracking-wider">
          {side === "old" ? "Before" : "After"}
        </div>
        <pre className="m-0 p-0 bg-transparent">
          <code className="block">
            {lines.map((line, i) => {
              const lineNum = side === "old" ? line.oldLineNum : line.newLineNum;
              const isSpacer =
                (side === "old" && line.type === "added") ||
                (side === "new" && line.type === "removed");
              const isRemoved = side === "old" && line.type === "removed";
              const isAdded = side === "new" && line.type === "added";
              const selected = lineNum != null && isLineSelected(side, lineNum);
              const comment = lineNum != null ? findComment(side, lineNum) : undefined;
              const isFirstCommentLine = comment && comment.startLine === lineNum;

              let bgClass = "";
              if (selected) bgClass = "!bg-[rgba(38,79,120,0.4)]";
              else if (comment) bgClass = "bg-[rgba(78,154,6,0.08)]";
              else if (isRemoved) bgClass = "bg-[rgba(244,71,71,0.18)]";
              else if (isAdded) bgClass = "bg-[rgba(106,153,85,0.18)]";

              return (
                <div
                  key={i}
                  className={`flex items-stretch min-h-[21px] leading-[21px] select-none ${
                    isSpacer ? "bg-[rgba(128,128,128,0.04)]" : ""
                  } ${bgClass} ${lineNum != null ? "cursor-pointer hover:bg-white/[0.03]" : ""}`}
                  onMouseDown={() => lineNum != null && handleLineMouseDown(side, lineNum)}
                  onMouseEnter={() => handleLineMouseEnter(side, lineNum ?? null)}
                >
                  <span className="inline-flex items-center justify-end w-[50px] min-w-[50px] pr-2 font-mono text-[13px] text-[#555] text-right shrink-0 gap-1">
                    {comment ? (
                      <span
                        className="text-[#4e9a06] cursor-pointer text-[10px] shrink-0 hover:text-[#73d216]"
                        onClick={(e) => handleCommentMarkerClick(e, comment)}
                        title={comment.text}
                      >
                        ●
                      </span>
                    ) : null}
                    {lineNum ?? ""}
                  </span>
                  <span
                    className={`flex-1 pl-2 font-mono text-[13px] whitespace-pre ${
                      isSpacer ? "text-transparent" : ""
                    }`}
                  >
                    {isSpacer ? " " : line.text ? renderHighlightedLine(line.text) : " "}
                  </span>

                  {isFirstCommentLine && activeCommentId === comment!.id && (
                    <div className="absolute right-4 z-10 bg-[#2d2d30] border border-[#4e9a06] rounded-md px-3.5 py-2.5 max-w-[360px] min-w-[200px] shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
                      <div className="text-[13px] text-[#d4d4d4] whitespace-pre-wrap mb-1.5">
                        {comment!.text}
                      </div>
                      <div className="text-[11px] text-[#777] mb-1.5">
                        {side === "old" ? "Before" : "After"} — Lines {comment!.startLine}–
                        {comment!.endLine}
                      </div>
                      <button
                        className="px-2 py-0.5 border border-[#555] rounded-sm bg-transparent text-[#f44747] cursor-pointer text-[11px] hover:bg-[rgba(244,71,71,0.15)]"
                        onClick={() => handleDeleteComment(comment!.id)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </code>
        </pre>

        {/* Add comment popover */}
        {selectingSide === side && selMin !== null && selMax !== null && !isSelecting && (
          <div
            className="absolute right-4 z-20"
            style={{ top: `${(selMax) * 21 + 28}px` }}
          >
            {!showCommentInput ? (
              <button
                className="px-3 py-1 border border-[#4e9a06] rounded bg-[#2d2d30] text-[#4e9a06] cursor-pointer text-xs font-semibold whitespace-nowrap hover:bg-[#3c3c3c]"
                onClick={handleAddComment}
              >
                + Comment (L{selMin}
                {selMin !== selMax ? `–L${selMax}` : ""})
              </button>
            ) : (
              <div className="bg-[#2d2d30] border border-[#4e9a06] rounded-md p-2 w-80 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
                <textarea
                  className="w-full min-h-[60px] px-2 py-1.5 border border-[#555] rounded bg-[#1e1e1e] text-[#d4d4d4] font-[inherit] text-[13px] resize-y outline-none focus:border-[#4e9a06]"
                  placeholder="Add a comment..."
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleSubmitComment();
                    }
                  }}
                />
                <div className="flex justify-end gap-1.5 mt-1.5">
                  <button
                    className="px-3 py-1 border border-[#555] rounded bg-[#3c3c3c] text-[#d4d4d4] cursor-pointer text-xs hover:bg-[#4a4a4a]"
                    onClick={clearSelection}
                  >
                    Cancel
                  </button>
                  <button
                    className="px-3 py-1 border border-[#4e9a06] rounded bg-[#2e6b30] text-[#e0e0e0] cursor-pointer text-xs hover:bg-[#3a8a3c] disabled:opacity-40 disabled:cursor-default"
                    onClick={handleSubmitComment}
                    disabled={!commentInput.trim()}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden min-h-0"
      style={{ display: isVisible ? "flex" : "none" }}
    >
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sidebar — file tree */}
        <div className="w-[240px] min-w-[200px] bg-[#252526] border-r border-[#404040] overflow-y-auto shrink-0">
          <div className="px-3 py-2 text-[11px] text-[#888] font-semibold uppercase tracking-wider border-b border-[#404040]">
            Changed Files ({files.length})
          </div>
          {files.length === 0 ? (
            <div className="px-3 py-4 text-[13px] text-[#555]">No changes detected</div>
          ) : (
            <FileTree nodes={tree} selectedPath={selectedFile} onSelect={(path) => {
              setSelectedFile(path);
              const f = files.find((f) => f.path === path);
              setSelectedStatus(f?.status || null);
            }} />
          )}
        </div>

        {/* Content area */}
        {plainContent !== null ? (
          renderPlainPane(
            selectedStatus === "D" ? "Deleted" : "Added",
            plainContent,
            selectedStatus === "D" ? "old" : "new"
          )
        ) : diff ? (
          <div className="flex flex-1 overflow-hidden min-h-0">
            {renderPane("old", diff.left)}
            <div className="w-px bg-[#404040] shrink-0" />
            {renderPane("new", diff.right)}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[#555] text-sm bg-[#1e1e1e]">
            {selectedFile ? "Loading..." : "Select a file to view changes"}
          </div>
        )}
      </div>
    </div>
  );
}
