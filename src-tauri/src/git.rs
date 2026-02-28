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

#[derive(Serialize)]
pub struct FileDiff {
    pub old_content: String,
    pub new_content: String,
}

/// Return the old (HEAD) and new (working tree) content of a file for
/// side-by-side diff rendering.
#[tauri::command]
pub fn git_file_diff(repo_path: String, file_path: String) -> Result<FileDiff, String> {
    // Try to get the committed version from HEAD
    let old_content = git_cmd(&repo_path, &["show", &format!("HEAD:{}", file_path)])
        .unwrap_or_default();

    // Read the working-tree version
    let full_path = std::path::Path::new(&repo_path).join(&file_path);
    let new_content = std::fs::read_to_string(&full_path).unwrap_or_default();

    Ok(FileDiff {
        old_content,
        new_content,
    })
}

/// Run a git command, checking that it succeeds. Returns an error if the
/// command exits with a non-zero status.
fn git_cmd_checked(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(["-C", repo_path])
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("git {:?} failed with {}", args, output.status)
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Stage all changes, commit with the given message, and push to upstream.
/// Returns the new short commit hash on success.
#[tauri::command]
pub fn git_commit_and_push(repo_path: String, message: String) -> Result<String, String> {
    git_cmd_checked(&repo_path, &["add", "-A"])?;
    git_cmd_checked(&repo_path, &["commit", "-m", &message])?;
    git_cmd_checked(&repo_path, &["push"])?;
    let hash = git_cmd(&repo_path, &["log", "-1", "--format=%h"]).unwrap_or_default();
    Ok(hash)
}

/// Discard all working-tree changes (tracked and untracked).
#[tauri::command]
pub fn git_revert_all(repo_path: String) -> Result<String, String> {
    git_cmd_checked(&repo_path, &["checkout", "--", "."])?;
    git_cmd_checked(&repo_path, &["clean", "-fd"])?;
    Ok("All changes reverted".to_string())
}

/// List local branch names (current branch first).
#[tauri::command]
pub fn git_list_branches(repo_path: String) -> Result<Vec<String>, String> {
    let raw = git_cmd_checked(&repo_path, &["branch"])?;
    let mut current = String::new();
    let mut others: Vec<String> = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(name) = trimmed.strip_prefix("* ") {
            current = name.to_string();
        } else {
            others.push(trimmed.to_string());
        }
    }
    others.sort();
    let mut branches = vec![current];
    branches.append(&mut others);
    Ok(branches)
}

/// Checkout an existing branch, or create a new one if `new_branch` is true.
#[tauri::command]
pub fn git_checkout(repo_path: String, branch: String, new_branch: bool) -> Result<String, String> {
    if new_branch {
        git_cmd_checked(&repo_path, &["checkout", "-b", &branch])?;
    } else {
        git_cmd_checked(&repo_path, &["checkout", &branch])?;
    }
    Ok(format!("Switched to branch '{}'", branch))
}

/// Return the list of changed files (staged + unstaged) in the working tree,
/// each with a two-character git status code and its file path.
#[tauri::command]
pub fn git_changed_files(repo_path: String) -> Result<Vec<ChangedFile>, String> {
    let porcelain = git_cmd(&repo_path, &["status", "--porcelain", "-uall"])
        .unwrap_or_default();

    let files: Vec<ChangedFile> = porcelain
        .lines()
        .filter(|l| !l.is_empty())
        .map(|line| {
            let raw_status = line.get(..2).unwrap_or("??").trim();
            let status = match raw_status {
                "??" => "A".to_string(),
                other => other.to_string(),
            };
            let raw_path = line.get(2..).unwrap_or("").trim_start().to_string();
            // For renames (R) the format is "old -> new", use the new path
            let path = if raw_path.contains(" -> ") {
                raw_path.split(" -> ").last().unwrap_or(&raw_path).to_string()
            } else {
                raw_path
            };
            ChangedFile { status, path }
        })
        .collect();

    Ok(files)
}
