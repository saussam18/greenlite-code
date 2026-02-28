export interface GitInfo {
  branch: string;
  dirty: boolean;
  ahead: number;
  behind: number;
  last_commit_hash: string;
  last_commit_message: string;
}

export interface ChangedFile {
  status: string;
  path: string;
}

export interface ProjectNode {
  name: string;
  fullPath: string;
  isFile: boolean;
  children: ProjectNode[] | null;
}
