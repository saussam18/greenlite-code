mod git;
mod menu;
mod pty;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::new_store())
        .setup(|app| {
            let handle = app.handle();
            let menu = menu::create_menu(handle)?;
            app.set_menu(menu)?;

            let handle_clone = handle.clone();
            app.on_menu_event(move |_app, event| {
                if event.id().as_ref() == "new-window" {
                    menu::create_new_window(&handle_clone);
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label().to_string();
                if let Some(store) = window.try_state::<std::sync::Mutex<pty::PtyStore>>() {
                    if let Ok(mut guard) = store.lock() {
                        guard.remove_by_window(&label);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            pty::pty_create,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_destroy,
            git::git_info,
            git::git_changed_files,
            git::git_file_diff,
            git::git_commit_and_push,
            git::git_revert_all,
            git::git_list_branches,
            git::git_checkout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
