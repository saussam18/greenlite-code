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
  startCol: number;  // 0-based column in startLine
  endCol: number;    // 0-based column in endLine (exclusive)
  text: string;
  createdAt: string;
  resolved: boolean;
}

interface SelectionAnchor {
  line: number;
  col: number;
}

interface CommentsData {
  commitHash: string;
  comments: Comment[];
}

interface GitInfo {
  branch: string;
  ahead: number;
  behind: number;
  last_commit_message: string;
  last_commit_hash: string;
}

type Mode = "build" | "review";

interface ReviewModeProps {
  isVisible: boolean;
  cwd: string;
  onModeChange: (mode: Mode) => void;
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

function loadCommentsData(repoPath: string): CommentsData {
  try {
    const raw = localStorage.getItem(commentsKey(repoPath));
    if (!raw) return { commitHash: "", comments: [] };
    const parsed = JSON.parse(raw);
    // Migrate old format (plain array) to new CommentsData format
    if (Array.isArray(parsed)) {
      const migrated: Comment[] = parsed.map((c: Partial<Comment> & { id: string; side: "old" | "new"; filePath: string; startLine: number; endLine: number; text: string; createdAt: string }) => ({
        ...c,
        resolved: c.resolved ?? false,
        startCol: c.startCol ?? 0,
        endCol: c.endCol ?? Infinity,
      }));
      return { commitHash: "", comments: migrated };
    }
    // Ensure all comments have resolved + column fields
    const data = parsed as CommentsData;
    data.comments = data.comments.map((c: Partial<Comment> & { id: string; side: "old" | "new"; filePath: string; startLine: number; endLine: number; text: string; createdAt: string }) => ({
      ...c,
      resolved: c.resolved ?? false,
      startCol: c.startCol ?? 0,
      endCol: c.endCol ?? Infinity,
    }));
    return data;
  } catch {
    return { commitHash: "", comments: [] };
  }
}

function saveCommentsData(repoPath: string, data: CommentsData): void {
  localStorage.setItem(commentsKey(repoPath), JSON.stringify(data));
}

// --- Inline comment thread ---

function CommentThread({
  comment,
  onResolve,
  onUnresolve,
  onDelete,
}: {
  comment: Comment;
  onResolve: (id: string) => void;
  onUnresolve: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const borderColor = comment.resolved ? "#555" : "#4e9a06";
  const opacity = comment.resolved ? "opacity-60" : "";

  return (
    <div
      className={`mx-[50px] my-1 border rounded-md bg-[#2d2d30] ${opacity}`}
      style={{ borderColor }}
    >
      {/* Collapse toggle header */}
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer hover:bg-white/[0.03] select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className="text-[10px] text-[#888] w-3 shrink-0">{collapsed ? "▶" : "▼"}</span>
        {comment.resolved && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#888] bg-[#3c3c3c] rounded px-1.5 py-0.5">
            Resolved
          </span>
        )}
        <span className="text-[12px] text-[#999] truncate flex-1">
          {collapsed ? comment.text : (() => {
            const hasCol = comment.startCol !== 0 || comment.endCol !== Infinity;
            if (hasCol) {
              return `L${comment.startLine}:${comment.startCol}–L${comment.endLine}:${comment.endCol}`;
            }
            return `Lines ${comment.startLine}–${comment.endLine}`;
          })()}
        </span>
      </div>
      {!collapsed && (
        <div className="px-3 pb-2">
          <div className="text-[13px] text-[#d4d4d4] whitespace-pre-wrap">
            {comment.text}
          </div>
          <div className="text-[11px] text-[#666] mt-1">
            {(() => {
              const hasCol = comment.startCol !== 0 || comment.endCol !== Infinity;
              if (hasCol) {
                return `L${comment.startLine}:${comment.startCol}–L${comment.endLine}:${comment.endCol}`;
              }
              return `Lines ${comment.startLine}–${comment.endLine}`;
            })()} &middot;{" "}
            {new Date(comment.createdAt).toLocaleString()}
          </div>
          <div className="flex gap-1.5 mt-2">
            {comment.resolved ? (
              <button
                className="px-2 py-0.5 border border-[#555] rounded-sm bg-transparent text-[#4e9a06] cursor-pointer text-[11px] hover:bg-[rgba(78,154,6,0.15)]"
                onClick={() => onUnresolve(comment.id)}
              >
                Unresolve
              </button>
            ) : (
              <button
                className="px-2 py-0.5 border border-[#4e9a06] rounded-sm bg-transparent text-[#4e9a06] cursor-pointer text-[11px] hover:bg-[rgba(78,154,6,0.15)]"
                onClick={() => onResolve(comment.id)}
              >
                Resolve
              </button>
            )}
            <button
              className="px-2 py-0.5 border border-[#555] rounded-sm bg-transparent text-[#f44747] cursor-pointer text-[11px] hover:bg-[rgba(244,71,71,0.15)]"
              onClick={() => onDelete(comment.id)}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main component ---

export function ReviewMode({ isVisible, cwd, onModeChange }: ReviewModeProps) {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ left: DiffLine[]; right: DiffLine[] } | null>(null);
  const [plainContent, setPlainContent] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [storedCommitHash, setStoredCommitHash] = useState("");

  // Selection state (column-aware)
  const [selectingSide, setSelectingSide] = useState<"old" | "new" | null>(null);
  const [selectionStart, setSelectionStart] = useState<SelectionAnchor | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<SelectionAnchor | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  // Measure monospace char width for column calculation
  const charWidthRef = useRef<number>(0);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (isVisible && measureRef.current) {
      charWidthRef.current = measureRef.current.getBoundingClientRect().width;
    }
  }, [isVisible]);

  // Comment input
  const [commentInput, setCommentInput] = useState("");
  const [showCommentInput, setShowCommentInput] = useState(false);

  // Track which inline threads are collapsed
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());

  const pollRef = useRef<number | null>(null);

  // Load comments from localStorage
  useEffect(() => {
    const data = loadCommentsData(cwd);
    setComments(data.comments);
    setStoredCommitHash(data.commitHash);
  }, [cwd]);

  // Save helper
  const persistComments = useCallback(
    (updatedComments: Comment[], commitHash?: string) => {
      const hash = commitHash ?? storedCommitHash;
      setComments(updatedComments);
      saveCommentsData(cwd, { commitHash: hash, comments: updatedComments });
    },
    [cwd, storedCommitHash]
  );

  // Fetch git info to track commit hash changes
  const checkCommitHash = useCallback(() => {
    invoke<GitInfo>("git_info", { repoPath: cwd })
      .then((info) => {
        const currentHash = info.last_commit_hash;
        if (!currentHash) return;

        setStoredCommitHash((prevHash) => {
          if (prevHash && prevHash !== currentHash) {
            // Commit hash changed — purge resolved comments
            setComments((prev) => {
              const kept = prev.filter((c) => !c.resolved);
              saveCommentsData(cwd, { commitHash: currentHash, comments: kept });
              return kept;
            });
          } else if (!prevHash) {
            // First load — just store the hash
            const data = loadCommentsData(cwd);
            saveCommentsData(cwd, { commitHash: currentHash, comments: data.comments });
          }
          return currentHash;
        });
      })
      .catch(() => {});
  }, [cwd]);

  // Poll for changed files + commit hash
  const fetchFiles = useCallback(() => {
    invoke<ChangedFile[]>("git_changed_files", { repoPath: cwd })
      .then(setFiles)
      .catch(() => {});
  }, [cwd]);

  useEffect(() => {
    if (!isVisible) return;
    fetchFiles();
    checkCommitHash();
    pollRef.current = window.setInterval(() => {
      fetchFiles();
      checkCommitHash();
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isVisible, fetchFiles, checkCommitHash]);

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
  };

  const getColFromEvent = (e: React.MouseEvent, codeSpan: HTMLElement, lineText: string): number => {
    const charWidth = charWidthRef.current;
    if (!charWidth) return 0;
    const rect = codeSpan.getBoundingClientRect();
    const paddingLeft = parseFloat(getComputedStyle(codeSpan).paddingLeft) || 0;
    const col = Math.floor((e.clientX - rect.left - paddingLeft) / charWidth);
    return Math.max(0, Math.min(col, lineText.length));
  };

  const handleLineMouseDown = (side: "old" | "new", lineNum: number, col: number) => {
    setIsSelecting(true);
    setSelectingSide(side);
    setSelectionStart({ line: lineNum, col });
    setSelectionEnd({ line: lineNum, col });
    setShowCommentInput(false);
    setCommentInput("");
  };

  const handleLineMouseMove = (side: "old" | "new", lineNum: number, col: number) => {
    if (isSelecting && side === selectingSide) {
      setSelectionEnd({ line: lineNum, col });
    }
  };

  const handleMouseUp = () => {
    if (isSelecting) setIsSelecting(false);
  };

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  });

