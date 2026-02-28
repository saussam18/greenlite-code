import { Check, Undo2, Trash2, X } from "lucide-react";
import type { Comment } from "../types/review";

export function lineLabel(comment: Comment): string {
  const hasCol = comment.startCol !== 0 || comment.endCol !== Infinity;
  if (hasCol) {
    return `L${comment.startLine}:${comment.startCol}–L${comment.endLine}:${comment.endCol}`;
  }
  return comment.startLine === comment.endLine
    ? `L${comment.startLine}`
    : `L${comment.startLine}–${comment.endLine}`;
}

export function CommentCard({
  comment,
  onResolve,
  onUnresolve,
  onDelete,
  onCollapse,
}: {
  comment: Comment;
  onResolve: (id: string) => void;
  onUnresolve: (id: string) => void;
  onDelete: (id: string) => void;
  onCollapse?: () => void;
}) {
  const borderColor = comment.resolved ? "#555" : "#4e9a06";
  const opacity = comment.resolved ? "opacity-60" : "";

  return (
    <div
      className={`border rounded bg-[#2d2d30] shadow-[0_2px_8px_rgba(0,0,0,0.4)] max-w-[360px] ${opacity}`}
      style={{ borderColor }}
    >
      <div className="relative px-2.5 py-1.5 text-[#d4d4d4] whitespace-pre-wrap text-[12px]">
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded text-[#888] hover:text-[#d4d4d4] hover:bg-white/[0.08] cursor-pointer bg-transparent border-none p-0"
            title="Collapse"
          >
            <X size={12} />
          </button>
        )}
        {comment.text}
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-t border-[#404040]">
        {comment.resolved ? (
          <button
            className="flex items-center gap-1 px-2 py-0.5 border border-[#555] rounded-sm bg-transparent text-[#4e9a06] cursor-pointer text-[11px] hover:bg-[rgba(78,154,6,0.15)]"
            onClick={() => onUnresolve(comment.id)}
          >
            <Undo2 size={11} /> Unresolve
          </button>
        ) : (
          <button
            className="flex items-center gap-1 px-2 py-0.5 border border-[#4e9a06] rounded-sm bg-transparent text-[#4e9a06] cursor-pointer text-[11px] hover:bg-[rgba(78,154,6,0.15)]"
            onClick={() => onResolve(comment.id)}
          >
            <Check size={11} /> Resolve
          </button>
        )}
        <button
          className="flex items-center gap-1 px-2 py-0.5 border border-[#555] rounded-sm bg-transparent text-[#f44747] cursor-pointer text-[11px] hover:bg-[rgba(244,71,71,0.15)]"
          onClick={() => onDelete(comment.id)}
        >
          <Trash2 size={11} /> Delete
        </button>
      </div>
    </div>
  );
}
