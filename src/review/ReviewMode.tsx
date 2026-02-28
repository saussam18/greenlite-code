import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ReviewSidebar, type ChangedFile } from "./ReviewSidebar";
import { ReviewEditor } from "./ReviewEditor";
import type { DiffLine } from "./types";
import type { Comment } from "./CommentThread";
import { MessageSquare, ChevronDown, ChevronUp, Send, FileText } from "lucide-react";

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

interface ReviewModeProps {
  isVisible: boolean;
  cwd: string;
  onModeChange: (mode: Mode) => void;
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

export function ReviewMode({ isVisible, cwd, onModeChange }: ReviewModeProps) {
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
  const [showCommentsList, setShowCommentsList] = useState(false);
  const [scrollToCommentId, setScrollToCommentId] = useState<string | null>(null);
  const commentsListRef = useRef<HTMLDivElement | null>(null);

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

  // Close comments list on click outside
  useEffect(() => {
    if (!showCommentsList) return;
    const handleClick = (e: MouseEvent) => {
      if (commentsListRef.current && !commentsListRef.current.contains(e.target as Node)) {
        setShowCommentsList(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showCommentsList]);

  const navigateToComment = (comment: Comment) => {
    // Switch to the file containing the comment
    const changedFile = files.find((f) => f.path === comment.filePath);
    if (changedFile) {
      setSelectedFile(changedFile.path);
      setSelectedStatus(changedFile.status);
      setViewMode("diff");
      setBrowseSelectedFile(null);
      setSidebarTab("changes");
    }
    setScrollToCommentId(comment.id);
    setShowCommentsList(false);
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

    invoke("pty_write", { data: prompt }).catch(console.error);
    onModeChange("build");
  };

  return (
    <div
      className="flex flex-col flex-1 overflow-hidden min-h-0"
      style={{ display: isVisible ? "flex" : "none" }}
    >
      {/* Header bar with Send to Claude button */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#252526] border-b border-[#404040] relative">
        <div className="text-[12px] text-[#888]" ref={commentsListRef}>
          {openComments.length > 0 ? (
            <button
              className="flex items-center gap-1.5 cursor-pointer hover:text-[#ccc] bg-transparent border-none text-[12px] text-[#888] p-0"
              onClick={() => setShowCommentsList(!showCommentsList)}
            >
              <MessageSquare size={13} />
              {openComments.length} open comment{openComments.length !== 1 ? "s" : ""}
              {comments.length - openComments.length > 0 && (
                <span className="text-[#555]">
                  &middot; {comments.length - openComments.length} resolved
                </span>
              )}
              {showCommentsList ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          ) : (
            <span className="flex items-center gap-1.5">
              <MessageSquare size={13} />
              No comments
            </span>
          )}
          {/* Comments dropdown */}
          {showCommentsList && (
            <div className="absolute left-2 top-full mt-0.5 z-30 w-[380px] max-h-[320px] overflow-y-auto bg-[#2d2d30] border border-[#555] rounded-md shadow-[0_4px_16px_rgba(0,0,0,0.5)]">
              {openComments.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-[#555]">No open comments</div>
              ) : (
                openComments.map((c) => (
                  <button
                    key={c.id}
                    className="w-full text-left px-3 py-2 hover:bg-white/[0.06] cursor-pointer border-b border-[#404040] last:border-b-0 bg-transparent border-x-0 border-t-0"
                    onClick={() => navigateToComment(c)}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] text-[#888] mb-0.5">
                      <FileText size={11} className="shrink-0" />
                      <span className="truncate">{c.filePath}</span>
                      <span className="text-[#555] shrink-0">
                        L{c.startLine}{c.startLine !== c.endLine ? `–${c.endLine}` : ""}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#d4d4d4] truncate">{c.text}</div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button
          className="flex items-center gap-1.5 px-3 py-1 border border-[#4e9a06] rounded bg-[#2e6b30] text-[#e0e0e0] cursor-pointer text-[12px] font-semibold hover:bg-[#3a8a3c] disabled:opacity-40 disabled:cursor-default disabled:border-[#555]"
          onClick={handleSendToClaude}
          disabled={openComments.length === 0}
        >
          <Send size={12} /> Send to Claude
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden min-h-0">
        <ReviewSidebar
          sidebarTab={sidebarTab}
          setSidebarTab={setSidebarTab}
          files={files}
          selectedFile={selectedFile}
          setSelectedFile={setSelectedFile}
          setSelectedStatus={setSelectedStatus}
          browseSelectedFile={browseSelectedFile}
          setBrowseSelectedFile={setBrowseSelectedFile}
          viewMode={viewMode}
          setViewMode={setViewMode}
          clearSelection={clearSelection}
          cwd={cwd}
        />

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
  );
}
