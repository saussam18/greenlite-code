mod git;
mod pty;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(pty::PtyState { master: None }))
        .manage(Mutex::new(pty::WriterState { writer: None }))
        .invoke_handler(tauri::generate_handler![
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
            git::git_info,
            git::git_changed_files,
            git::git_file_diff,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
