#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

mod helpers;
mod platform;
mod server;
mod setup;
mod state;
mod watchdog;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder, PredefinedMenuItem, MenuItemBuilder};

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            platform::macos::setup_macos_window(app);

            // Build native macOS menu bar
            let app_menu = SubmenuBuilder::new(app, "Ani-Mime")
                .item(&PredefinedMenuItem::about(app, Some("About Ani-Mime"), None)?)
                .separator()
                .item(&MenuItemBuilder::with_id("settings", "Settings...").accelerator("Cmd+,").build(app)?)
                .separator()
                .item(&PredefinedMenuItem::quit(app, Some("Quit Ani-Mime"))?)
                .build()?;

            let menu = MenuBuilder::new(app).item(&app_menu).build()?;
            app.set_menu(menu)?;

            // Handle menu events
            let handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                if event.id().as_ref() == "settings" {
                    if let Some(win) = handle.get_webview_window("settings") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            });

            // Hide settings window on close instead of destroying it
            if let Some(win) = app.get_webview_window("settings") {
                let win_clone = win.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            // Auto-setup shell hooks + Claude Code hooks on first launch
            let setup_handle = app.handle().clone();
            setup::auto_setup(app.path().resource_dir().unwrap(), setup_handle);

            let app_state = Arc::new(Mutex::new(AppState {
                sessions: HashMap::new(),
                current_ui: "searching".to_string(),
                idle_since: 0,
                sleeping: false,
            }));

            server::start_http_server(app.handle().clone(), app_state.clone());
            watchdog::start_watchdog(app.handle().clone(), app_state);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
