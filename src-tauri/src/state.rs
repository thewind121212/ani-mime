use std::collections::HashMap;
use tauri::Emitter;

/// Per-shell session state.
#[derive(Clone)]
pub struct Session {
    /// "task", "service", or "" (idle)
    pub busy_type: String,
    /// Current UI state emitted for this session.
    pub ui_state: String,
    /// Last time we heard anything from this PID (heartbeat or status).
    pub last_seen: u64,
    /// When this session entered "service" state (0 = not in service).
    pub service_since: u64,
}

impl Session {
    pub fn new_idle(now: u64) -> Self {
        Session {
            busy_type: String::new(),
            ui_state: "idle".to_string(),
            last_seen: now,
            service_since: 0,
        }
    }
}

pub struct AppState {
    pub sessions: HashMap<u32, Session>,
    /// What the frontend is currently showing.
    pub current_ui: String,
}

/// Picks the "winning" UI state across all sessions.
/// Priority: busy > service > idle.
pub fn resolve_ui_state(sessions: &HashMap<u32, Session>) -> &'static str {
    let mut has_service = false;
    let mut has_idle = false;

    for s in sessions.values() {
        match s.ui_state.as_str() {
            "busy" => return "busy",
            "service" => has_service = true,
            "idle" => has_idle = true,
            _ => {}
        }
    }

    if has_service {
        "service"
    } else if has_idle {
        "idle"
    } else {
        "disconnected"
    }
}

pub fn emit_if_changed(app: &tauri::AppHandle, state: &mut AppState) {
    let new_ui = resolve_ui_state(&state.sessions);
    if new_ui != state.current_ui {
        let _ = app.emit("status-changed", new_ui);
        state.current_ui = new_ui.to_string();
    }
}
