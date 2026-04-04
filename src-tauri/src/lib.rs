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

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            platform::macos::setup_macos_window(app);

            // Auto-setup shell hooks + Claude Code hooks on first launch
            let setup_handle = app.handle().clone();
            setup::auto_setup(app.path().resource_dir().unwrap(), setup_handle);

            let app_state = Arc::new(Mutex::new(AppState {
                sessions: HashMap::new(),
                current_ui: "searching".to_string(),
            }));

            server::start_http_server(app.handle().clone(), app_state.clone());
            watchdog::start_watchdog(app.handle().clone(), app_state);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
