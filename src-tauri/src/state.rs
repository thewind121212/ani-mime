use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use serde::Serialize;
use tauri::Emitter;

/// Payload emitted when a task finishes (busy -> idle).
#[derive(Clone, Serialize)]
pub struct TaskCompleted {
    pub duration_secs: u64,
    /// Working directory of the session that just went idle (may be empty).
    /// Frontend renders the leaf folder name in the celebratory bubble.
    pub pwd: String,
    /// "claude" / "codex" / "shell" — lets the frontend pick a tailored message
    /// per source instead of one generic "task done" line.
    pub source: String,
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
    pub instance_name: String,
    pub pet: String,
    pub nickname: String,
    pub arrived_at: u64,
    pub duration_secs: u64,
    /// Optional one-line message from the sender. When present, the
    /// frontend renders it as a persistent speech bubble for the full
    /// visit duration instead of showing a random greeting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
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
    /// Human-readable session title (directory basename).
    pub title: String,
    /// Full working directory path (for grouping in the UI).
    pub pwd: String,
    /// TTY device (e.g. "/dev/ttys001") — identifies the terminal window.
    pub tty: String,
    /// Set by proc_scan: this shell has a `claude` process as a child/descendant.
    pub has_claude: bool,
    /// PID of the claude process running inside this shell, if any.
    pub claude_pid: Option<u32>,
    /// Set by proc_scan: this session's PID *is* itself a claude process
    /// (created by the pid=$PPID Claude Code hook). UI hides these from the
    /// dropdown — their state is overlaid onto the parent shell row instead.
    pub is_claude_proc: bool,
    /// Set by proc_scan: this shell has a `codex` process (OpenAI Codex CLI)
    /// as a child/descendant. Tracked alongside Claude so the UI can show a
    /// matching badge and route activity hints accordingly.
    pub has_codex: bool,
    /// PID of the codex process running inside this shell, if any.
    pub codex_pid: Option<u32>,
    /// Set by proc_scan: this session's PID *is* itself a codex process.
    /// Mirrors `is_claude_proc` so the UI can hide standalone codex rows.
    pub is_codex_proc: bool,
    /// Name of the foreground command running in this shell (e.g. "claude",
    /// "node", "bun"). Empty if the shell is idle at its prompt.
    pub fg_cmd: String,
    /// Millisecond timestamp of the most recent codex PermissionRequest
    /// `phase=start` ping. 0 when nothing is pending. Used to detect
    /// auto-approval: if a `state=busy` arrives between `phase=start` and
    /// the deferred `phase=wait`, the wait gets suppressed.
    pub perm_pending_since_ms: u64,
    /// Set true when `state=busy` arrives while a permission request is
    /// pending (i.e. between phase=start and phase=wait). Tells the wait
    /// handler the request was auto-approved and the yellow flash should
    /// be skipped. Cleared when the wait handler runs.
    pub busy_after_perm: bool,
    /// Set by proc_scan: this shell sits inside a tmux pane (any ancestor
    /// process is a tmux server). Treated as first-class for mascot status
    /// alongside Claude/Codex sessions, so commands run inside tmux still
    /// flip the dog to busy even when AI sessions are present elsewhere.
    pub is_tmux_proc: bool,
}

impl Session {
    pub fn new_idle(now: u64) -> Self {
        Session {
            busy_type: String::new(),
            ui_state: "idle".to_string(),
            last_seen: now,
            service_since: 0,
            busy_since: 0,
            title: String::new(),
            pwd: String::new(),
            tty: String::new(),
            has_claude: false,
            claude_pid: None,
            is_claude_proc: false,
            has_codex: false,
            codex_pid: None,
            is_codex_proc: false,
            fg_cmd: String::new(),
            perm_pending_since_ms: 0,
            busy_after_perm: false,
            is_tmux_proc: false,
        }
    }
}

/// Serializable session info returned to the frontend.
#[derive(Clone, Serialize)]
pub struct SessionInfo {
    pub pid: u32,
    pub title: String,
    pub ui_state: String,
    pub pwd: String,
    pub tty: String,
    pub busy_type: String,
    pub has_claude: bool,
    pub claude_pid: Option<u32>,
    pub is_claude_proc: bool,
    pub has_codex: bool,
    pub codex_pid: Option<u32>,
    pub is_codex_proc: bool,
    pub fg_cmd: String,
    pub is_tmux_proc: bool,
}

