import { useState, useEffect, useRef, useMemo } from "react";
import { readFile, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { detectLanguage, tokenizeLine, type Language, type Token } from "../general/syntax";
import { CommentThread, type Comment } from "./CommentThread";
import { MessageSquarePlus, MessageSquare } from "lucide-react";
import type { DiffLine, SelectionAnchor } from "./types";

export type { DiffLine } from "./types";

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

function FileEditorHeader({
  filePath,
  cwd,
  isDirty,
  saveStatus,
  isImage,
}: {
  filePath: string;
  cwd: string;
  isDirty: boolean;
  saveStatus: string | null;
  isImage: boolean;
}) {
  return (
    <div className="sticky top-0 z-10 px-3 py-1 bg-[#2d2d2d] border-b border-[#404040] text-[11px] text-[#888] font-semibold flex items-center gap-2 shrink-0">
      <span className="truncate">{filePath.replace(cwd + "/", "")}</span>
      {isDirty && <span className="text-[#dcdcaa]">(unsaved)</span>}
      {saveStatus && (
        <span className={saveStatus === "Saved" ? "text-[#6a9955]" : "text-[#f44747]"}>
          {saveStatus}
        </span>
      )}
      {!isImage && (
        <span className="ml-auto text-[10px] text-[#555]">Cmd+S to save</span>
      )}
    </div>
  );
}

function ImageViewer({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="flex-1 flex items-center justify-center overflow-auto p-4">
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
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

  // Comment input
  const [commentInput, setCommentInput] = useState("");
  const [showCommentInput, setShowCommentInput] = useState(false);

  // Track which inline threads are collapsed
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(new Set());

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

  const fileComments = selectedFile
    ? comments.filter((c) => c.filePath === selectedFile)
    : [];

  const findComment = (side: "old" | "new", lineNum: number): Comment | undefined => {
    return fileComments.find(
      (c) => c.side === side && lineNum >= c.startLine && lineNum <= c.endLine
    );
  };

  const getCommentsEndingAtLine = (side: "old" | "new", lineNum: number): Comment[] => {
    return fileComments.filter((c) => c.side === side && c.endLine === lineNum);
  };

  const handleAddComment = () => setShowCommentInput(true);

  const handleSubmitComment = () => {
    if (!commentInput.trim() || !selectedFile || !selectingSide || !selNorm) return;

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

    onAddComment(newComment);
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

  // Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;
      if (e.key === "Escape") clearSelection();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible]);

  // Scroll to comment when requested
  const diffContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!scrollToCommentId) return;
    const comment = comments.find((c) => c.id === scrollToCommentId);
    if (!comment) return;
    // Wait a tick for DOM to render after file switch
    const timer = setTimeout(() => {
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
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollToCommentId]);

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
    if (selectingSide !== side || selMin === null || selMax === null || isSelecting || !selNorm) return null;
    return (
      <div
        className="absolute z-20"
        style={{ top: `${(selMax) * 21 + 28}px`, left: `min(calc(50px + 0.5rem + ${selNorm.end.col}ch), calc(100% - ${showCommentInput ? '21rem' : '2.5rem'}))` }}
      >
        {!showCommentInput ? (
          <button
            className="w-7 h-7 flex items-center justify-center border border-[#4e9a06] rounded bg-[#2d2d30] text-[#4e9a06] cursor-pointer hover:bg-[#3c3c3c]"
            onClick={handleAddComment}
            title={`Comment on L${selMin}${selMin !== selMax ? `–L${selMax}` : ""}`}
          >
            <MessageSquarePlus size={15} />
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

  const renderPane = (side: "old" | "new", lines: DiffLine[]) => {
    return (
      <div className="flex-1 overflow-auto min-w-0 relative bg-[#1e1e1e]">
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
      return (
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Line numbers */}
          <div
            ref={lineNumRef}
            className="w-[50px] min-w-[50px] overflow-hidden bg-[#1e1e1e] shrink-0 select-none"
          >
            {editContent.split("\n").map((_, i) => (
              <div
                key={i}
                className="h-[21px] leading-[21px] text-right pr-2 font-mono text-[13px] text-[#555]"
              >
                {i + 1}
              </div>
            ))}
          </div>
          {/* Code area with syntax highlight + textarea overlay */}
          <div className="flex-1 relative overflow-hidden min-w-0">
            <pre
              ref={highlightRef}
              className="absolute inset-0 m-0 p-0 bg-transparent overflow-hidden pointer-events-none"
            >
              <code className="block">
                {editContent.split("\n").map((line, i) => (
                  <div
                    key={i}
                    className="h-[21px] leading-[21px] pl-2 pr-2 font-mono text-[13px] whitespace-pre"
                  >
                    {line ? renderHighlightedLine(line) : " "}
                  </div>
                ))}
              </code>
            </pre>
            <textarea
              ref={editorRef}
              className="absolute inset-0 w-full h-full font-mono text-[13px] leading-[21px] bg-transparent text-transparent resize-none outline-none border-none pl-2 pr-2"
              style={{ caretColor: "#d4d4d4" }}
              value={editContent}
              onChange={(e) => {
                setEditContent(e.target.value);
                setIsDirty(e.target.value !== fileContent);
              }}
              onScroll={() => {
                if (editorRef.current && highlightRef.current) {
                  highlightRef.current.scrollTop = editorRef.current.scrollTop;
                  highlightRef.current.scrollLeft = editorRef.current.scrollLeft;
                }
                if (editorRef.current && lineNumRef.current) {
                  lineNumRef.current.scrollTop = editorRef.current.scrollTop;
                }
              }}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              wrap="off"
            />
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
      return (
        <div ref={diffContainerRef} className="flex flex-1 overflow-hidden min-h-0">
          {renderPane("old", diff.left)}
          <div className="w-px bg-[#404040] shrink-0" />
          {renderPane("new", diff.right)}
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
