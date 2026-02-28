import type { Comment, CommentsData } from "../../types/review";

function commentsKey(repoPath: string): string {
  return `comments:${repoPath}`;
}

export function loadCommentsData(repoPath: string): CommentsData {
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

export function saveCommentsData(repoPath: string, data: CommentsData): void {
  localStorage.setItem(commentsKey(repoPath), JSON.stringify(data));
}
