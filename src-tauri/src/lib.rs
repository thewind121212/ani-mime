#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

mod discovery;
mod helpers;
mod platform;
mod server;
mod setup;
mod state;
mod watchdog;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, SubmenuBuilder, PredefinedMenuItem, MenuItemBuilder};

use crate::state::AppState;

const VISIT_DURATION_SECS: u64 = 15;

#[tauri::command]
fn start_visit(
    peer_id: String,
    nickname: String,
    pet: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let (ip, port) = {
        let st = state.lock().unwrap();

        // Already visiting someone
        if st.visiting.is_some() {
            return Err("Already visiting someone".to_string());
        }

        let peer = st.peers.get(&peer_id)
            .ok_or("Peer not found")?;
        (peer.ip.clone(), peer.port)
    };

    // Send visit request to peer
    let body = serde_json::json!({
        "pet": pet,
        "nickname": nickname,
        "duration_secs": VISIT_DURATION_SECS,
    });

    let url = format!("http://{}:{}/visit", ip, port);

    // Send the HTTP request in a thread to avoid blocking
    let send_result = std::thread::spawn({
        let url = url.clone();
        let body = body.clone();
        move || {
            ureq::post(&url)
                .send_json(&body)
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
    }).join().map_err(|_| "Thread panicked".to_string())?;

    send_result.map_err(|e| format!("Failed to send visit: {}", e))?;

    // Mark ourselves as visiting
    {
        let mut st = state.lock().unwrap();
        st.visiting = Some(peer_id.clone());
    }
    let _ = app.emit("dog-away", true);

    // Schedule return after VISIT_DURATION_SECS
    let state_clone = state.inner().clone();
    let app_clone = app.clone();
    let nickname_clone = nickname.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(VISIT_DURATION_SECS));

        // Send visit-end to peer
        let end_body = serde_json::json!({ "nickname": nickname_clone });
        if let Ok(peer_info) = {
            let st = state_clone.lock().unwrap();
            st.peers.get(&peer_id).cloned().ok_or(())
        } {
            let end_url = format!("http://{}:{}/visit-end", peer_info.ip, peer_info.port);
            let _ = ureq::post(&end_url).send_json(&end_body);
        }

        // Dog comes home
        let mut st = state_clone.lock().unwrap();
        st.visiting = None;
        drop(st);
        let _ = app_clone.emit("dog-away", false);
        eprintln!("[visit] dog returned home");
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![start_visit])
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
                peers: HashMap::new(),
                visitors: Vec::new(),
                visiting: None,
            }));

            app.manage(app_state.clone());

            server::start_http_server(app.handle().clone(), app_state.clone());
            watchdog::start_watchdog(app.handle().clone(), app_state.clone());

            // Start mDNS peer discovery
            // Load nickname/pet from store for mDNS registration
            let discovery_handle = app.handle().clone();
            let discovery_state = app_state.clone();
            std::thread::spawn(move || {
                // Give the store plugin time to initialize
                std::thread::sleep(std::time::Duration::from_millis(500));

                let app_data_dir = discovery_handle.path().app_data_dir().unwrap();
                let store_path = app_data_dir.join("settings.json");
                let (nickname, pet) = if store_path.exists() {
                    let content = std::fs::read_to_string(&store_path).unwrap_or_default();
                    let json: serde_json::Value = serde_json::from_str(&content).unwrap_or_default();
                    let n = json["nickname"].as_str().unwrap_or("Anonymous").to_string();
                    let p = json["pet"].as_str().unwrap_or("rottweiler").to_string();
                    (n, p)
                } else {
                    ("Anonymous".to_string(), "rottweiler".to_string())
                };

                discovery::start_discovery(discovery_handle, discovery_state, nickname, pet);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
