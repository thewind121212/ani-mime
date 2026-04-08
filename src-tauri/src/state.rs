use std::collections::HashMap;
use serde::Serialize;
use tauri::Emitter;

/// Payload emitted when a task finishes (busy -> idle).
#[derive(Clone, Serialize)]
pub struct TaskCompleted {
    pub duration_secs: u64,
}

/// A peer discovered via mDNS on the local network.
#[derive(Clone, Serialize)]
pub struct PeerInfo {
    pub instance_name: String,
    pub nickname: String,
    pub pet: String,
    pub ip: String,
    pub port: u16,
}

/// A dog currently visiting this screen.
#[derive(Clone, Serialize)]
pub struct VisitingDog {
    pub pet: String,
    pub nickname: String,
    pub arrived_at: u64,
    pub duration_secs: u64,
}

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
    /// When this session entered "busy" state (0 = not busy).
    pub busy_since: u64,
}

impl Session {
    pub fn new_idle(now: u64) -> Self {
        Session {
            busy_type: String::new(),
            ui_state: "idle".to_string(),
            last_seen: now,
            service_since: 0,
            busy_since: 0,
        }
    }
}

pub struct AppState {
    pub sessions: HashMap<u32, Session>,
    /// What the frontend is currently showing.
    pub current_ui: String,
    /// When the UI entered "idle" state (0 = not idle).
    pub idle_since: u64,
    /// True when idle countdown triggered sleep. Only busy/service wakes up.
    pub sleeping: bool,
    // --- Peer visits ---
    pub peers: HashMap<String, PeerInfo>,
    pub visitors: Vec<VisitingDog>,
    pub visiting: Option<String>,
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

    // If sleeping, only wake up for busy or service
    if state.sleeping {
        if new_ui == "busy" || new_ui == "service" {
            crate::app_log!("[state] waking from sleep for {}", new_ui);
            state.sleeping = false;
        } else {
            return;
        }
    }

    if new_ui != state.current_ui {
        crate::app_log!("[state] ui transition: {} -> {}", state.current_ui, new_ui);

        // Track when UI enters idle for sleep countdown
        if new_ui == "idle" {
            state.idle_since = crate::helpers::now_secs();
        } else {
            state.idle_since = 0;
        }
        if let Err(e) = app.emit("status-changed", new_ui) {
            crate::app_error!("[state] failed to emit status-changed: {}", e);
        }
        state.current_ui = new_ui.to_string();
    }
}
