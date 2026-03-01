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

export interface ReviewInfo {
  openComments: Comment[];
  resolvedCount: number;
  onSendToClaude: () => void;
  onNavigateToComment: (comment: Comment) => void;
  onResolveAll: () => void;
}

export interface DiffLine {
  type: "unchanged" | "added" | "removed";
  text: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export interface SelectionAnchor {
  line: number;
  col: number;
}

export interface FileDiff {
  old_content: string;
  new_content: string;
}

export interface CommentsData {
  commitHash: string;
  comments: Comment[];
}

export interface GutterConfig {
  fileView?: boolean;
  onGutterClick?: (lineNum: number, shiftKey: boolean) => void;
}

export interface CodeLineConfig {
  showSelection: boolean;
  showDiffColors: boolean;
  /** Pre-computed values passed from renderDiffLine to avoid recomputation */
  selHighlight?: { startCol: number; endCol: number } | null;
  comment?: Comment;
  commentHL?: { startCol: number; endCol: number } | null;
}
