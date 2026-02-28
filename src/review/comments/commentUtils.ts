import type { Comment } from "../../types/review";

export function lineLabel(comment: Comment): string {
  const hasCol = comment.startCol !== 0 || comment.endCol !== Infinity;
  if (hasCol) {
    return `L${comment.startLine}:${comment.startCol}–L${comment.endLine}:${comment.endCol}`;
  }
  return comment.startLine === comment.endLine
    ? `L${comment.startLine}`
    : `L${comment.startLine}–${comment.endLine}`;
}