  // Normalized selection: earlier anchor first
  const selNorm: { start: SelectionAnchor; end: SelectionAnchor } | null = useMemo(() => {
    if (!selectionStart || !selectionEnd) return null;
    const a = selectionStart;
    const b = selectionEnd;
    if (a.line < b.line || (a.line === b.line && a.col <= b.col)) {
      return { start: a, end: b };
    }
    return { start: b, end: a };
  }, [selectionStart, selectionEnd]);

  const getLineHighlight = (side: "old" | "new", lineNum: number, lineLength: number): { startCol: number; endCol: number } | null => {
    if (selectingSide !== side || !selNorm) return null;
    const { start, end } = selNorm;
    if (lineNum < start.line || lineNum > end.line) return null;
    if (start.line === end.line) {
      // Single-point click (no drag yet) → highlight whole line
      if (start.col === end.col) return { startCol: 0, endCol: lineLength };
      // Single-line partial selection
      return { startCol: start.col, endCol: end.col };
    }
    // Multi-line selection
    if (lineNum === start.line) return { startCol: start.col, endCol: lineLength };
    if (lineNum === end.line) return { startCol: 0, endCol: end.col };
    return { startCol: 0, endCol: lineLength };
  };

  const getCommentHighlight = (side: "old" | "new", lineNum: number, lineLength: number, comment: Comment): { startCol: number; endCol: number } | null => {
    if (comment.side !== side || lineNum < comment.startLine || lineNum > comment.endLine) return null;
    if (comment.startLine === comment.endLine) {
      return { startCol: comment.startCol, endCol: Math.min(comment.endCol, lineLength) };
    }
    if (lineNum === comment.startLine) return { startCol: comment.startCol, endCol: lineLength };
    if (lineNum === comment.endLine) return { startCol: 0, endCol: Math.min(comment.endCol, lineLength) };
    return { startCol: 0, endCol: lineLength };
  };

