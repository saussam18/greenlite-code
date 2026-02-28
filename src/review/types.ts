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