pub struct AppState {
    pub sessions: HashMap<u32, Session>,
    /// What the frontend is currently showing.
    pub current_ui: String,
    /// Mirror of `current_ui` but considering only AI sessions
    /// (Claude / Codex / pid=0). Drives the working/done sound transitions
    /// — tmux shells are excluded so plain `cd`/`ls`/`git status` runs
    /// don't fire the "task done" sound on every command.
    pub current_audio_ui: String,
    /// When the UI entered "idle" state (0 = not idle).
    pub idle_since: u64,
    /// True when idle countdown triggered sleep. Only busy/service wakes up.
    pub sleeping: bool,
    // --- Peer visits ---
    pub peers: HashMap<String, PeerInfo>,
    pub visitors: Vec<VisitingDog>,
    pub visiting: Option<String>,
    // --- Discovery diagnostics ---
    pub discovery_instance: String,
    pub discovery_addrs: Vec<String>,
    pub discovery_port: u16,
    /// Last time each peer was heard from via UDP broadcast (unix secs).
    /// Peers only in this map (not refreshed by mDNS) are pruned by the broadcast watchdog.
    pub broadcast_seen: HashMap<String, u64>,
    // --- Identity (for MCP pet-status) ---
    pub pet: String,
    pub nickname: String,
    pub started_at: u64,
    // --- Usage tracking (auto-resets daily) ---
    pub tasks_completed_today: u32,
    pub total_busy_secs_today: u64,
    pub longest_task_today_secs: u64,
    pub last_task_duration_secs: u64,
    pub usage_day: u64,
    /// Hash of the session fields exposed to the UI. `emit_if_changed` emits
    /// `sessions-changed` only when this value shifts, so the frontend can
    /// stay event-driven instead of polling.
    pub last_sessions_fingerprint: u64,
}

/// Deterministic hash of the session fields the UI renders. Pids are sorted so
/// the result doesn't depend on `HashMap` iteration order.
fn sessions_fingerprint(sessions: &HashMap<u32, Session>) -> u64 {
    let mut pids: Vec<u32> = sessions.keys().copied().collect();
    pids.sort_unstable();

    let mut h = DefaultHasher::new();
    for pid in pids {
        let s = &sessions[&pid];
        pid.hash(&mut h);
        s.ui_state.hash(&mut h);
        s.busy_type.hash(&mut h);
        s.pwd.hash(&mut h);
        s.title.hash(&mut h);
        s.tty.hash(&mut h);
        s.has_claude.hash(&mut h);
        s.claude_pid.hash(&mut h);
        s.is_claude_proc.hash(&mut h);
        s.has_codex.hash(&mut h);
        s.codex_pid.hash(&mut h);
        s.is_codex_proc.hash(&mut h);
        s.fg_cmd.hash(&mut h);
        s.is_tmux_proc.hash(&mut h);
    }
    h.finish()
}