  const fileComments = selectedFile
    ? comments.filter((c) => c.filePath === selectedFile)
    : [];

  const findComment = (side: "old" | "new", lineNum: number): Comment | undefined => {
    return fileComments.find(
      (c) => c.side === side && lineNum >= c.startLine && lineNum <= c.endLine
    );
  };

  // Get all comments that end at a specific line on a specific side
  const getCommentsEndingAtLine = (side: "old" | "new", lineNum: number): Comment[] => {
    return fileComments.filter((c) => c.side === side && c.endLine === lineNum);
  };

  const handleAddComment = () => setShowCommentInput(true);

  const handleSubmitComment = () => {
    if (
      !commentInput.trim() ||
      !selectedFile ||
      !selectingSide ||
      !selNorm
    )
      return;

    // If start and end are the same point (click, no drag), treat as whole-line
    const isSinglePoint = selNorm.start.line === selNorm.end.line && selNorm.start.col === selNorm.end.col;
    const newComment: Comment = {
      id: crypto.randomUUID(),
      side: selectingSide,
      filePath: selectedFile,
      startLine: selNorm.start.line,
      endLine: selNorm.end.line,
      startCol: isSinglePoint ? 0 : selNorm.start.col,
      endCol: isSinglePoint ? Infinity : selNorm.end.col,
      text: commentInput.trim(),
      createdAt: new Date().toISOString(),
      resolved: false,
    };

    persistComments([...comments, newComment]);
    clearSelection();
  };

  const handleDeleteComment = (id: string) => {
    persistComments(comments.filter((c) => c.id !== id));
  };

  const handleResolveComment = (id: string) => {
    persistComments(
      comments.map((c) => (c.id === id ? { ...c, resolved: true } : c))
    );
  };

  const handleUnresolveComment = (id: string) => {
    persistComments(
      comments.map((c) => (c.id === id ? { ...c, resolved: false } : c))
    );
  };

  const handleGutterDotClick = (e: React.MouseEvent, comment: Comment) => {
    e.stopPropagation();
    setCollapsedThreads((prev) => {
      const next = new Set(prev);
      if (next.has(comment.id)) {
        next.delete(comment.id);
      } else {
        next.add(comment.id);
      }
      return next;
    });
  };

  // Send open comments to Claude via PTY
  const openComments = comments.filter((c) => !c.resolved);

