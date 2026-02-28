import type { DiffLine } from "../types/review";

export function computeDiff(oldText: string, newText: string): { left: DiffLine[]; right: DiffLine[] } {
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];

  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let i = m;
  let j = n;

  const leftStack: DiffLine[] = [];
  const rightStack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      leftStack.push({ type: "unchanged", text: oldLines[i - 1], oldLineNum: i });
      rightStack.push({ type: "unchanged", text: newLines[j - 1], newLineNum: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      leftStack.push({ type: "added", text: "" });
      rightStack.push({ type: "added", text: newLines[j - 1], newLineNum: j });
      j--;
    } else {
      leftStack.push({ type: "removed", text: oldLines[i - 1], oldLineNum: i });
      rightStack.push({ type: "removed", text: "" });
      i--;
    }
  }

  leftStack.reverse();
  rightStack.reverse();
  left.push(...leftStack);
  right.push(...rightStack);

  return { left, right };
}