/// Picks the "winning" UI state across all sessions.
/// Priority: busy > service > idle.
///
/// When at least one AI-tool session (Claude / Codex / pid=0 virtual claude)
/// exists, only those sessions drive the mascot. Plain shell sessions are
/// excluded from that pass — otherwise every `cd` / `ls` / `git status`
/// would flip the dog through busy→idle and trigger the celebration animation
/// on each command. Tmux sessions are an exception: users explicitly opt into
/// "command = working" by running inside a tmux pane, so we treat tmux shells
/// as first-class drivers alongside AI sessions. With no AI/tmux sessions
/// present we fall back to the original "consider every session" behavior so
/// shell-only users still see status.
pub fn resolve_ui_state(sessions: &HashMap<u32, Session>) -> &'static str {
    let has_driver = sessions
        .iter()
        .any(|(pid, s)| s.is_claude_proc || s.is_codex_proc || s.is_tmux_proc || *pid == 0);

    let mut has_busy = false;
    let mut has_waiting = false;
    let mut has_service = false;
    let mut has_idle = false;

    for (pid, s) in sessions.iter() {
        if has_driver {
            let drives = s.is_claude_proc || s.is_codex_proc || s.is_tmux_proc || *pid == 0;
            if !drives {
                continue;
            }
        }
        // Tmux shells fire `state=busy` on every preexec — including
        // `cd` / `ls` / `git status`. Counting those as busy makes the
        // mascot bounce on every prompt. Long-running commands
        // (`bun run dev`, `docker compose up`, ssh, ...) hit the
        // shell-script "service" classifier and arrive as
        // ui_state=service instead of busy, so they still drive the
        // mascot through the service arm below. Non-tmux drivers
        // (Claude / Codex / pid=0) always count.
        let tmux_only = s.is_tmux_proc && !s.is_claude_proc && !s.is_codex_proc && *pid != 0;
        match s.ui_state.as_str() {
            "busy" => {
                if !tmux_only {
                    has_busy = true;
                } else {
                    has_idle = true;
                }
            }
            "waiting" => has_waiting = true,
            "service" => has_service = true,
            "idle" => has_idle = true,
            _ => {}
        }
    }

    // Waiting outranks busy: a permission prompt blocks user input, so
    // surfacing the pink "needs you, boss" state takes priority over
    // any other busy AI session that's still chugging along.
    if has_waiting {
        "waiting"
    } else if has_busy {
        "busy"
    } else if has_service {
        "service"
    } else if has_idle {
        "idle"
    } else {
        "disconnected"
    }
}

/// Audio-only UI resolution: same priority rules as `resolve_ui_state` but
/// only AI sessions (Claude / Codex / pid=0 virtual claude) participate.
/// Tmux shells are deliberately excluded — they drive the mascot visually
/// (so the dot turns green during a `make build`) but the working/done
/// sound effects only fire for AI tasks.
pub fn resolve_audio_state(sessions: &HashMap<u32, Session>) -> &'static str {
    let mut has_waiting = false;
    let mut has_service = false;
    let mut has_idle = false;

    for (pid, s) in sessions.iter() {
        let is_ai = s.is_claude_proc || s.is_codex_proc || *pid == 0;
        if !is_ai {
            continue;
        }
        match s.ui_state.as_str() {
            "busy" => return "busy",
            "waiting" => has_waiting = true,
            "service" => has_service = true,
            "idle" => has_idle = true,
            _ => {}
        }
    }

    if has_waiting {
        "waiting"
    } else if has_service {
        "service"
    } else if has_idle {
        "idle"
    } else {
        "disconnected"
    }
}

pub fn emit_if_changed(app: &tauri::AppHandle, state: &mut AppState) {
    let new_ui = resolve_ui_state(&state.sessions);
    let new_audio_ui = resolve_audio_state(&state.sessions);

    // If sleeping, only wake up for busy or service
    if state.sleeping {
        if new_ui == "busy" || new_ui == "service" {
            crate::app_log!("[state] waking from sleep for {}", new_ui);
            state.sleeping = false;
        } else {
            // Still check for session-set changes even while sleeping, so the
            // session-list UI updates (e.g. a shell exiting shouldn't wait for
            // the next global transition).
            maybe_emit_sessions_changed(app, state);
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

    if new_audio_ui != state.current_audio_ui {
        crate::app_log!(
            "[state] audio transition: {} -> {}",
            state.current_audio_ui, new_audio_ui
        );
        if let Err(e) = app.emit("audio-status-changed", new_audio_ui) {
            crate::app_error!("[state] failed to emit audio-status-changed: {}", e);
        }
        state.current_audio_ui = new_audio_ui.to_string();
    }

    maybe_emit_sessions_changed(app, state);
}

fn maybe_emit_sessions_changed(app: &tauri::AppHandle, state: &mut AppState) {
    let fp = sessions_fingerprint(&state.sessions);
    if fp != state.last_sessions_fingerprint {
        state.last_sessions_fingerprint = fp;
        if let Err(e) = app.emit("sessions-changed", ()) {
            crate::app_error!("[state] failed to emit sessions-changed: {}", e);
        }
    }
}
