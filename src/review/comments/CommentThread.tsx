import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Comment } from "../../types/review";
import { CommentCard } from "./CommentCard";
import { lineLabel } from "./commentUtils";

interface CommentThreadProps {
  comment: Comment;
  onResolve: (id: string) => void;
  onUnresolve: (id: string) => void;
  onDelete: (id: string) => void;
}

export function CommentThread({
  comment,
  onResolve,
  onUnresolve,
  onDelete,
}: CommentThreadProps) {
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
        {collapsed ? <ChevronRight size={12} className="shrink-0 text-[#888]" /> : <ChevronDown size={12} className="shrink-0 text-[#888]" />}
        {comment.resolved && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#888] bg-[#3c3c3c] rounded px-1.5 py-0.5">
            Resolved
          </span>
        )}
        <span className="text-[12px] text-[#999] truncate flex-1">
          {collapsed ? comment.text : lineLabel(comment)}
        </span>
      </div>
      {!collapsed && (
        <div className="px-1 pb-1">
          <CommentCard
            comment={comment}
            onResolve={onResolve}
            onUnresolve={onUnresolve}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
}
