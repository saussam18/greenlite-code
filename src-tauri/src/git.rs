// Git commands — expose repository status information to the frontend.
// Provides branch name, dirty state, ahead/behind counts, last commit info,
// and a list of changed files via `git status --porcelain`.

use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
pub struct GitInfo {
    pub branch: String,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub last_commit_hash: String,
    pub last_commit_message: String,
}

#[derive(Serialize)]
pub struct ChangedFile {
    pub status: String,
    pub path: String,
}

/// Run a git command in the given repo and return stdout as a trimmed string.
fn git_cmd(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", repo_path])
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Return high-level git status for the repo: current branch, dirty flag,
/// ahead/behind counts relative to upstream, and the latest commit.
#[tauri::command]
pub fn git_info(repo_path: String) -> Result<GitInfo, String> {
    let branch = git_cmd(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_default();

    let porcelain = git_cmd(&repo_path, &["status", "--porcelain"])
        .unwrap_or_default();
    let dirty = !porcelain.is_empty();

    let (ahead, behind) = git_cmd(
        &repo_path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .ok()
    .and_then(|s| {
        let parts: Vec<&str> = s.split_whitespace().collect();
        if parts.len() == 2 {
            Some((
                parts[0].parse::<u32>().unwrap_or(0),
                parts[1].parse::<u32>().unwrap_or(0),
            ))
        } else {
            None
        }
    })
    .unwrap_or((0, 0));

    let last_commit_hash = git_cmd(&repo_path, &["log", "-1", "--format=%h"])
        .unwrap_or_default();

    let last_commit_message = git_cmd(&repo_path, &["log", "-1", "--format=%s"])
        .unwrap_or_default();

    Ok(GitInfo {
        branch,
        dirty,
        ahead,
        behind,
        last_commit_hash,
        last_commit_message,
    })
}

/// Return the list of changed files (staged + unstaged) in the working tree,
/// each with a two-character git status code and its file path.
#[tauri::command]
pub fn git_changed_files(repo_path: String) -> Result<Vec<ChangedFile>, String> {
    let porcelain = git_cmd(&repo_path, &["status", "--porcelain"])
        .unwrap_or_default();

    let files: Vec<ChangedFile> = porcelain
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let status = line.get(..2).unwrap_or("??").trim().to_string();
            let path = line.get(3..).unwrap_or("").to_string();
            ChangedFile { status, path }
        })
        .collect();

    Ok(files)
}