  const handleSendToClaude = () => {
    if (openComments.length === 0) return;

    // Group open comments by file
    const grouped = new Map<string, Comment[]>();
    for (const c of openComments) {
      const existing = grouped.get(c.filePath) || [];
      existing.push(c);
      grouped.set(c.filePath, existing);
    }

    let prompt = "Please fix the following review comments:\n";
    for (const [filePath, fileComments] of grouped) {
      for (const c of fileComments) {
        const hasCol = c.startCol !== 0 || c.endCol !== Infinity;
        let lineRange: string;
        if (c.startLine === c.endLine) {
          lineRange = hasCol ? `line ${c.startLine}:${c.startCol}-${c.endCol}` : `line ${c.startLine}`;
        } else {
          lineRange = hasCol
            ? `lines ${c.startLine}:${c.startCol}-${c.endLine}:${c.endCol}`
            : `lines ${c.startLine}-${c.endLine}`;
        }
        prompt += `\n## ${filePath} (${lineRange}, ${c.side})\n${c.text}\n`;
      }
    }

    invoke("pty_write", { data: prompt }).catch(console.error);
    onModeChange("build");
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

  // Line range for popover positioning
  const selMin = selNorm ? selNorm.start.line : null;
  const selMax = selNorm ? selNorm.end.line : null;

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

  const renderInlineThread = (side: "old" | "new", lineNum: number) => {
    const endingComments = getCommentsEndingAtLine(side, lineNum);
    if (endingComments.length === 0) return null;

    return endingComments.map((comment) => {
      if (collapsedThreads.has(comment.id)) return null;
      return (
        <CommentThread
          key={comment.id}
          comment={comment}
          onResolve={handleResolveComment}
          onUnresolve={handleUnresolveComment}
          onDelete={handleDeleteComment}
        />
      );
    });
  };

  const renderHighlightOverlay = (
    highlight: { startCol: number; endCol: number } | null,
    color: string,
    lineLength: number
  ) => {
    if (!highlight || (highlight.startCol === 0 && highlight.endCol >= lineLength)) return null;
    // The code span has pl-2 (0.5rem padding). Absolute positioning starts at the
    // padding edge, but text starts at the content edge, so offset by the padding.
    return (
      <span
        className="absolute top-0 bottom-0 pointer-events-none"
        style={{
          left: `calc(0.5rem + ${highlight.startCol}ch)`,
          width: `${Math.min(highlight.endCol, lineLength) - highlight.startCol}ch`,
          backgroundColor: color,
        }}
      />
    );
  };

  const renderPlainPane = (label: string, content: string, side: "old" | "new") => {
    const lines = content.split("\n");
    return (
      <div className="flex-1 overflow-auto min-w-0 relative bg-[#1e1e1e]">
        <div className="sticky top-0 z-10 px-3 py-1 bg-[#2d2d2d] border-b border-[#404040] text-[11px] text-[#888] font-semibold uppercase tracking-wider">
          {label}
        </div>
        <pre className="m-0 p-0 bg-transparent">
          <code className="block w-max min-w-full">
            {lines.map((line, i) => {
              const lineNum = i + 1;
              const lineLength = line.length;
              const selHighlight = getLineHighlight(side, lineNum, lineLength);
              const comment = findComment(side, lineNum);
              const commentHL = comment ? getCommentHighlight(side, lineNum, lineLength, comment) : null;

              // Determine bg: full-line fallback for whole-line highlights, overlay for partial
              const isFullLineSelection = selHighlight && selHighlight.startCol === 0 && selHighlight.endCol >= lineLength;
              const isFullLineComment = commentHL && commentHL.startCol === 0 && commentHL.endCol >= lineLength;

              let bgClass = "";
              if (selHighlight && isFullLineSelection) bgClass = "!bg-[rgba(38,79,120,0.4)]";
              else if (!selHighlight && commentHL && !comment!.resolved && isFullLineComment) bgClass = "bg-[rgba(78,154,6,0.08)]";
              else if (!selHighlight && commentHL && comment!.resolved && isFullLineComment) bgClass = "bg-[rgba(128,128,128,0.05)]";

              const gutterDotColor = comment
                ? comment.resolved
                  ? "text-[#666]"
                  : "text-[#4e9a06]"
                : "";
              const gutterDotHover = comment
                ? comment.resolved
                  ? "hover:text-[#999]"
                  : "hover:text-[#73d216]"
                : "";

              return (
                <div key={i}>
                  <div
                    className={`flex items-stretch min-h-[21px] leading-[21px] select-none cursor-text hover:bg-white/[0.03] ${bgClass}`}
                    onMouseDown={(e) => {
                      const codeSpan = e.currentTarget.querySelector('[data-code-span]') as HTMLElement | null;
                      const col = codeSpan ? getColFromEvent(e, codeSpan, line) : 0;
                      handleLineMouseDown(side, lineNum, col);
                    }}
                    onMouseMove={(e) => {
                      const codeSpan = e.currentTarget.querySelector('[data-code-span]') as HTMLElement | null;
                      const col = codeSpan ? getColFromEvent(e, codeSpan, line) : 0;
                      handleLineMouseMove(side, lineNum, col);
                    }}
                  >
                    <span className="inline-flex items-center justify-end w-[50px] min-w-[50px] pr-2 font-mono text-[13px] text-[#555] text-right shrink-0 gap-1">
                      {comment ? (
                        <span
                          className={`${gutterDotColor} cursor-pointer text-[14px] leading-none shrink-0 ${gutterDotHover}`}
                          onClick={(e) => handleGutterDotClick(e, comment)}
                          title={comment.text}
                        >
                          ●
                        </span>
                      ) : null}
                      {lineNum}
                    </span>
                    <span data-code-span className="flex-1 pl-2 font-mono text-[13px] whitespace-pre relative">
                      {selHighlight && !isFullLineSelection && renderHighlightOverlay(selHighlight, "rgba(38,79,120,0.4)", lineLength)}
                      {!selHighlight && commentHL && !isFullLineComment && renderHighlightOverlay(
                        commentHL,
                        comment!.resolved ? "rgba(128,128,128,0.05)" : "rgba(78,154,6,0.08)",
                        lineLength
                      )}
                      {line ? renderHighlightedLine(line) : " "}
                    </span>
                  </div>
                  {renderInlineThread(side, lineNum)}
                </div>
              );
            })}
          </code>
        </pre>

        {/* Add comment popover */}
        {selectingSide === side && selMin !== null && selMax !== null && !isSelecting && selNorm && (
          <div
            className="absolute z-20"
            style={{ top: `${(selMax) * 21 + 28}px`, left: `min(calc(50px + 0.5rem + ${selNorm.end.col}ch), calc(100% - ${showCommentInput ? '21rem' : '2.5rem'}))` }}
          >
            {!showCommentInput ? (
              <button
                className="w-7 h-7 flex items-center justify-center border border-[#4e9a06] rounded bg-[#2d2d30] text-[#4e9a06] cursor-pointer text-[16px] hover:bg-[#3c3c3c]"
                onClick={handleAddComment}
                title={`Comment on L${selMin}${selMin !== selMax ? `–L${selMax}` : ""}`}
              >
                +
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
          <code className="block w-max min-w-full">
            {lines.map((line, i) => {
              const lineNum = side === "old" ? line.oldLineNum : line.newLineNum;
              const isSpacer =
                (side === "old" && line.type === "added") ||
                (side === "new" && line.type === "removed");
              const isRemoved = side === "old" && line.type === "removed";
              const isAdded = side === "new" && line.type === "added";
              const lineLength = line.text.length;
              const selHighlight = lineNum != null ? getLineHighlight(side, lineNum, lineLength) : null;
              const comment = lineNum != null ? findComment(side, lineNum) : undefined;
              const commentHL = comment ? getCommentHighlight(side, lineNum!, lineLength, comment) : null;

              const isFullLineSelection = selHighlight && selHighlight.startCol === 0 && selHighlight.endCol >= lineLength;
              const isFullLineComment = commentHL && commentHL.startCol === 0 && commentHL.endCol >= lineLength;

              let bgClass = "";
              if (selHighlight && isFullLineSelection) bgClass = "!bg-[rgba(38,79,120,0.4)]";
              else if (!selHighlight && commentHL && !comment!.resolved && isFullLineComment) bgClass = "bg-[rgba(78,154,6,0.08)]";
              else if (!selHighlight && commentHL && comment!.resolved && isFullLineComment) bgClass = "bg-[rgba(128,128,128,0.05)]";
              else if (isRemoved) bgClass = "bg-[rgba(244,71,71,0.18)]";
              else if (isAdded) bgClass = "bg-[rgba(106,153,85,0.18)]";

              const gutterDotColor = comment
                ? comment.resolved
                  ? "text-[#666]"
                  : "text-[#4e9a06]"
                : "";
              const gutterDotHover = comment
                ? comment.resolved
                  ? "hover:text-[#999]"
                  : "hover:text-[#73d216]"
                : "";

              return (
                <div key={i}>
                  <div
                    className={`flex items-stretch min-h-[21px] leading-[21px] select-none ${
                      isSpacer ? "bg-[rgba(128,128,128,0.04)]" : ""
                    } ${bgClass} ${lineNum != null ? "cursor-text hover:bg-white/[0.03]" : ""}`}
                    onMouseDown={(e) => {
                      if (lineNum == null) return;
                      const codeSpan = e.currentTarget.querySelector('[data-code-span]') as HTMLElement | null;
                      const col = codeSpan ? getColFromEvent(e, codeSpan, line.text) : 0;
                      handleLineMouseDown(side, lineNum, col);
                    }}
                    onMouseMove={(e) => {
                      if (lineNum == null) return;
                      const codeSpan = e.currentTarget.querySelector('[data-code-span]') as HTMLElement | null;
                      const col = codeSpan ? getColFromEvent(e, codeSpan, line.text) : 0;
                      handleLineMouseMove(side, lineNum, col);
                    }}
                  >
                    <span className="inline-flex items-center justify-end w-[50px] min-w-[50px] pr-2 font-mono text-[13px] text-[#555] text-right shrink-0 gap-1">
                      {comment ? (
                        <span
                          className={`${gutterDotColor} cursor-pointer text-[14px] leading-none shrink-0 ${gutterDotHover}`}
                          onClick={(e) => handleGutterDotClick(e, comment)}
                          title={comment.text}
                        >
                          ●
                        </span>
                      ) : null}
                      {lineNum ?? ""}
                    </span>
                    <span
                      data-code-span
                      className={`flex-1 pl-2 font-mono text-[13px] whitespace-pre relative ${
                        isSpacer ? "text-transparent" : ""
                      }`}
                    >
                      {selHighlight && !isFullLineSelection && renderHighlightOverlay(selHighlight, "rgba(38,79,120,0.4)", lineLength)}
                      {!selHighlight && commentHL && !isFullLineComment && renderHighlightOverlay(
                        commentHL,
                        comment!.resolved ? "rgba(128,128,128,0.05)" : "rgba(78,154,6,0.08)",
                        lineLength
                      )}
                      {isSpacer ? " " : line.text ? renderHighlightedLine(line.text) : " "}
                    </span>
                  </div>
                  {lineNum != null && renderInlineThread(side, lineNum)}
                </div>
              );
            })}
          </code>
        </pre>

        {/* Add comment popover */}
        {selectingSide === side && selMin !== null && selMax !== null && !isSelecting && selNorm && (
          <div
            className="absolute z-20"
            style={{ top: `${(selMax) * 21 + 28}px`, left: `min(calc(50px + 0.5rem + ${selNorm.end.col}ch), calc(100% - ${showCommentInput ? '21rem' : '2.5rem'}))` }}
          >
            {!showCommentInput ? (
              <button
                className="w-7 h-7 flex items-center justify-center border border-[#4e9a06] rounded bg-[#2d2d30] text-[#4e9a06] cursor-pointer text-[16px] hover:bg-[#3c3c3c]"
                onClick={handleAddComment}
                title={`Comment on L${selMin}${selMin !== selMax ? `–L${selMax}` : ""}`}
              >
                +
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
      {/* Hidden span to measure monospace char width */}
      <span
        ref={measureRef}
        className="font-mono text-[13px] absolute opacity-0 pointer-events-none"
        aria-hidden="true"
      >
        M
      </span>
      {/* Header bar with Send to Claude button */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#252526] border-b border-[#404040]">
        <div className="text-[12px] text-[#888]">
          {openComments.length > 0 && (
            <span>
              {openComments.length} open comment{openComments.length !== 1 ? "s" : ""}
              {comments.length - openComments.length > 0 && (
                <span className="text-[#555]">
                  {" "}&middot; {comments.length - openComments.length} resolved
                </span>
              )}
            </span>
          )}
        </div>
        <button
          className="px-3 py-1 border border-[#4e9a06] rounded bg-[#2e6b30] text-[#e0e0e0] cursor-pointer text-[12px] font-semibold hover:bg-[#3a8a3c] disabled:opacity-40 disabled:cursor-default disabled:border-[#555]"
          onClick={handleSendToClaude}
          disabled={openComments.length === 0}
        >
          Send Comments to Claude
        </button>
      </div>

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
