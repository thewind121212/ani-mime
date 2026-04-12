use std::sync::{Arc, Mutex};
use tauri::Emitter;

use crate::helpers::now_secs;
use crate::state::{emit_if_changed, AppState};

const HEARTBEAT_TIMEOUT_SECS: u64 = 40;
const SERVICE_DISPLAY_SECS: u64 = 2;
const IDLE_TO_SLEEP_SECS: u64 = 120;

/// Watchdog: runs every 2s.
/// - Transitions service -> idle after 2s of showing service.
/// - Removes stale sessions (no heartbeat for 40s).
pub fn start_watchdog(app_handle: tauri::AppHandle, app_state: Arc<Mutex<AppState>>) {
    crate::app_log!("[watchdog] starting (heartbeat_timeout={}s, service_display={}s, idle_to_sleep={}s)",
        HEARTBEAT_TIMEOUT_SECS, SERVICE_DISPLAY_SECS, IDLE_TO_SLEEP_SECS);

    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));

        let now = now_secs();
        let mut st = app_state.lock().unwrap();

        // Transition service -> idle after display period
        for (pid, session) in st.sessions.iter_mut() {
            if session.ui_state == "service"
                && session.service_since > 0
                && now - session.service_since >= SERVICE_DISPLAY_SECS
            {
                crate::app_log!("[watchdog] pid={} service -> idle (displayed {}s)", pid, now - session.service_since);
                session.ui_state = "idle".to_string();
                session.service_since = 0;
            }
        }

        // Remove stale sessions (no heartbeat for 40s)
        // pid=0 (Claude Code): no heartbeat, never expire by timeout
        let before_count = st.sessions.len();
        let stale_pids: Vec<u32> = st.sessions.iter()
            .filter(|(pid, session)| **pid != 0 && now - session.last_seen >= HEARTBEAT_TIMEOUT_SECS)
            .map(|(pid, _)| *pid)
            .collect();

        for pid in &stale_pids {
            crate::app_warn!("[watchdog] removing stale session pid={} (no heartbeat for {}s)",
                pid, now - st.sessions[pid].last_seen);
        }

        st.sessions.retain(|pid, session| {
            if *pid == 0 {
                true
            } else {
                now - session.last_seen < HEARTBEAT_TIMEOUT_SECS
            }
        });

        if before_count != st.sessions.len() {
            crate::app_log!("[watchdog] sessions: {} -> {}", before_count, st.sessions.len());
        }

        // Remove expired visitors
        let expired_visitors: Vec<(String, String)> = st.visitors
            .iter()
            .filter(|v| now - v.arrived_at >= v.duration_secs)
            .map(|v| (v.instance_name.clone(), v.nickname.clone()))
            .collect();

        for (instance_name, nickname) in &expired_visitors {
            crate::app_log!("[watchdog] visitor {} [{}] expired", nickname, instance_name);
            if let Err(e) = app_handle.emit("visitor-left", serde_json::json!({
                "instance_name": instance_name,
                "nickname": nickname,
            })) {
                crate::app_error!("[watchdog] failed to emit visitor-left: {}", e);
            }
        }

        if !expired_visitors.is_empty() {
            let before = st.visitors.len();
            st.visitors.retain(|v| now - v.arrived_at < v.duration_secs);
            crate::app_log!("[watchdog] visitors: {} -> {}", before, st.visitors.len());
        }

        // Update UI
        if st.sessions.is_empty() && st.current_ui != "searching" && st.current_ui != "initializing" {
            if st.current_ui != "disconnected" {
                crate::app_log!("[watchdog] no sessions, ui: {} -> disconnected", st.current_ui);
                if let Err(e) = app_handle.emit("status-changed", "disconnected") {
                    crate::app_error!("[watchdog] failed to emit status-changed: {}", e);
                }
                st.current_ui = "disconnected".to_string();
            }
        } else {
            emit_if_changed(&app_handle, &mut st);
        }

        // Idle -> Sleep countdown
        if st.current_ui == "idle"
            && st.idle_since > 0
            && now - st.idle_since >= IDLE_TO_SLEEP_SECS
        {
            crate::app_log!("[watchdog] idle for {}s, entering sleep mode", now - st.idle_since);
            if let Err(e) = app_handle.emit("status-changed", "disconnected") {
                crate::app_error!("[watchdog] failed to emit sleep transition: {}", e);
            }
            st.current_ui = "disconnected".to_string();
            st.idle_since = 0;
            st.sleeping = true;
        }
    });
}
