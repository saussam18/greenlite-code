import { useState, useEffect, useRef, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { detectLanguage, tokenizeLine, type Language, type Token } from "../general/syntax";
import type { Comment, DiffLine, SelectionAnchor } from "../types/review";
import { CommentThread } from "./CommentThread";
import { CommentCard } from "./CommentCard";
import { MessageSquarePlus, MessageSquare } from "lucide-react";
import { FileEditorHeader } from "./FileEditorHeader";
import { FileCommentPanel } from "./FileCommentPanel";
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
  selectedStatus: string | null;
  diff: { left: DiffLine[]; right: DiffLine[] } | null;
  plainContent: string | null;
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
  selectedStatus,
  diff,
  plainContent,
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

  const handleLineMouseDown = (side: "old" | "new", lineNum: number, col: number, row: number) => {
    setIsSelecting(true);
    setSelectingSide(side);
    setSelectionStart({ line: lineNum, col });
    setSelectionEnd({ line: lineNum, col });
    setSelEndRow(row);
    setShowCommentInput(false);
    setCommentInput("");
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
      "new",
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

  // Escape key + read-only toast for diff view typing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;
      if (e.key === "Escape") clearSelection();
      // Show read-only toast when typing in diff view
      if (viewMode === "diff" && selectingSide && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.length === 1) {
        if (readOnlyTimer.current) clearTimeout(readOnlyTimer.current);
        setReadOnlyToast(true);
        readOnlyTimer.current = setTimeout(() => setReadOnlyToast(false), 2000);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, viewMode, selectingSide]);

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

  // Cache tokenization results so selection changes don't re-tokenize every line
  const tokenCache = useMemo(() => new Map<string, Token[]>(), [lang]);

  const getTokens = (text: string): Token[] => {
    const cached = tokenCache.get(text);
    if (cached) return cached;
    const tokens = tokenizeLine(text, lang);
    tokenCache.set(text, tokens);
    return tokens;
  };

  const renderHighlightedLine = (text: string) => {
    const tokens = getTokens(text);
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

  const renderDiffLine = (side: "old" | "new", line: DiffLine, i: number, isDiffPane: boolean) => {
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

    const gutterDotColor = comment
      ? comment.resolved ? "text-[#666]" : "text-[#4e9a06]"
      : "";
    const gutterDotHover = comment
      ? comment.resolved ? "hover:text-[#999]" : "hover:text-[#73d216]"
      : "";

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
          onMouseMove={(e) => {
            if (lineNum == null) return;
            const codeSpan = e.currentTarget.querySelector('[data-code-span]') as HTMLElement | null;
            const col = codeSpan ? getColFromEvent(e, codeSpan, line.text) : 0;
            handleLineMouseMove(side, lineNum, col, i);
          }}
        >
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
            {/* Blinking cursor at selection end */}
            {selectingSide === side && selectionEnd && selectionEnd.line === lineNum && !isSelecting && (
              <span
                className="absolute top-0 bottom-0 w-[1.5px] bg-[#d4d4d4] animate-[blink_1s_step-end_infinite] pointer-events-none z-10"
                style={{ left: `calc(0.5rem + ${selectionEnd.col}ch)` }}
              />
            )}
            {isSpacer ? " " : line.text ? renderHighlightedLine(line.text) : " "}
          </span>
        </div>
        {lineNum != null && renderInlineThread(side, lineNum)}
      </div>
    );
  };

  const renderPlainPane = (label: string, content: string, side: "old" | "new") => {
    const lines = content.split("\n");
    return (
      <div ref={diffContainerRef} className="flex-1 overflow-auto min-w-0 relative bg-[#1e1e1e]">
        <div className="sticky top-0 z-10 px-3 py-1 bg-[#2d2d2d] border-b border-[#404040] text-[11px] text-[#888] font-semibold uppercase tracking-wider">
          {label}
        </div>
        <pre className="m-0 p-0 bg-transparent">
          <code className="block w-max min-w-full">
            {lines.map((line, i) => renderDiffLine(side, { type: "unchanged", text: line, ...(side === "old" ? { oldLineNum: i + 1 } : { newLineNum: i + 1 }) }, i, false))}
          </code>
        </pre>
        {renderCommentPopover(side)}
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
      };

      return (
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Line numbers with comment icons */}
          <div
            ref={lineNumRef}
            className="w-[50px] min-w-[50px] overflow-hidden bg-[#1e1e1e] shrink-0 select-none"
          >
            {fileLines.map((_, i) => {
              const lineNum = i + 1;
              const comment = findComment("new", lineNum);
              const isInRange = fileCommentStartLine !== null && fileCommentEndLine !== null &&
                lineNum >= Math.min(fileCommentStartLine, fileCommentEndLine) &&
                lineNum <= Math.max(fileCommentStartLine, fileCommentEndLine);
              return (
                <div
                  key={i}
                  className={`group h-[21px] leading-[21px] pr-2 font-mono text-[13px] text-[#555] flex items-center ${
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
                        if (e.shiftKey && fileCommentStartLine !== null) {
                          setFileCommentEndLine(lineNum);
                        } else {
                          setFileCommentStartLine(lineNum);
                          setFileCommentEndLine(lineNum);
                          setFileCommentText("");
                        }
                      }}
                    >
                      <MessageSquarePlus size={11} />
                    </span>
                  )}
                  <span className="flex-1 text-right">{lineNum}</span>
                </div>
              );
            })}
          </div>
          {/* Code area with syntax highlight + textarea + comment overlays */}
          <div className="flex-1 relative overflow-hidden min-w-0">
            {/* Syntax highlight layer */}
            <pre
              ref={highlightRef}
              className="absolute inset-0 m-0 p-0 bg-transparent overflow-hidden pointer-events-none"
            >
              <code className="block">
                {fileLines.map((line, i) => (
                  <div
                    key={i}
                    className="h-[21px] leading-[21px] pl-2 pr-2 font-mono text-[13px] whitespace-pre"
                  >
                    {line ? renderHighlightedLine(line) : " "}
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

  const renderContent = () => {
    if (viewMode === "file" && browseSelectedFile) {
      return (
        <div className="flex-1 overflow-hidden min-w-0 flex flex-col bg-[#1e1e1e]">
          <FileEditorHeader
            filePath={browseSelectedFile}
            cwd={cwd}
            isDirty={isDirty}
            saveStatus={saveStatus}
            isImage={isImageFile(browseSelectedFile)}
          />
          {renderFileEditorBody()}
          {fileCommentStartLine !== null && fileCommentEndLine !== null && (
            <FileCommentPanel
              startLine={fileCommentStartLine}
              endLine={fileCommentEndLine}
              text={fileCommentText}
              onTextChange={setFileCommentText}
              onSubmit={handleFileCommentSubmit}
              onCancel={closeFileComment}
            />
          )}
        </div>
      );
    }

    if (plainContent !== null) {
      return renderPlainPane(
        selectedStatus === "D" ? "Deleted" : "Added",
        plainContent,
        selectedStatus === "D" ? "old" : "new"
      );
    }

    if (diff) {
      const leftPct = `${leftPaneFraction * 100}%`;
      const rightPct = `${(1 - leftPaneFraction) * 100}%`;
      return (
        <div ref={diffContainerRef} className="flex flex-1 overflow-hidden min-h-0 relative">
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
