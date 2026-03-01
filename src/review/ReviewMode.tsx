import { useState, useEffect, useCallback, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ReviewSidebar } from "./sidepanel/ReviewSidebar";
import { ReviewEditor } from "./viewers/ReviewEditor";
import { computeDiff } from "./diffAlgorithm";
import { loadCommentsData, saveCommentsData } from "./comments/commentsStorage";
import type { DiffLine, Comment, FileDiff, ReviewInfo } from "../types/review";
import type { GitInfo, ChangedFile } from "../types/git";
import type { Mode } from "../types/settings";

interface ReviewModeProps {
  isVisible: boolean;
  cwd: string;
  onModeChange: (mode: Mode) => void;
  onReviewInfo?: (info: ReviewInfo | null) => void;
}

export function ReviewMode({ isVisible, cwd, onModeChange, onReviewInfo }: ReviewModeProps) {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ left: DiffLine[]; right: DiffLine[] } | null>(null);
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

  // Load diff when file selected — all statuses go through computeDiff
  useEffect(() => {
    if (!selectedFile) {
      setDiff(null);
      return;
    }
    setDiff(null);
    invoke<FileDiff>("git_file_diff", { repoPath: cwd, filePath: selectedFile })
      .then((result) => {
        if (selectedStatus === "A") {
          setDiff(computeDiff("", result.new_content));
        } else if (selectedStatus === "D") {
          setDiff(computeDiff(result.old_content, ""));
        } else {
          setDiff(computeDiff(result.old_content, result.new_content));
        }
      })
      .catch(() => setDiff(null));
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

  const closeAllTabs = () => {
    setEditorTabs([]);
    setActiveTabId(null);
    setSelectedFile(null);
    setSelectedStatus(null);
    setBrowseSelectedFile(null);
  };

  // Cmd+Shift+W → close all tabs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "w") {
        e.preventDefault();
        closeAllTabs();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible]);

  const navigateToComment = (comment: Comment) => {
    // Switch to review mode if not already there
    onModeChange("review");

    // Check if the file is in the changed files list (diff view)
    const changedFile = files.find((f) => f.path === comment.filePath);
    if (changedFile) {
      openDiffTab(changedFile.path, changedFile.status);
      setSidebarTab("changes");
    } else {
      // File was commented from the browse tab — open as a file tab
      const fullPath = `${cwd}/${comment.filePath}`;
      openFileTab(fullPath);
      setSidebarTab("files");
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

  const handleResolveAll = () => {
    persistComments(
      comments.map((c) => (c.resolved ? c : { ...c, resolved: true }))
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
  const resolveAllRef = useRef(handleResolveAll);
  resolveAllRef.current = handleResolveAll;

  useEffect(() => {
    if (onReviewInfo) {
      onReviewInfo({
        openComments,
        resolvedCount,
        onSendToClaude: () => sendToClaudeRef.current(),
        onNavigateToComment: (c) => navigateRef.current(c),
        onResolveAll: () => resolveAllRef.current(),
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
              {editorTabs.length > 1 && (
                <button
                  onClick={closeAllTabs}
                  className="ml-auto px-2 py-1 text-[10px] text-[#888] hover:text-[#d4d4d4] cursor-pointer bg-transparent border-none shrink-0"
                  title="Close all tabs (⌘⇧W)"
                >
                  Close All
                </button>
              )}
            </div>
          )}

        <ReviewEditor
          viewMode={viewMode}
          browseSelectedFile={browseSelectedFile}
          selectedFile={selectedFile}
          diff={diff}
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
