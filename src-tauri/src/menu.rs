use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{
    menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, WebviewUrl, WebviewWindowBuilder,
};

static WINDOW_COUNTER: AtomicU32 = AtomicU32::new(1);

pub fn create_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // --- App submenu ---
    let about = PredefinedMenuItem::about(app, Some("About Greenlite Code"), Some(AboutMetadataBuilder::new().build()))?;
    let hide = PredefinedMenuItem::hide(app, Some("Hide Greenlite Code"))?;
    let hide_others = PredefinedMenuItem::hide_others(app, Some("Hide Others"))?;
    let show_all = PredefinedMenuItem::show_all(app, Some("Show All"))?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit Greenlite Code"))?;

    let app_submenu = SubmenuBuilder::new(app, "Greenlite Code")
        .item(&about)
        .item(&sep)
        .item(&hide)
        .item(&hide_others)
        .item(&show_all)
        .separator()
        .item(&quit)
        .build()?;

    // --- File submenu ---
    let new_window = MenuItemBuilder::with_id("new-window", "New Window")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    let close_window = PredefinedMenuItem::close_window(app, Some("Close Window"))?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&new_window)
        .separator()
        .item(&close_window)
        .build()?;

    // --- Edit submenu (needed for keyboard shortcuts on macOS) ---
    let undo = PredefinedMenuItem::undo(app, Some("Undo"))?;
    let redo = PredefinedMenuItem::redo(app, Some("Redo"))?;
    let cut = PredefinedMenuItem::cut(app, Some("Cut"))?;
    let copy = PredefinedMenuItem::copy(app, Some("Copy"))?;
    let paste = PredefinedMenuItem::paste(app, Some("Paste"))?;
    let select_all = PredefinedMenuItem::select_all(app, Some("Select All"))?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&undo)
        .item(&redo)
        .separator()
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .separator()
        .item(&select_all)
        .build()?;

    // --- Window submenu ---
    let minimize = PredefinedMenuItem::minimize(app, Some("Minimize"))?;
    let maximize = PredefinedMenuItem::maximize(app, Some("Zoom"))?;
    let fullscreen = PredefinedMenuItem::fullscreen(app, Some("Toggle Full Screen"))?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&minimize)
        .item(&maximize)
        .item(&fullscreen)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&window_submenu)
        .build()?;

    Ok(menu)
}

pub fn create_new_window(app: &AppHandle) {
    let count = WINDOW_COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("main-{}", count);

    let result = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title("greenlite-code")
        .inner_size(800.0, 600.0)
        .maximized(true)
        .build();

    if let Err(e) = result {
        eprintln!("Failed to create new window: {}", e);
    }
}
