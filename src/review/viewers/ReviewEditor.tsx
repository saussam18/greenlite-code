import { useState, useEffect, useRef, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { detectLanguage, tokenizeLine, type Language, type Token } from "../../general/syntax";
import type { Comment, DiffLine, SelectionAnchor, GutterConfig, CodeLineConfig } from "../../types/review";
import { CommentThread } from "../comments/CommentThread";
import { CommentCard } from "../comments/CommentCard";
import { MessageSquarePlus, MessageSquare, ChevronUp, ChevronDown, X } from "lucide-react";
import { FileEditorHeader } from "./FileEditorHeader";
import { ImageViewer } from "./ImageViewer";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"]);

function isImageFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTS.has(ext);
}

function mimeForExt(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "svg": return "image/svg+xml";
    case "webp": return "image/webp";
    case "ico": return "image/x-icon";
    case "bmp": return "image/bmp";
    default: return "application/octet-stream";
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface ReviewEditorProps {
  viewMode: "diff" | "file";
  browseSelectedFile: string | null;
  selectedFile: string | null;
  diff: { left: DiffLine[]; right: DiffLine[] } | null;
  comments: Comment[];
  onAddComment: (comment: Comment) => void;
  onDeleteComment: (id: string) => void;
  onResolveComment: (id: string) => void;
  onUnresolveComment: (id: string) => void;
  cwd: string;
  isVisible: boolean;
  scrollToCommentId: string | null;
  onScrolledToComment: () => void;
}

export function ReviewEditor({
  viewMode,
  browseSelectedFile,
  selectedFile,
  diff,
  comments,
  onAddComment,
  onDeleteComment,
  onResolveComment,
  onUnresolveComment,
  cwd,
  isVisible,
  scrollToCommentId,
  onScrolledToComment,
}: ReviewEditorProps) {
  // File editor state
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const lineNumRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const searchOverlayRef = useRef<HTMLDivElement | null>(null);

  // File view comment (supports multi-line range)
  const [fileCommentStartLine, setFileCommentStartLine] = useState<number | null>(null);
  const [fileCommentEndLine, setFileCommentEndLine] = useState<number | null>(null);
  const [fileCommentText, setFileCommentText] = useState("");

  // Selection state (column-aware)
  const [selectingSide, setSelectingSide] = useState<"old" | "new" | null>(null);
  const [selectionStart, setSelectionStart] = useState<SelectionAnchor | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<SelectionAnchor | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  // Measure monospace char width
  const charWidthRef = useRef<number>(0);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (isVisible && measureRef.current) {
      charWidthRef.current = measureRef.current.getBoundingClientRect().width;
    }
  }, [isVisible]);

  // Comment input (diff view)
  const [commentInput, setCommentInput] = useState("");
  const [showCommentInput, setShowCommentInput] = useState(false);

  // Track which inline threads are collapsed
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());

  // Read-only toast for diff view
  const [readOnlyToast, setReadOnlyToast] = useState(false);
  const readOnlyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Brief suppression of comment popover to prevent it appearing between double-click mousedowns
  const [popoverSuppressed, setPopoverSuppressed] = useState(false);
  const popoverSuppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Visual row index of selection end (for popover positioning in diff view)
  const [selEndRow, setSelEndRow] = useState<number | null>(null);

  const clearSelection = () => {
    setSelectingSide(null);
    setSelectionStart(null);
    setSelectionEnd(null);
    setSelEndRow(null);
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

  const getWordBoundsAt = (text: string, col: number): { start: number; end: number } => {
    const wordChar = /[\w$]/;
    if (col >= text.length || !wordChar.test(text[col])) {
      // Clicked on non-word char — try one to the left
      if (col > 0 && wordChar.test(text[col - 1])) {
        col = col - 1;
      } else {
        return { start: col, end: col };
      }
    }
    let start = col;
    let end = col;
    while (start > 0 && wordChar.test(text[start - 1])) start--;
    while (end < text.length && wordChar.test(text[end])) end++;
    return { start, end };
  };

  const handleLineDoubleClick = (side: "old" | "new", lineNum: number, col: number, row: number, lineText: string) => {
    const { start, end } = getWordBoundsAt(lineText, col);
    if (start === end) return;
    setIsSelecting(false);
    setSelectingSide(side);
    setSelectionStart({ line: lineNum, col: start });
    setSelectionEnd({ line: lineNum, col: end });
    setSelEndRow(row);
    setShowCommentInput(false);
    setCommentInput("");
  };

  const handleLineMouseDown = (side: "old" | "new", lineNum: number, col: number, row: number) => {
    setIsSelecting(true);
    setSelectingSide(side);
    setSelectionStart({ line: lineNum, col });
    setSelectionEnd({ line: lineNum, col });
    setSelEndRow(row);
    setShowCommentInput(false);
    setCommentInput("");
    // Suppress popover briefly to prevent it appearing between double-click mousedowns
    setPopoverSuppressed(true);
    if (popoverSuppressTimer.current) clearTimeout(popoverSuppressTimer.current);
    popoverSuppressTimer.current = setTimeout(() => setPopoverSuppressed(false), 300);
  };

  const handleLineMouseMove = (side: "old" | "new", lineNum: number, col: number, row: number) => {
    if (isSelecting && side === selectingSide) {
      setSelectionEnd({ line: lineNum, col });
      setSelEndRow(row);
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
      if (start.col === end.col) return { startCol: 0, endCol: lineLength };
      return { startCol: start.col, endCol: end.col };
    }
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

  const browseRelativePath = browseSelectedFile ? browseSelectedFile.replace(cwd + "/", "") : null;
  const activeFilePath = selectedFile || browseRelativePath;

  const fileComments = activeFilePath
    ? comments.filter((c) => c.filePath === activeFilePath)
    : [];

  const findComment = (side: "old" | "new", lineNum: number): Comment | undefined => {
    return fileComments.find(
      (c) => c.side === side && lineNum >= c.startLine && lineNum <= c.endLine
    );
  };

  const getCommentsEndingAtLine = (side: "old" | "new", lineNum: number): Comment[] => {
    return fileComments.filter((c) => c.side === side && c.endLine === lineNum);
  };

  const createComment = (
    text: string,
    filePath: string,
    side: "old" | "new",
    startLine: number,
    endLine: number,
    startCol: number,
    endCol: number,
  ): Comment => ({
    id: crypto.randomUUID(),
    side,
    filePath,
    startLine,
    endLine,
    startCol,
    endCol,
    text,
    createdAt: new Date().toISOString(),
    resolved: false,
  });

  const handleAddComment = () => setShowCommentInput(true);

  const handleSubmitComment = () => {
    if (!commentInput.trim() || !selectedFile || !selectingSide || !selNorm) return;

    const isSinglePoint = selNorm.start.line === selNorm.end.line && selNorm.start.col === selNorm.end.col;
    onAddComment(createComment(
      commentInput.trim(),
      selectedFile,
      selectingSide,
      selNorm.start.line,
      selNorm.end.line,
      isSinglePoint ? 0 : selNorm.start.col,
      isSinglePoint ? Infinity : selNorm.end.col,
    ));
    clearSelection();
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

  const handleFileCommentSubmit = () => {
    if (!fileCommentText.trim() || fileCommentStartLine === null || fileCommentEndLine === null || !browseSelectedFile) return;
    const relativePath = browseSelectedFile.replace(cwd + "/", "");
    const startLine = Math.min(fileCommentStartLine, fileCommentEndLine);
    const endLine = Math.max(fileCommentStartLine, fileCommentEndLine);
    onAddComment(createComment(
      fileCommentText.trim(),
      relativePath,
      "old",
      startLine,
      endLine,
      0,
      Infinity,
    ));
    setFileCommentStartLine(null);
    setFileCommentEndLine(null);
    setFileCommentText("");
  };

  const closeFileComment = () => {
    setFileCommentStartLine(null);
    setFileCommentEndLine(null);
    setFileCommentText("");
  };

  // Load file content when browsing files
  useEffect(() => {
    if (viewMode !== "file" || !browseSelectedFile) {
      setFileContent(null);
      setEditContent("");
      setIsDirty(false);
      setFileError(null);
      setImageDataUrl(null);
      return;
    }
    // Clear file comment when switching files
    setFileCommentStartLine(null);
    setFileCommentEndLine(null);
    setFileCommentText("");
    setFileError(null);
    setFileContent(null);
    setImageDataUrl(null);

    if (isImageFile(browseSelectedFile)) {
      readFile(browseSelectedFile)
        .then((bytes) => {
          const mime = mimeForExt(browseSelectedFile);
          const b64 = uint8ToBase64(new Uint8Array(bytes));
          setImageDataUrl(`data:${mime};base64,${b64}`);
        })
        .catch((err) => {
          setFileError(String(err));
        });
    } else {
      readTextFile(browseSelectedFile)
        .then((content) => {
          setFileContent(content);
          setEditContent(content);
          setIsDirty(false);
        })
        .catch((err) => {
          setFileContent(null);
          setEditContent("");
          setFileError(String(err));
        });
    }
  }, [viewMode, browseSelectedFile]);

  // Save file on Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;
      if (viewMode === "file" && browseSelectedFile && (e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        writeTextFile(browseSelectedFile, editContent)
          .then(() => {
            setFileContent(editContent);
            setIsDirty(false);
            setSaveStatus("Saved");
            setTimeout(() => setSaveStatus(null), 2000);
          })
          .catch(() => {
            setSaveStatus("Save failed");
            setTimeout(() => setSaveStatus(null), 3000);
          });
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, viewMode, browseSelectedFile, editContent]);

  // Escape key + Ctrl+F search + read-only toast for diff view typing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;
      // Ctrl/Cmd+F → open search
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }
      if (e.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          setSearchQuery("");
          setCurrentMatch(0);
        } else {
          clearSelection();
        }
        return;
      }
      // Show read-only toast when typing in diff view (but not when focused on a comment input)
      const tag = (e.target as HTMLElement)?.tagName;
      if (viewMode === "diff" && selectingSide && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1 && tag !== "TEXTAREA" && tag !== "INPUT") {
        if (readOnlyTimer.current) clearTimeout(readOnlyTimer.current);
        setReadOnlyToast(true);
        readOnlyTimer.current = setTimeout(() => setReadOnlyToast(false), 2000);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, viewMode, selectingSide, searchOpen]);

  // Scroll metrics for scroll decorations viewport indicator
  const [scrollMetrics, setScrollMetrics] = useState<Record<string, { scrollTop: number; scrollHeight: number; clientHeight: number }>>({});
  const paneScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const handlePaneScroll = (side: "old" | "new") => {
    const el = paneScrollRefs.current[side];
    if (!el) return;
    setScrollMetrics((prev) => ({
      ...prev,
      [side]: { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
    }));
  };

  // Scroll to comment when requested
  const diffContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!scrollToCommentId) return;
    const comment = comments.find((c) => c.id === scrollToCommentId);
    if (!comment) return;
    // Wait a tick for DOM to render after file switch
    const timer = setTimeout(() => {
      if (viewMode === "file") {
        // File browse mode — scroll to the line and show the overlay
        setFileCommentStartLine(null);
        setFileCommentEndLine(null);
        if (editorRef.current) {
          const lineHeight = 21;
          const targetScroll = (comment.startLine - 1) * lineHeight - editorRef.current.clientHeight / 2 + lineHeight;
          editorRef.current.scrollTop = Math.max(0, targetScroll);
          if (highlightRef.current) {
            highlightRef.current.scrollTop = editorRef.current.scrollTop;
          }
          if (lineNumRef.current) {
            lineNumRef.current.scrollTop = editorRef.current.scrollTop;
          }
          if (overlayRef.current) {
            overlayRef.current.scrollTop = editorRef.current.scrollTop;
          }
        }
        // Make sure the overlay is visible (not collapsed)
        setCollapsedThreads((prev) => {
          const next = new Set(prev);
          next.delete(comment.id);
          return next;
        });
        onScrolledToComment();
      } else {
        // Diff mode
        const container = diffContainerRef.current;
        if (!container) { onScrolledToComment(); return; }
        const side = comment.side;
        const lineNum = comment.startLine;
        const el = container.querySelector(`[data-line-${side}="${lineNum}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          // Flash highlight
          el.classList.add("!bg-[rgba(78,154,6,0.25)]");
          setTimeout(() => el.classList.remove("!bg-[rgba(78,154,6,0.25)]"), 1500);
        }
        onScrolledToComment();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollToCommentId]);

  // Search match computation
  const searchMatches = useMemo(() => {
    if (!searchQuery || !searchOpen) return [];
    const query = searchQuery.toLowerCase();
    const matches: { line: number; startCol: number; endCol: number; side: "old" | "new" }[] = [];

    if (viewMode === "file" && fileContent !== null) {
      const lines = editContent.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const lower = lines[i].toLowerCase();
        let idx = 0;
        while ((idx = lower.indexOf(query, idx)) !== -1) {
          matches.push({ line: i + 1, startCol: idx, endCol: idx + query.length, side: "old" });
          idx += 1;
        }
      }
    } else if (diff) {
      // Interleave matches by visual row so navigation goes top-to-bottom across both panes
      for (let ri = 0; ri < diff.left.length; ri++) {
        const leftLine = diff.left[ri];
        const leftLineNum = leftLine.oldLineNum;
        if (leftLineNum != null) {
          const lower = leftLine.text.toLowerCase();
          let idx = 0;
          while ((idx = lower.indexOf(query, idx)) !== -1) {
            matches.push({ line: leftLineNum, startCol: idx, endCol: idx + query.length, side: "old" });
            idx += 1;
          }
        }
        const rightLine = diff.right[ri];
        const rightLineNum = rightLine.newLineNum;
        if (rightLineNum != null) {
          const lower = rightLine.text.toLowerCase();
          let idx = 0;
          while ((idx = lower.indexOf(query, idx)) !== -1) {
            matches.push({ line: rightLineNum, startCol: idx, endCol: idx + query.length, side: "new" });
            idx += 1;
          }
        }
      }
    }

    return matches;
  }, [searchQuery, searchOpen, viewMode, editContent, fileContent, diff]);

  // Clamp currentMatch when matches change
  useEffect(() => {
    if (searchMatches.length === 0) {
      setCurrentMatch(0);
    } else if (currentMatch >= searchMatches.length) {
      setCurrentMatch(0);
    }
  }, [searchMatches.length]);

  // Scroll to current match
  useEffect(() => {
    if (searchMatches.length === 0 || !searchOpen) return;
    const match = searchMatches[currentMatch];
    if (!match) return;
    const lineHeight = 21;

    if (viewMode === "file") {
      if (editorRef.current) {
        const targetScroll = (match.line - 1) * lineHeight - editorRef.current.clientHeight / 2 + lineHeight;
        editorRef.current.scrollTop = Math.max(0, targetScroll);
        if (highlightRef.current) highlightRef.current.scrollTop = editorRef.current.scrollTop;
        if (lineNumRef.current) lineNumRef.current.scrollTop = editorRef.current.scrollTop;
        if (overlayRef.current) overlayRef.current.scrollTop = editorRef.current.scrollTop;
        if (searchOverlayRef.current) searchOverlayRef.current.scrollTop = editorRef.current.scrollTop;
      }
    } else {
      const side = match.side;
      const pane = paneScrollRefs.current[side];
      if (pane) {
        const el = pane.querySelector(`[data-line-${side}="${match.line}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    }
  }, [currentMatch, searchMatches, searchOpen, viewMode]);

  // Draggable divider between before/after panes
  const [leftPaneFraction, setLeftPaneFraction] = useState(0.5);
  const draggingDiff = useRef(false);
  const diffContainerWidth = useRef(0);

  const handleDiffDragStart = (e: ReactMouseEvent) => {
    e.preventDefault();
    draggingDiff.current = true;
    if (diffContainerRef.current) {
      diffContainerWidth.current = diffContainerRef.current.getBoundingClientRect().width;
    }
  };

  useEffect(() => {
    const onMouseMove = (e: globalThis.MouseEvent) => {
      if (!draggingDiff.current || !diffContainerRef.current) return;
      const rect = diffContainerRef.current.getBoundingClientRect();
      const fraction = (e.clientX - rect.left) / rect.width;
      setLeftPaneFraction(Math.max(0.15, Math.min(0.85, fraction)));
    };
    const onMouseUp = () => {
      draggingDiff.current = false;
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Line range for popover positioning
  const selMin = selNorm ? selNorm.start.line : null;
  const selMax = selNorm ? selNorm.end.line : null;

  const activePath = viewMode === "file" ? browseSelectedFile : selectedFile;
  const lang: Language = useMemo(
    () => (activePath ? detectLanguage(activePath) : null),
    [activePath]
  );

  // Pre-compute tokenization for all visible lines with block comment state tracking
  const preTokenized = useMemo(() => {
    const result = { old: [] as Token[][], new: [] as Token[][], file: [] as Token[][] };
    if (!lang) return result;

    if (viewMode === "diff" && diff) {
      let oldInBlock = false;
      let newInBlock = false;
      for (let i = 0; i < diff.left.length; i++) {
        const leftLine = diff.left[i];
        if (leftLine.type === "added") {
          result.old.push([]);
        } else {
          const r = tokenizeLine(leftLine.text, lang, oldInBlock);
          result.old.push(r.tokens);
          oldInBlock = r.inBlockComment;
        }
        const rightLine = diff.right[i];
        if (rightLine.type === "removed") {
          result.new.push([]);
        } else {
          const r = tokenizeLine(rightLine.text, lang, newInBlock);
          result.new.push(r.tokens);
          newInBlock = r.inBlockComment;
        }
      }
    }

    if (viewMode === "file" && fileContent !== null) {
      const lines = editContent.split("\n");
      let inBlock = false;
      for (const line of lines) {
        const r = tokenizeLine(line, lang, inBlock);
        result.file.push(r.tokens);
        inBlock = r.inBlockComment;
      }
    }

    return result;
  }, [lang, viewMode, diff, editContent, fileContent]);

  const renderHighlightedLine = (tokens: Token[]) => {
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
          onResolve={onResolveComment}
          onUnresolve={onUnresolveComment}
          onDelete={onDeleteComment}
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

  const renderCommentPopover = (side: "old" | "new") => {
    if (selectingSide !== side || selMin === null || selMax === null || selEndRow === null || isSelecting || !selNorm || !selectionEnd || !selectionStart) return null;
    // Suppress popover briefly after mousedown to prevent it appearing between double-click events
    if (popoverSuppressed && !showCommentInput) return null;
    // Place button on the side opposite to the highlight
    const endAfterStart = selectionEnd.line > selectionStart.line ||
      (selectionEnd.line === selectionStart.line && selectionEnd.col >= selectionStart.col);
    const charW = charWidthRef.current || 7.8;
    const cursorX = 50 + 8 + selectionEnd.col * charW; // gutter(50) + padding(8px/0.5rem) + col * charWidth
    const buttonLeft = endAfterStart
      ? `${cursorX + 2}px`
      : `${cursorX - 22}px`;
    const topPx = selEndRow * 21 + 24; // row * lineHeight + sticky header
    return (
      <div
        className="absolute z-30 flex items-start"
        style={{ top: `${topPx}px`, left: buttonLeft }}
      >
        {!showCommentInput ? (
          <button
            className="w-5 h-5 flex items-center justify-center rounded-full bg-[#2d2d30] text-[#4e9a06] cursor-pointer hover:text-[#73d216] hover:bg-[#3c3c3c] p-0 leading-none shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
            onClick={handleAddComment}
            title={`Comment on L${selMin}${selMin !== selMax ? `–L${selMax}` : ""}`}
          >
            <MessageSquarePlus size={12} />
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
    );
  };

  const renderGutterCell = (side: "old" | "new", lineNum: number | undefined, config?: GutterConfig) => {
    const comment = lineNum != null ? findComment(side, lineNum) : undefined;
    const gutterDotColor = comment
      ? comment.resolved ? "text-[#666]" : "text-[#4e9a06]"
      : "";
    const gutterDotHover = comment
      ? comment.resolved ? "hover:text-[#999]" : "hover:text-[#73d216]"
      : "";

    if (config?.fileView) {
      const isInRange = fileCommentStartLine !== null && fileCommentEndLine !== null && lineNum != null &&
        lineNum >= Math.min(fileCommentStartLine, fileCommentEndLine) &&
        lineNum <= Math.max(fileCommentStartLine, fileCommentEndLine);
      return (
        <div
          className={`group inline-flex items-center justify-end w-[50px] min-w-[50px] h-[21px] leading-[21px] pr-2 font-mono text-[13px] text-[#555] shrink-0 ${
            isInRange ? "bg-[rgba(78,154,6,0.12)]" : ""
          }`}
        >
          {comment ? (
            <span
              className={`w-[16px] flex items-center justify-center shrink-0 cursor-pointer ${
                comment.resolved ? "text-[#666] hover:text-[#999]" : "text-[#4e9a06] hover:text-[#73d216]"
              }`}
              onClick={() => handleGutterDotClick({ stopPropagation: () => {} } as React.MouseEvent, comment)}
              title={collapsedThreads.has(comment.id) ? comment.text : "Click to collapse"}
            >
              <MessageSquare size={11} />
            </span>
          ) : (
            <span
              className="w-[16px] flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 cursor-pointer hover:!text-[#4e9a06] shrink-0"
              onClick={(e) => {
                if (lineNum != null && config?.onGutterClick) {
                  config.onGutterClick(lineNum, e.shiftKey);
                }
              }}
            >
              <MessageSquarePlus size={11} />
            </span>
          )}
          <span className="flex-1 text-right">{lineNum ?? ""}</span>
        </div>
      );
    }

    return (
      <span className="inline-flex items-center justify-end w-[50px] min-w-[50px] pr-2 font-mono text-[13px] text-[#555] text-right shrink-0 gap-1">
        {comment ? (
          <span
            className={`${gutterDotColor} cursor-pointer leading-none shrink-0 ${gutterDotHover}`}
            onClick={(e) => handleGutterDotClick(e, comment)}
            title={comment.text}
          >
            <MessageSquare size={12} />
          </span>
        ) : null}
        {lineNum ?? ""}
      </span>
    );
  };

  const renderCodeLineContent = (side: "old" | "new", line: DiffLine, lineNum: number | undefined, config: CodeLineConfig, isSpacer?: boolean, tokens?: Token[]) => {
    const lineLength = line.text.length;
    const selHighlight = config.showSelection && lineNum != null ? getLineHighlight(side, lineNum, lineLength) : null;
    const comment = lineNum != null ? findComment(side, lineNum) : undefined;
    const commentHL = comment ? getCommentHighlight(side, lineNum!, lineLength, comment) : null;

    const isFullLineSelection = selHighlight && selHighlight.startCol === 0 && selHighlight.endCol >= lineLength;
    const isFullLineComment = commentHL && commentHL.startCol === 0 && commentHL.endCol >= lineLength;

    return (
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
        {/* Search match highlights */}
        {searchOpen && searchQuery && lineNum != null && searchMatches.map((m, mi) => (
          m.side === side && m.line === lineNum ? (
            <span
              key={`s${mi}`}
              className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: `calc(0.5rem + ${m.startCol}ch)`,
                width: `${m.endCol - m.startCol}ch`,
                backgroundColor: mi === currentMatch ? "rgba(255,200,0,0.5)" : "rgba(255,200,0,0.3)",
              }}
            />
          ) : null
        ))}
        {/* Blinking cursor at selection end */}
        {config.showSelection && selectingSide === side && selectionEnd && selectionEnd.line === lineNum && !isSelecting && (
          <span
            className="absolute top-0 bottom-0 w-[1.5px] bg-[#d4d4d4] animate-[blink_1s_step-end_infinite] pointer-events-none z-10"
            style={{ left: `calc(0.5rem + ${selectionEnd.col}ch)` }}
          />
        )}
        {isSpacer ? " " : line.text ? renderHighlightedLine(tokens ?? tokenizeLine(line.text, lang).tokens) : " "}
      </span>
    );
  };

  const renderDiffLine = (side: "old" | "new", line: DiffLine, i: number, isDiffPane: boolean) => {
    const tokens = side === "old" ? preTokenized.old[i] : preTokenized.new[i];
    const lineNum = side === "old" ? line.oldLineNum : line.newLineNum;
    const isSpacer = isDiffPane && (
      (side === "old" && line.type === "added") ||
      (side === "new" && line.type === "removed")
    );
    const isRemoved = isDiffPane && side === "old" && line.type === "removed";
    const isAdded = isDiffPane && side === "new" && line.type === "added";
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

    const lineDataAttrs: Record<string, string> = {};
    if (lineNum != null) lineDataAttrs[`data-line-${side}`] = String(lineNum);

    return (
      <div key={i}>
        <div
          {...lineDataAttrs}
          className={`flex items-stretch min-h-[21px] leading-[21px] select-none transition-colors duration-300 ${
            isSpacer ? "bg-[rgba(128,128,128,0.04)]" : ""
          } ${bgClass} ${lineNum != null ? "cursor-text hover:bg-white/[0.03]" : ""}`}
          onMouseDown={(e) => {
            if (lineNum == null) return;
            const codeSpan = e.currentTarget.querySelector('[data-code-span]') as HTMLElement | null;
            const col = codeSpan ? getColFromEvent(e, codeSpan, line.text) : 0;
            handleLineMouseDown(side, lineNum, col, i);
          }}
          onDoubleClick={(e) => {
            if (lineNum == null) return;
            const codeSpan = e.currentTarget.querySelector('[data-code-span]') as HTMLElement | null;
            const col = codeSpan ? getColFromEvent(e, codeSpan, line.text) : 0;
            handleLineDoubleClick(side, lineNum, col, i, line.text);
          }}
          onMouseMove={(e) => {
            if (lineNum == null) return;
            const codeSpan = e.currentTarget.querySelector('[data-code-span]') as HTMLElement | null;
            const col = codeSpan ? getColFromEvent(e, codeSpan, line.text) : 0;
            handleLineMouseMove(side, lineNum, col, i);
          }}
          onContextMenu={(e) => {
            if (lineNum == null) return;
            e.preventDefault();
            const codeSpan = e.currentTarget.querySelector('[data-code-span]') as HTMLElement | null;
            const col = codeSpan ? getColFromEvent(e, codeSpan, line.text) : 0;
            // If no existing selection, create a point selection at the right-click position
            if (!selNorm || selectingSide !== side) {
              setSelectingSide(side);
              setSelectionStart({ line: lineNum, col });
              setSelectionEnd({ line: lineNum, col });
              setSelEndRow(i);
            }
            setShowCommentInput(true);
          }}
        >
          {renderGutterCell(side, lineNum)}
          {renderCodeLineContent(side, line, lineNum, { showSelection: true, showDiffColors: isDiffPane }, isSpacer, tokens)}
        </div>
        {lineNum != null && renderInlineThread(side, lineNum)}
      </div>
    );
  };

  const renderScrollDecorations = (side: "old" | "new", lines: DiffLine[]) => {
    if (lines.length === 0) return null;
    const total = lines.length;

    // Build change regions
    const regions: { start: number; end: number; type: "added" | "removed" }[] = [];
    let i = 0;
    while (i < total) {
      const line = lines[i];
      const isChange =
        (side === "old" && line.type === "removed") ||
        (side === "new" && line.type === "added");
      if (isChange) {
        const start = i;
        while (
          i < total &&
          ((side === "old" && lines[i].type === "removed") ||
            (side === "new" && lines[i].type === "added"))
        ) {
          i++;
        }
        regions.push({ start, end: i, type: line.type as "added" | "removed" });
      } else {
        i++;
      }
    }

    // Viewport indicator
    const metrics = scrollMetrics[side];
    let viewportTop = 0;
    let viewportHeight = 100;
    if (metrics && metrics.scrollHeight > metrics.clientHeight) {
      viewportTop = (metrics.scrollTop / metrics.scrollHeight) * 100;
      viewportHeight = (metrics.clientHeight / metrics.scrollHeight) * 100;
    }

    return (
      <div className="absolute top-0 right-0 w-[16px] h-full pointer-events-none z-20 bg-[#1a1a1a]/50">
        {/* Change markers */}
        {regions.map((r, idx) => {
          const topPct = (r.start / total) * 100;
          const heightPct = ((r.end - r.start) / total) * 100;
          return (
            <div
              key={idx}
              className="absolute right-[1px] left-[1px] rounded-sm"
              style={{
                top: `${topPct}%`,
                height: `${heightPct}%`,
                minHeight: "2px",
                backgroundColor:
                  r.type === "removed"
                    ? "rgba(244, 71, 71, 0.7)"
                    : "rgba(106, 153, 85, 0.7)",
              }}
            />
          );
        })}
        {/* Viewport indicator */}
        <div
          className="absolute w-full border border-[#888]/40"
          style={{
            top: `${viewportTop}%`,
            height: `${viewportHeight}%`,
            backgroundColor: "rgba(255, 255, 255, 0.08)",
          }}
        />
      </div>
    );
  };

  const renderPane = (side: "old" | "new", lines: DiffLine[], widthPercent?: string) => {
    return (
      <div className="relative min-w-0 bg-[#1e1e1e]" style={{ width: widthPercent, flexShrink: 0 }}>
        {/* Scrollable content */}
        <div
          ref={(el) => { paneScrollRefs.current[side] = el; }}
          className="absolute inset-0 overflow-auto"
          onScroll={() => handlePaneScroll(side)}
        >
          <div className="sticky top-0 z-10 px-3 py-1 bg-[#2d2d2d] border-b border-[#404040] text-[11px] text-[#888] font-semibold uppercase tracking-wider">
            {side === "old" ? "Before" : "After"}
          </div>
          <pre className="m-0 p-0 bg-transparent">
            <code className="block w-max min-w-full">
              {lines.map((line, i) => renderDiffLine(side, line, i, true))}
            </code>
          </pre>
          {renderCommentPopover(side)}
        </div>
        {/* Fixed scroll decorations overlay */}
        {renderScrollDecorations(side, lines)}
      </div>
    );
  };

  const renderFileEditorBody = () => {
    if (fileError) {
      return (
        <div className="flex-1 flex items-center justify-center text-[#f44747] text-sm px-4 text-center">
          {fileError}
        </div>
      );
    }

    if (imageDataUrl) {
      return <ImageViewer src={imageDataUrl} alt={browseSelectedFile!.split("/").pop() || ""} />;
    }

    if (fileContent !== null) {
      const fileLines = editContent.split("\n");
      const visibleComments = fileComments.filter((c) => !collapsedThreads.has(c.id));

      const gutterClickHandler = (lineNum: number, shiftKey: boolean) => {
        if (shiftKey && fileCommentStartLine !== null) {
          setFileCommentEndLine(lineNum);
        } else {
          setFileCommentStartLine(lineNum);
          setFileCommentEndLine(lineNum);
          setFileCommentText("");
        }
      };

      const syncScroll = () => {
        if (!editorRef.current) return;
        const { scrollTop, scrollLeft } = editorRef.current;
        if (highlightRef.current) {
          highlightRef.current.scrollTop = scrollTop;
          highlightRef.current.scrollLeft = scrollLeft;
        }
        if (lineNumRef.current) {
          lineNumRef.current.scrollTop = scrollTop;
        }
        if (overlayRef.current) {
          overlayRef.current.scrollTop = scrollTop;
        }
        if (searchOverlayRef.current) {
          searchOverlayRef.current.scrollTop = scrollTop;
          searchOverlayRef.current.scrollLeft = scrollLeft;
        }
      };

      return (
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Line numbers with comment icons */}
          <div
            ref={lineNumRef}
            className="w-[50px] min-w-[50px] overflow-hidden bg-[#1e1e1e] shrink-0 select-none"
          >
            {fileLines.map((_, i) => (
              <div key={i}>
                {renderGutterCell("old", i + 1, { fileView: true, onGutterClick: gutterClickHandler })}
              </div>
            ))}
          </div>
          {/* Code area with syntax highlight + textarea + comment overlays */}
          <div className="flex-1 relative overflow-hidden min-w-0">
            {/* Syntax highlight + comment/search overlay layer */}
            <pre
              ref={highlightRef}
              className="absolute inset-0 m-0 p-0 bg-transparent overflow-hidden pointer-events-none"
            >
              <code className="block">
                {fileLines.map((line, i) => (
                  <div
                    key={i}
                    className="h-[21px] leading-[21px] whitespace-pre flex"
                  >
                    {renderCodeLineContent("old", { type: "unchanged", text: line, oldLineNum: i + 1 }, i + 1, { showSelection: false, showDiffColors: false }, false, preTokenized.file[i])}
                  </div>
                ))}
              </code>
            </pre>
            {/* Textarea for editing */}
            <textarea
              ref={editorRef}
              className="absolute inset-0 w-full h-full font-mono text-[13px] leading-[21px] bg-transparent text-transparent resize-none outline-none border-none pl-2 pr-2"
              style={{ caretColor: "#d4d4d4" }}
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                setIsDirty(e.target.value !== fileContent);
              }}
              onScroll={syncScroll}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              wrap="off"
            />
            {/* Comment overlays — floating on top, scroll synced */}
            <div
              ref={overlayRef}
              className="absolute inset-0 overflow-hidden pointer-events-none z-10"
            >
              <div style={{ height: `${fileLines.length * 21}px`, position: "relative" }}>
                {visibleComments.map((comment) => (
                  <div
                    key={comment.id}
                    className="absolute left-0 right-[16px] pointer-events-auto mx-1"
                    style={{ top: `${comment.endLine * 21}px` }}
                  >
                    <CommentCard
                      comment={comment}
                      onResolve={onResolveComment}
                      onUnresolve={onUnresolveComment}
                      onDelete={onDeleteComment}
                      onCollapse={() => handleGutterDotClick({ stopPropagation: () => {} } as React.MouseEvent, comment)}
                    />
                  </div>
                ))}
                {/* Inline comment creation popover */}
                {fileCommentStartLine !== null && fileCommentEndLine !== null && (
                  <div
                    className="absolute left-0 pointer-events-auto mx-1 z-20 max-w-[400px]"
                    style={{ top: `${Math.max(fileCommentStartLine, fileCommentEndLine) * 21}px` }}
                  >
                    <div className="bg-[#2d2d30] border border-[#4e9a06] rounded-md p-2 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
                      <div className="text-[11px] text-[#888] mb-1.5">
                        {fileCommentStartLine === fileCommentEndLine
                          ? `Comment on line ${fileCommentStartLine}`
                          : `Comment on lines ${Math.min(fileCommentStartLine, fileCommentEndLine)}–${Math.max(fileCommentStartLine, fileCommentEndLine)}`}
                        {fileCommentStartLine === fileCommentEndLine && (
                          <span className="text-[#555] ml-2">Shift+click another line for a range</span>
                        )}
                      </div>
                      <textarea
                        className="w-full min-h-[60px] px-2 py-1.5 border border-[#555] rounded bg-[#1e1e1e] text-[#d4d4d4] font-[inherit] text-[13px] resize-y outline-none focus:border-[#4e9a06]"
                        placeholder="Add a comment..."
                        value={fileCommentText}
                        onChange={(e) => setFileCommentText(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleFileCommentSubmit();
                          if (e.key === "Escape") closeFileComment();
                        }}
                      />
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="text-[10px] text-[#555]">Cmd+Enter to submit</span>
                        <div className="flex gap-1.5">
                          <button
                            className="px-3 py-1 border border-[#555] rounded bg-[#3c3c3c] text-[#d4d4d4] cursor-pointer text-xs hover:bg-[#4a4a4a]"
                            onClick={closeFileComment}
                          >
                            Cancel
                          </button>
                          <button
                            className="px-3 py-1 border border-[#4e9a06] rounded bg-[#2e6b30] text-[#e0e0e0] cursor-pointer text-xs hover:bg-[#3a8a3c] disabled:opacity-40 disabled:cursor-default"
                            onClick={handleFileCommentSubmit}
                            disabled={!fileCommentText.trim()}
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex items-center justify-center text-[#555] text-sm">
        Loading...
      </div>
    );
  };

  const renderSearchBar = () => {
    const matchCount = searchMatches.length;
    const matchLabel = matchCount > 0 ? `${currentMatch + 1} of ${matchCount}` : "No results";

    return (
      <div className="absolute top-2 right-6 z-40 flex items-center gap-1 bg-[#2d2d30] border border-[#555] rounded px-2 py-1 shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
        <input
          ref={searchInputRef}
          className="bg-[#1e1e1e] text-[#d4d4d4] border border-[#555] rounded px-2 py-0.5 text-[13px] font-mono outline-none focus:border-[#4e9a06] w-48"
          placeholder="Find..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setCurrentMatch(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (matchCount === 0) return;
              if (e.shiftKey) {
                setCurrentMatch((prev) => (prev - 1 + matchCount) % matchCount);
              } else {
                setCurrentMatch((prev) => (prev + 1) % matchCount);
              }
            }
            if (e.key === "Escape") {
              setSearchOpen(false);
              setSearchQuery("");
              setCurrentMatch(0);
            }
          }}
        />
        <span className="text-[#888] text-[11px] min-w-[60px] text-center whitespace-nowrap">
          {searchQuery ? matchLabel : ""}
        </span>
        <button
          className="p-0.5 text-[#888] hover:text-[#d4d4d4] cursor-pointer bg-transparent border-none"
          onClick={() => { if (matchCount > 0) setCurrentMatch((prev) => (prev - 1 + matchCount) % matchCount); }}
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp size={14} />
        </button>
        <button
          className="p-0.5 text-[#888] hover:text-[#d4d4d4] cursor-pointer bg-transparent border-none"
          onClick={() => { if (matchCount > 0) setCurrentMatch((prev) => (prev + 1) % matchCount); }}
          title="Next match (Enter)"
        >
          <ChevronDown size={14} />
        </button>
        <button
          className="p-0.5 text-[#888] hover:text-[#d4d4d4] cursor-pointer bg-transparent border-none"
          onClick={() => { setSearchOpen(false); setSearchQuery(""); setCurrentMatch(0); }}
          title="Close (Escape)"
        >
          <X size={14} />
        </button>
      </div>
    );
  };

  const renderContent = () => {
    if (viewMode === "file" && browseSelectedFile) {
      return (
        <div className="flex-1 overflow-hidden min-w-0 flex flex-col bg-[#1e1e1e] relative">
          {searchOpen && renderSearchBar()}
          <FileEditorHeader
            filePath={browseSelectedFile}
            cwd={cwd}
            isDirty={isDirty}
            saveStatus={saveStatus}
            isImage={isImageFile(browseSelectedFile)}
          />
          {renderFileEditorBody()}
        </div>
      );
    }

    if (diff) {
      const leftPct = `${leftPaneFraction * 100}%`;
      const rightPct = `${(1 - leftPaneFraction) * 100}%`;
      return (
        <div ref={diffContainerRef} className="flex flex-1 overflow-hidden min-h-0 relative">
          {searchOpen && renderSearchBar()}
          {renderPane("old", diff.left, leftPct)}
          <div
            className="w-[5px] bg-[#404040] shrink-0 cursor-col-resize hover:bg-[#569cd6] active:bg-[#569cd6] transition-colors"
            onMouseDown={handleDiffDragStart}
          />
          {renderPane("new", diff.right, rightPct)}
          {readOnlyToast && (
            <div className="absolute top-10 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded bg-[#3c3c3c] border border-[#555] text-[#d4d4d4] text-[12px] shadow-[0_2px_8px_rgba(0,0,0,0.4)] pointer-events-none select-none">
              This file is read-only in diff view
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex-1 flex items-center justify-center text-[#555] text-sm bg-[#1e1e1e]">
        {selectedFile ? "Loading..." : "Select a file to view changes"}
      </div>
    );
  };

  return (
    <>
      {/* Hidden span to measure monospace char width */}
      <span
        ref={measureRef}
        className="font-mono text-[13px] absolute opacity-0 pointer-events-none"
        aria-hidden="true"
      >
        M
      </span>
      {renderContent()}
    </>
  );
}
