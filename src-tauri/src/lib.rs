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

#[tauri::command]
fn pty_create(
    app: AppHandle,
    pty_state: State<'_, Mutex<PtyState>>,
    writer_state: State<'_, Mutex<WriterState>>,
    rows: u16,
    cols: u16,
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
    if let Ok(home) = std::env::var("HOME") {
        cmd.env("HOME", &home);
        cmd.cwd(&home);
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

    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app.emit("pty-output", data);
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn pty_write(state: State<'_, Mutex<WriterState>>, data: String) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(writer) = &mut guard.writer {
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn pty_resize(state: State<'_, Mutex<PtyState>>, rows: u16, cols: u16) -> Result<(), String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(PtyState { master: None }))
        .manage(Mutex::new(WriterState { writer: None }))
        .invoke_handler(tauri::generate_handler![pty_create, pty_write, pty_resize])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
