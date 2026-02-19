// PTY commands — manage a pseudo-terminal session for the integrated terminal.
// Creates a PTY running the user's shell, auto-launches `claude` inside it,
// and streams output back to the frontend via Tauri events. Also supports
// writing input and resizing the terminal.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct PtyState {
    pub master: Option<Box<dyn MasterPty + Send>>,
}

pub struct WriterState {
    pub writer: Option<Box<dyn Write + Send>>,
}

/// Spawn a new PTY shell session in the given working directory.
/// Inherits essential environment variables (SHELL, HOME, USER, PATH),
/// auto-launches `claude`, and begins streaming output via the "pty-output" event.
#[tauri::command]
pub fn pty_create(
    app: AppHandle,
    pty_state: State<'_, Mutex<PtyState>>,
    writer_state: State<'_, Mutex<WriterState>>,
    rows: u16,
    cols: u16,
    cwd: String,
) -> Result<(), String> {
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

    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|e| e.to_string())?;

    {
        let mut pg = pty_state.lock().map_err(|e| e.to_string())?;
        pg.master = Some(pty_pair.master);
    }

    {
        let mut wg = writer_state.lock().map_err(|e| e.to_string())?;
        wg.writer = Some(writer);
    }

    // Auto-launch claude in the PTY
    {
        let mut wg = writer_state.lock().map_err(|e| e.to_string())?;
        if let Some(writer) = &mut wg.writer {
            let _ = writer.write_all(b"claude\n");
            let _ = writer.flush();
        }
    }

    // 🔥 Correct UTF-8 streaming read loop
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
                                let _ = app.emit("pty-output", valid_str.to_string());
                                pending.clear();
                                break;
                            }
                            Err(err) => {
                                let valid_up_to = err.valid_up_to();

                                if valid_up_to == 0 {
                                    // Incomplete multi-byte character — wait for next read
                                    break;
                                }

                                let valid_part = &pending[..valid_up_to];

                                if let Ok(valid_str) = std::str::from_utf8(valid_part) {
                                    let _ = app.emit("pty-output", valid_str.to_string());
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

/// Write raw input data (keystrokes) to the PTY.
#[tauri::command]
pub fn pty_write(
    state: State<'_, Mutex<WriterState>>,
    data: String,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;

    if let Some(writer) = &mut guard.writer {
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;

        writer.flush().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Resize the PTY to match the frontend terminal dimensions.
#[tauri::command]
pub fn pty_resize(
    state: State<'_, Mutex<PtyState>>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;

    if let Some(master) = &guard.master {
        master
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
