import { useState, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ReviewSidebar, type ChangedFile } from "./ReviewSidebar";
import { ReviewEditor } from "./ReviewEditor";
import type { DiffLine } from "./types";
import type { Comment } from "./CommentThread";

interface FileDiff {
  old_content: string;
  new_content: string;
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

export interface ReviewInfo {
  openComments: Comment[];
  resolvedCount: number;
  onSendToClaude: () => void;
  onNavigateToComment: (comment: Comment) => void;
}

interface ReviewModeProps {
  isVisible: boolean;
  cwd: string;
  onModeChange: (mode: Mode) => void;
  onReviewInfo?: (info: ReviewInfo | null) => void;
}

// --- Diff algorithm (LCS-based) ---

function computeDiff(oldText: string, newText: string): { left: DiffLine[]; right: DiffLine[] } {
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];

  const m = oldLines.length;
  const n = newLines.length;

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
      leftStack.push({ type: "added", text: "" });
      rightStack.push({ type: "added", text: newLines[j - 1], newLineNum: j });
      j--;
    } else {
      leftStack.push({ type: "removed", text: oldLines[i - 1], oldLineNum: i });
      rightStack.push({ type: "removed", text: "" });
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
    if (Array.isArray(parsed)) {
      const migrated: Comment[] = parsed.map((c: Partial<Comment> & { id: string; side: "old" | "new"; filePath: string; startLine: number; endLine: number; text: string; createdAt: string }) => ({
        ...c,
        resolved: c.resolved ?? false,
        startCol: c.startCol ?? 0,
        endCol: c.endCol ?? Infinity,
      }));
      return { commitHash: "", comments: migrated };
    }
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

// --- Main component ---

export function ReviewMode({ isVisible, cwd, onModeChange, onReviewInfo }: ReviewModeProps) {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ left: DiffLine[]; right: DiffLine[] } | null>(null);
  const [plainContent, setPlainContent] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [storedCommitHash, setStoredCommitHash] = useState("");

  const [sidebarTab, setSidebarTab] = useState<"changes" | "files">("changes");
  const [viewMode, setViewMode] = useState<"diff" | "file">("diff");
  const [browseSelectedFile, setBrowseSelectedFile] = useState<string | null>(null);
  const [scrollToCommentId, setScrollToCommentId] = useState<string | null>(null);

  // Editor tabs
  interface EditorTab {
    id: string;
    path: string;
    label: string;
    mode: "diff" | "file";
    status?: string;
  }
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);

  // Draggable sidebar width
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const draggingSidebar = useRef(false);
  const sidebarStartX = useRef(0);
  const sidebarStartW = useRef(0);

  const handleSidebarDragStart = (e: ReactMouseEvent) => {
    e.preventDefault();
    draggingSidebar.current = true;
    sidebarStartX.current = e.clientX;
    sidebarStartW.current = sidebarWidth;
  };

  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (!draggingSidebar.current) return;
      const delta = e.clientX - sidebarStartX.current;
      const newWidth = Math.max(150, Math.min(600, sidebarStartW.current + delta));
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      draggingSidebar.current = false;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

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
            setComments(() => {
              saveCommentsData(cwd, { commitHash: currentHash, comments: [] });
              return [];
            });
          } else if (!prevHash) {
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
    // This is called by sidebar when switching to file browse mode.
    // The editor also manages its own selection state internally.
  };

  // Open a diff file as a tab
  const openDiffTab = (path: string, status: string) => {
    const id = `diff:${path}`;
    const fileName = path.split("/").pop() || path;
    const label = status === "M" ? `Diff (${fileName})` : fileName;
    setEditorTabs((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      return [...prev, { id, path, label, mode: "diff", status }];
    });
    setActiveTabId(id);
    setSelectedFile(path);
    setSelectedStatus(status);
    setViewMode("diff");
    setBrowseSelectedFile(null);
  };

  // Open a browse file as a tab
  const openFileTab = (fullPath: string) => {
    const id = `file:${fullPath}`;
    const fileName = fullPath.split("/").pop() || fullPath;
    setEditorTabs((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      return [...prev, { id, path: fullPath, label: fileName, mode: "file" }];
    });
    setActiveTabId(id);
    setBrowseSelectedFile(fullPath);
    setViewMode("file");
    setSelectedFile(null);
    setSelectedStatus(null);
  };

  // Switch to an existing tab
  const switchToTab = (tab: EditorTab) => {
    setActiveTabId(tab.id);
    if (tab.mode === "diff") {
      setSelectedFile(tab.path);
      setSelectedStatus(tab.status || null);
      setViewMode("diff");
      setBrowseSelectedFile(null);
    } else {
      setBrowseSelectedFile(tab.path);
      setViewMode("file");
      setSelectedFile(null);
      setSelectedStatus(null);
    }
  };

  // Close a tab
  const closeTab = (tabId: string) => {
    setEditorTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        if (filtered.length > 0) {
          const closedIndex = prev.findIndex((t) => t.id === tabId);
          const newActive = filtered[Math.min(closedIndex, filtered.length - 1)];
          switchToTab(newActive);
        } else {
          setActiveTabId(null);
          setSelectedFile(null);
          setSelectedStatus(null);
          setBrowseSelectedFile(null);
        }
      }
      return filtered;
    });
  };

  const navigateToComment = (comment: Comment) => {
    // Switch to the file containing the comment
    const changedFile = files.find((f) => f.path === comment.filePath);
    if (changedFile) {
      openDiffTab(changedFile.path, changedFile.status);
      setSidebarTab("changes");
    }
    setScrollToCommentId(comment.id);
  };

  // Comment CRUD
  const handleAddComment = (comment: Comment) => {
    persistComments([...comments, comment]);
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

  // Send open comments to Claude via PTY
  const openComments = comments.filter((c) => !c.resolved);
  const resolvedCount = comments.length - openComments.length;

  const handleSendToClaude = () => {
    if (openComments.length === 0) return;

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

    invoke("pty_write", { data: prompt, terminalId: "term-0" }).catch(console.error);
    onModeChange("build");
  };

  // Push review info up to parent for StatusBar.
  // Use refs for callbacks so the useEffect only re-fires when comments data changes.
  const sendToClaudeRef = useRef(handleSendToClaude);
  sendToClaudeRef.current = handleSendToClaude;
  const navigateRef = useRef(navigateToComment);
  navigateRef.current = navigateToComment;

  useEffect(() => {
    if (onReviewInfo) {
      onReviewInfo({
        openComments,
        resolvedCount,
        onSendToClaude: () => sendToClaudeRef.current(),
        onNavigateToComment: (c) => navigateRef.current(c),
      });
    }
  }, [comments, onReviewInfo]);

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden min-h-0"
      style={{ display: isVisible ? "flex" : "none" }}
    >
      <div className="flex flex-1 overflow-hidden min-h-0">
        <ReviewSidebar
          sidebarTab={sidebarTab}
          setSidebarTab={setSidebarTab}
          files={files}
          selectedFile={selectedFile}
          browseSelectedFile={browseSelectedFile}
          clearSelection={clearSelection}
          cwd={cwd}
          width={sidebarWidth}
          onSelectDiff={openDiffTab}
          onSelectFile={openFileTab}
        />

        {/* Draggable divider between sidebar and editor */}
        <div
          className="w-[5px] bg-[#404040] shrink-0 cursor-col-resize hover:bg-[#569cd6] active:bg-[#569cd6] transition-colors"
          onMouseDown={handleSidebarDragStart}
        />

        {/* Editor area with tab bar */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Tab bar */}
          {editorTabs.length > 0 && (
            <div className="flex items-center bg-[#2d2d2d] border-b border-[#404040] shrink-0 select-none overflow-x-auto">
              {editorTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => switchToTab(tab)}
                  className={`flex items-center gap-1.5 px-3 py-1 text-[12px] tracking-wider border-r border-[#404040] cursor-pointer shrink-0 ${
                    activeTabId === tab.id
                      ? "bg-[#1e1e1e] text-[#d4d4d4]"
                      : "text-[#888] hover:text-[#bbb] hover:bg-[#353535]"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="text-[10px] text-[#888] hover:text-[#d4d4d4] cursor-pointer"
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}

        <ReviewEditor
          viewMode={viewMode}
          browseSelectedFile={browseSelectedFile}
          selectedFile={selectedFile}
          selectedStatus={selectedStatus}
          diff={diff}
          plainContent={plainContent}
          comments={comments}
          onAddComment={handleAddComment}
          onDeleteComment={handleDeleteComment}
          onResolveComment={handleResolveComment}
          onUnresolveComment={handleUnresolveComment}
          cwd={cwd}
          isVisible={isVisible}
          scrollToCommentId={scrollToCommentId}
          onScrolledToComment={() => setScrollToCommentId(null)}
        />
        </div>
      </div>
    </div>
  );
}
