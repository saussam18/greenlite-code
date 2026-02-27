import { useState } from "react";

export interface Comment {
  id: string;
  side: "old" | "new";
  filePath: string;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export function CommentThread({
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
