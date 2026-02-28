# Greenlite Code

A native desktop companion app for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It combines an integrated terminal with a full code review interface — run AI coding assistants in Build mode and review what they changed in Review mode.

## Features

### Build Mode

- **Multi-tab terminal** — Open multiple terminal tabs with `Cmd/Ctrl+T`, close with `Cmd/Ctrl+W`. Each tab runs its own PTY session.
- **Auto-launch AI assistants** — Automatically starts Claude Code, OpenCode, GitHub Copilot, a custom command, or a bare shell. Configurable per project.
- **Terminal command picker** — Choose your preferred terminal command from the status bar. Change it anytime (takes effect on next terminal tab).

### Review Mode

- **Side-by-side diff viewer** — Git-aware diff view with LCS-based algorithm. Color-coded added/removed/unchanged lines with line numbers for both old and new versions. Polls `git status` every 3 seconds.
- **File browser** — Full directory tree browser alongside the changes list. Browse any file in the project, not just changed ones.
- **Editor tabs** — Open multiple files in separate tabs. Switch between diff mode and file mode per tab.
- **File editing** — Edit files directly in the file browser with `Cmd/Ctrl+S` to save. Image preview support for PNG, JPG, GIF, SVG, WebP, and more.
- **Syntax highlighting** — Regex-based highlighting for JavaScript/TypeScript, Rust, C/C++, JSON, CSS, and HTML with a VS Code dark color scheme.
- **Inline comments** — Click a line gutter to add a comment. Shift+click to select multi-line ranges. Column-aware selection in diff view for commenting on specific code spans.
- **Comment overlays** — Comments appear inline in the file editor, scroll-synced with the code. Collapsible comment threads with resolve/unresolve and delete actions.
- **Comment persistence** — Comments are stored per repository and tied to the current commit hash. They auto-clear when the commit changes.
- **Draggable dividers** — Resize the sidebar and diff panes by dragging. Min/max width constraints with visual hover feedback.
- **Scroll decorations** — Visual indicators for scrollable content areas.
- **Read-only toast** — Typing in diff view shows a non-intrusive "read-only" notification.

### Status Bar

- **Git status** — Current branch, dirty/clean state, ahead/behind counts, and last commit info.
- **Git controls** — Branch switching, create new branches, commit & push with a large message dialog, and revert all changes with confirmation.
- **Review comments** — Shows open and resolved comment counts. Click any comment to jump to it in the editor.
- **Send to AI** — Button in the commit dialog to send context to your AI assistant.
- **Changed files** — Quick popover listing all modified/added/deleted files with status indicators.
- **Terminal command** — Switch your auto-launch command from the status bar dropdown.
- **Project switcher** — Click to change project folder without restarting.

### Settings & Multi-Window

- **New windows** — `Cmd/Ctrl+N` opens a new window with independent project, terminal, and review state.
- **Recent folders** — Setup screen remembers your last 5 project folders for quick access.
- **Auto-reopen** — Main window automatically loads your last project on launch.
- **Per-project settings** — Terminal command preferences stored per project.

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+T` | New terminal tab |
| `Cmd/Ctrl+W` | Close terminal tab |
| `Cmd/Ctrl+N` | New window |
| `Cmd/Ctrl+S` | Save file (file editor) |
| `Cmd/Ctrl+Enter` | Submit commit message |
| `Shift+Click` | Select line range for comment |
| `Escape` | Cancel comment / close dialog |

## Tech Stack

- **Frontend:** React 18 + TypeScript, Tailwind CSS v4, Vite 6, Lucide React icons
- **Terminal:** xterm.js with FitAddon, backed by a real PTY via `portable-pty` (Rust)
- **Backend:** Tauri 2 (Rust) with `tauri-plugin-fs`, `tauri-plugin-dialog`, and `tauri-plugin-opener`
- **Diff:** LCS-based diff algorithm with regex-based syntax highlighting (JS/TS, Rust, C/C++, JSON, CSS, HTML)
- **Storage:** localStorage for comments, project settings, and recent folders

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
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and available on your PATH (or another supported AI assistant)
