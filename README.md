# Greenlite

A lightweight code editor built with Tauri, React, and TypeScript.

## Features

- Open and edit text/code files with a dark-themed UI
- Line numbers in the code viewer
- Keyboard shortcuts: `Cmd+O` (open), `Cmd+S` (save)
- Supports common file types: `.ts`, `.tsx`, `.js`, `.jsx`, `.rs`, `.py`, `.json`, `.md`, and more

## Tech Stack

- **Frontend:** React + TypeScript, bundled with Vite
- **Backend:** Tauri 2 (Rust)
- **Plugins:** `tauri-plugin-fs`, `tauri-plugin-dialog`

## Development

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
