use std::sync::{Arc, Mutex};
use tauri::Emitter;

use crate::helpers::now_secs;
use crate::state::{emit_if_changed, AppState};

const HEARTBEAT_TIMEOUT_SECS: u64 = 40;
const SERVICE_DISPLAY_SECS: u64 = 2;

/// Watchdog: runs every 2s.
/// - Transitions service → idle after 2s of showing service.
/// - Removes stale sessions (no heartbeat for 40s).
pub fn start_watchdog(app_handle: tauri::AppHandle, app_state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));

        let now = now_secs();
        let mut st = app_state.lock().unwrap();

        // Transition service → idle after display period
        for session in st.sessions.values_mut() {
            if session.ui_state == "service"
                && session.service_since > 0
                && now - session.service_since >= SERVICE_DISPLAY_SECS
            {
                session.ui_state = "idle".to_string();
                session.service_since = 0;
            }
        }

        // Remove stale sessions (no heartbeat for 40s)
        // pid=0 is the Claude Code hooks session — keep it alive as long as
        // any shell session exists (shell heartbeat keeps everything alive)
        let has_shell_sessions = st
            .sessions
            .iter()
            .any(|(pid, s)| *pid != 0 && now - s.last_seen < HEARTBEAT_TIMEOUT_SECS);

        st.sessions.retain(|pid, session| {
            if *pid == 0 {
                has_shell_sessions
            } else {
                now - session.last_seen < HEARTBEAT_TIMEOUT_SECS
            }
        });

        // Update UI
        if st.sessions.is_empty() && st.current_ui != "searching" {
            if st.current_ui != "disconnected" {
                let _ = app_handle.emit("status-changed", "disconnected");
                st.current_ui = "disconnected".to_string();
            }
        } else {
            emit_if_changed(&app_handle, &mut st);
        }
    });
}
