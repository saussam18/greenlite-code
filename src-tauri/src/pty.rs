// PTY commands — manage a pseudo-terminal session for the integrated terminal.
// Creates a PTY running the user's shell, optionally auto-launches a command,
// and streams output back to the frontend via Tauri events. Also supports
// writing input and resizing the terminal.
//
// Each window gets its own independent PTY session, keyed by window label.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State, WebviewWindow};

struct PtyEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct PtyStore {
    sessions: HashMap<String, PtyEntry>,
}

impl PtyStore {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    pub fn remove(&mut self, label: &str) {
        self.sessions.remove(label);
    }
}

pub fn new_store() -> Mutex<PtyStore> {
    Mutex::new(PtyStore::new())
}

/// Spawn a new PTY shell session in the given working directory.
/// Inherits essential environment variables (SHELL, HOME, USER, PATH),
/// optionally auto-launches a command, and begins streaming output via the "pty-output" event
/// scoped to the calling window.
#[tauri::command]
pub fn pty_create(
    app: AppHandle,
    window: WebviewWindow,
    store: State<'_, Mutex<PtyStore>>,
    rows: u16,
    cols: u16,
    cwd: String,
    command: Option<String>,
) -> Result<(), String> {
    let window_label = window.label().to_string();

    let pty_system = native_pty_system();

    let pty_pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
    let mut cmd = CommandBuilder::new(&shell);

    cmd.env("TERM", "xterm-256color");
    cmd.env("SHELL_SESSIONS_DISABLE", "1");
    cmd.cwd(&cwd);

    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
    }
    if let Ok(user) = std::env::var("USER") {
        cmd.env("USER", user);
    }
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }

    let _child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;

    let mut reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;

    let mut writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| e.to_string())?;

    // Auto-launch command in the PTY if provided
    if let Some(cmd) = command {
        let _ = writer.write_all(format!("{}\n", cmd).as_bytes());
        let _ = writer.flush();
    }

    {
        let mut guard = store.lock().map_err(|e| e.to_string())?;
        guard.sessions.insert(
            window_label.clone(),
            PtyEntry {
                master: pty_pair.master,
                writer,
            },
        );
    }

    // Stream output to the originating window only
    let label_for_thread = window_label.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut pending: Vec<u8> = Vec::new();

        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);

                    loop {
                        match std::str::from_utf8(&pending) {
                            Ok(valid_str) => {
                                let _ = app.emit_to(&label_for_thread, "pty-output", valid_str.to_string());
                                pending.clear();
                                break;
                            }
                            Err(err) => {
                                let valid_up_to = err.valid_up_to();

                                if valid_up_to == 0 {
                                    break;
                                }

                                let valid_part = &pending[..valid_up_to];

                                if let Ok(valid_str) = std::str::from_utf8(valid_part) {
                                    let _ = app.emit_to(&label_for_thread, "pty-output", valid_str.to_string());
                                }

                                pending = pending[valid_up_to..].to_vec();
                            }
                        }
                    }
                }
            }
        }
    });

    Ok(())
}

/// Write raw input data (keystrokes) to the PTY for the calling window.
#[tauri::command]
pub fn pty_write(
    window: WebviewWindow,
    store: State<'_, Mutex<PtyStore>>,
    data: String,
) -> Result<(), String> {
    let mut guard = store.lock().map_err(|e| e.to_string())?;
    let label = window.label();

    if let Some(entry) = guard.sessions.get_mut(label) {
        entry
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        entry.writer.flush().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Resize the PTY to match the frontend terminal dimensions for the calling window.
#[tauri::command]
pub fn pty_resize(
    window: WebviewWindow,
    store: State<'_, Mutex<PtyStore>>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let guard = store.lock().map_err(|e| e.to_string())?;
    let label = window.label();

    if let Some(entry) = guard.sessions.get(label) {
        entry
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Clean up the PTY session for the calling window.
#[tauri::command]
pub fn pty_destroy(
    window: WebviewWindow,
    store: State<'_, Mutex<PtyStore>>,
) -> Result<(), String> {
    let mut guard = store.lock().map_err(|e| e.to_string())?;
    guard.remove(window.label());
    Ok(())
}
