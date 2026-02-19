# Greenlite Code

A native desktop companion app for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It combines an integrated terminal that auto-launches `claude` with a git diff review interface — run Claude Code in Build mode and review what it changed in Review mode.

## Features

- **Build Mode** — Full terminal (xterm.js + real PTY) that opens in your project directory and automatically launches `claude`. Interact with Claude Code naturally.
- **Review Mode** — Git-aware side-by-side diff viewer that polls `git status` every 3 seconds. Select any modified file to see a Before/After diff with syntax highlighting. Click-drag to select line ranges and attach inline comments.
- **Status Bar** — Always-visible bar showing current git branch, dirty/clean state, ahead/behind counts, last commit info, and a list of changed files (modified/added/deleted).
- **Recent Folders** — Setup screen remembers your last 5 opened project folders for quick access.

## Tech Stack

- **Frontend:** React 18 + TypeScript, Tailwind CSS v4, Vite 6
- **Terminal:** xterm.js with FitAddon, backed by a real PTY via `portable-pty` (Rust)
- **Backend:** Tauri 2 (Rust) with `tauri-plugin-fs` and `tauri-plugin-dialog`
- **Diff:** LCS-based diff algorithm with regex-based syntax highlighting (JS/TS, Rust, JSON)

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Prerequisites

- Node.js + npm
- Rust toolchain (via [rustup](https://rustup.rs/))
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and available on your PATH
