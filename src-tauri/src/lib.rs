#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn get_query_param<'a>(url: &'a str, key: &str) -> Option<&'a str> {
    let query = url.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        if kv.next() == Some(key) {
            return kv.next();
        }
    }
    None
}

/// Per-shell session state.
#[derive(Clone)]
struct Session {
    /// "task", "service", or "" (idle)
    busy_type: String,
    /// Current UI state emitted for this session.
    ui_state: String,
    /// Last time we heard anything from this PID (heartbeat or status).
    last_seen: u64,
    /// When this session entered "service" state (0 = not in service).
    service_since: u64,
}

/// Picks the "winning" UI state across all sessions.
/// Priority: busy > service > idle.
fn resolve_ui_state(sessions: &HashMap<u32, Session>) -> &'static str {
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

struct AppState {
    sessions: HashMap<u32, Session>,
    /// What the frontend is currently showing.
    current_ui: String,
}

fn emit_if_changed(app: &tauri::AppHandle, state: &mut AppState) {
    let new_ui = resolve_ui_state(&state.sessions);
    if new_ui != state.current_ui {
        let _ = app.emit("status-changed", new_ui);
        state.current_ui = new_ui.to_string();
    }
}

fn start_http_server(app_handle: tauri::AppHandle, app_state: Arc<Mutex<AppState>>) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http("127.0.0.1:1234") {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[http] failed to bind :1234: {e}");
                return;
            }
        };
        eprintln!("[http] listening on 127.0.0.1:1234");

        let cors: tiny_http::Header = "Access-Control-Allow-Origin: *"
            .parse()
            .unwrap();

        for req in server.incoming_requests() {
            let url = req.url().to_string();
            let now = now_secs();

            if url.starts_with("/status") {
                if let Some(pid_str) = get_query_param(&url, "pid") {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        let mut st = app_state.lock().unwrap();

                        let session = st.sessions.entry(pid).or_insert(Session {
                            busy_type: String::new(),
                            ui_state: "idle".to_string(),
                            last_seen: now,
                            service_since: 0,
                        });
                        session.last_seen = now;

                        if url.contains("state=busy") {
                            let cmd_type = get_query_param(&url, "type")
                                .unwrap_or("task");
                            session.busy_type = cmd_type.to_string();

                            if cmd_type == "service" {
                                session.ui_state = "service".to_string();
                                session.service_since = now;
                            } else {
                                session.ui_state = "busy".to_string();
                                session.service_since = 0;
                            }

                            emit_if_changed(&app_handle, &mut st);
                        } else if url.contains("state=idle") {
                            session.busy_type.clear();
                            session.ui_state = "idle".to_string();
                            session.service_since = 0;
                            emit_if_changed(&app_handle, &mut st);
                        }
                    }
                }
            } else if url.starts_with("/heartbeat") {
                if let Some(pid_str) = get_query_param(&url, "pid") {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        let mut st = app_state.lock().unwrap();
                        let session = st.sessions.entry(pid).or_insert(Session {
                            busy_type: String::new(),
                            ui_state: "idle".to_string(),
                            last_seen: now,
                            service_since: 0,
                        });
                        // Only refresh last_seen for idle sessions.
                        // Busy sessions should NOT be kept alive by heartbeat —
                        // let the watchdog clean them up if no status signal comes.
                        if session.ui_state != "busy" {
                            session.last_seen = now;
                        }

                        emit_if_changed(&app_handle, &mut st);
                    }
                }
            }

            // Debug endpoint: GET /debug → show all sessions
            if url.starts_with("/debug") {
                let st = app_state.lock().unwrap();
                let mut lines = Vec::new();
                lines.push(format!("current_ui: {}", st.current_ui));
                lines.push(format!("sessions: {}", st.sessions.len()));
                for (pid, s) in &st.sessions {
                    lines.push(format!(
                        "  pid={} ui={} type={} last_seen={}s_ago",
                        pid, s.ui_state, s.busy_type, now - s.last_seen
                    ));
                }
                let body = lines.join("\n");
                let resp = tiny_http::Response::from_string(body)
                    .with_status_code(200)
                    .with_header(cors.clone());
                let _ = req.respond(resp);
                continue;
            }

            let resp = tiny_http::Response::from_string("ok")
                .with_status_code(200)
                .with_header(cors.clone());
            let _ = req.respond(resp);
        }
    });
}

/// Watchdog: runs every 2s.
/// - Transitions service → idle after 2s of showing service.
/// - Removes stale sessions (no heartbeat for 40s).
fn start_watchdog(app_handle: tauri::AppHandle, app_state: Arc<Mutex<AppState>>) {
    const HEARTBEAT_TIMEOUT_SECS: u64 = 40;
    const SERVICE_DISPLAY_SECS: u64 = 2;

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
        let has_shell_sessions = st.sessions.iter()
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

fn cmd_exists(name: &str) -> bool {
    std::process::Command::new("which")
        .arg(name)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Show a native macOS dialog. Returns true if user clicked OK/Yes.
fn macos_dialog(title: &str, message: &str, buttons: &[&str]) -> String {
    let buttons_str = buttons
        .iter()
        .map(|b| format!("\"{}\"", b))
        .collect::<Vec<_>>()
        .join(", ");

    let script = format!(
        r#"display dialog "{}" with title "{}" buttons {{{}}} default button 1"#,
        message.replace('"', "\\\""),
        title.replace('"', "\\\""),
        buttons_str
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();

    match output {
        Ok(o) => {
            let result = String::from_utf8_lossy(&o.stdout).to_string();
            // osascript returns "button returned:OK" format
            result
                .split("button returned:")
                .nth(1)
                .unwrap_or("")
                .trim()
                .to_string()
        }
        Err(_) => String::new(),
    }
}

/// Show a macOS "choose from list" dialog. Returns selected items.
fn macos_choose_list(title: &str, message: &str, items: &[&str]) -> Vec<String> {
    let items_str = items
        .iter()
        .map(|i| format!("\"{}\"", i))
        .collect::<Vec<_>>()
        .join(", ");

    let script = format!(
        r#"choose from list {{{}}} with title "{}" with prompt "{}" with multiple selections allowed"#,
        items_str,
        title.replace('"', "\\\""),
        message.replace('"', "\\\""),
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output();

    match output {
        Ok(o) => {
            let result = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if result == "false" || result.is_empty() {
                return vec![];
            }
            result.split(", ").map(|s| s.to_string()).collect()
        }
        Err(_) => vec![],
    }
}

struct ShellInfo {
    name: &'static str,
    script_file: &'static str,
    rc_path: PathBuf,
    marker: &'static str,
}

/// Auto-setup on first launch:
/// 1. Detect installed shells (zsh, bash, fish)
/// 2. Ask user which shells to set up
/// 3. Optionally configure Claude Code hooks
fn auto_setup(resource_dir: PathBuf, app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let home = dirs::home_dir().unwrap();
        let settings_path = home.join(".claude/settings.json");

        // --- Detect installed shells and which need setup ---
        let shells: Vec<ShellInfo> = vec![
            ShellInfo {
                name: "zsh",
                script_file: "terminal-mirror.zsh",
                rc_path: home.join(".zshrc"),
                marker: "terminal-mirror.zsh",
            },
            ShellInfo {
                name: "bash",
                script_file: "terminal-mirror.bash",
                rc_path: home.join(".bashrc"),
                marker: "terminal-mirror.bash",
            },
            ShellInfo {
                name: "fish",
                script_file: "terminal-mirror.fish",
                rc_path: home.join(".config/fish/config.fish"),
                marker: "terminal-mirror.fish",
            },
        ];

        // Filter: installed + not yet configured
        let available: Vec<&ShellInfo> = shells
            .iter()
            .filter(|s| cmd_exists(s.name))
            .collect();

        let needs_setup: Vec<&ShellInfo> = available
            .iter()
            .filter(|s| {
                let content = std::fs::read_to_string(&s.rc_path).unwrap_or_default();
                !content.contains(s.marker)
            })
            .copied()
            .collect();

        let claude_done = {
            let content = std::fs::read_to_string(&settings_path).unwrap_or_default();
            content.contains("127.0.0.1:1234")
        };

        // Nothing to do — skip silently
        if needs_setup.is_empty() && claude_done {
            eprintln!("[setup] already initialized, skipping");
            return;
        }

        let _ = app_handle.emit("status-changed", "initializing");

        // --- 1. Shell setup ---
        if !needs_setup.is_empty() {
            let chosen: Vec<String> = if needs_setup.len() == 1 {
                // Only one shell needs setup — simple Yes/No
                let shell = needs_setup[0];
                let answer = macos_dialog(
                    "Ani-Mime Setup",
                    &format!(
                        "{} detected. Ani-Mime needs to add a hook to {} to track terminal activity.\n\nAllow setup?",
                        shell.name, shell.rc_path.display()
                    ),
                    &["Yes", "Skip"],
                );
                if answer == "Yes" {
                    vec![shell.name.to_string()]
                } else {
                    vec![]
                }
            } else {
                // Multiple shells — let user choose
                let mut items: Vec<&str> = needs_setup.iter().map(|s| s.name).collect();
                items.push("All");
                let selected = macos_choose_list(
                    "Ani-Mime Setup",
                    "Multiple shells detected. Select which ones to set up for terminal tracking:",
                    &items,
                );
                if selected.iter().any(|s| s == "All") {
                    needs_setup.iter().map(|s| s.name.to_string()).collect()
                } else {
                    selected
                }
            };

            // User skipped all shells and none were previously configured — quit
            if chosen.is_empty() {
                let any_shell_configured = shells.iter().any(|s| {
                    let content = std::fs::read_to_string(&s.rc_path).unwrap_or_default();
                    content.contains(s.marker)
                });
                if !any_shell_configured {
                    macos_dialog(
                        "Ani-Mime",
                        "Ani-Mime requires at least one shell (zsh, bash, or fish) to be configured for terminal tracking.\n\nThe app will now close.\nRestart Ani-Mime when you're ready to set up.",
                        &["OK"],
                    );
                    std::process::exit(0);
                }
            }

            // Install hooks for chosen shells
            for shell in &needs_setup {
                if !chosen.iter().any(|c| c == shell.name) {
                    continue;
                }
                let script_path = resource_dir.join(format!("script/{}", shell.script_file));
                if !script_path.exists() {
                    eprintln!("[setup] script not found: {}", script_path.display());
                    continue;
                }

                // Ensure parent directory exists (for fish)
                if let Some(parent) = shell.rc_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }

                let line = format!(
                    "\n# --- Ani-Mime Terminal Hook ---\nsource \"{}\"\n",
                    script_path.display()
                );
                let _ = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&shell.rc_path)
                    .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()));
                eprintln!("[setup] injected {} into {}", shell.script_file, shell.rc_path.display());
            }
        } else if available.is_empty() {
            macos_dialog(
                "Ani-Mime",
                "No supported shell found (zsh, bash, or fish).\n\nPlease install one and restart the app.",
                &["OK"],
            );
            std::process::exit(0);
        }

        // --- 2. Claude Code hooks ---
        if !claude_done {
            let has_claude = cmd_exists("claude");
            let answer = if has_claude {
                macos_dialog(
                    "Ani-Mime Setup",
                    "Claude Code detected! Ani-Mime can track when Claude is working.\n\nThis adds hooks to ~/.claude/settings.json.\n\nAllow setup?",
                    &["Yes", "Skip"],
                )
            } else {
                macos_dialog(
                    "Ani-Mime",
                    "Claude Code is not installed.\n\nThis is optional — Ani-Mime works without it.\nIf you install Claude Code later, restart Ani-Mime to set up tracking.\n\nWould you like to pre-configure the hooks now?",
                    &["Yes", "Skip"],
                )
            };
            if answer == "Yes" {
                setup_claude_hooks(&home);
            } else {
                eprintln!("[setup] user skipped Claude Code hooks setup");
            }
        }

        let _ = app_handle.emit("status-changed", "searching");
    });
}

fn setup_claude_hooks(home: &std::path::Path) {
    let claude_dir = home.join(".claude");
    let settings_path = claude_dir.join("settings.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = std::fs::read_to_string(&settings_path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        let _ = std::fs::create_dir_all(&claude_dir);
        serde_json::json!({})
    };

    let hooks = settings
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert(serde_json::json!({}));

    let busy_cmd = "curl -s --max-time 1 'http://127.0.0.1:1234/status?pid=0&state=busy&type=task' > /dev/null 2>&1";
    let idle_cmd = "curl -s --max-time 1 'http://127.0.0.1:1234/status?pid=0&state=idle' > /dev/null 2>&1";
    let ani_marker = "127.0.0.1:1234";

    let has_ani_hook = |arr: &serde_json::Value| -> bool {
        arr.as_array().map_or(false, |entries| {
            entries.iter().any(|entry| {
                entry["hooks"].as_array().map_or(false, |hks| {
                    hks.iter().any(|h| {
                        h["command"]
                            .as_str()
                            .map_or(false, |c| c.contains(ani_marker))
                    })
                })
            })
        })
    };

    let add_hook = |hooks_obj: &mut serde_json::Value, event: &str, cmd: &str| {
        let arr = hooks_obj
            .as_object_mut()
            .unwrap()
            .entry(event)
            .or_insert(serde_json::json!([]));

        if !has_ani_hook(arr) {
            if let Some(entries) = arr.as_array_mut() {
                if entries.is_empty() {
                    entries.push(serde_json::json!({
                        "matcher": "",
                        "hooks": [{ "type": "command", "command": cmd }]
                    }));
                } else {
                    if let Some(first) = entries.first_mut() {
                        if let Some(hks) = first["hooks"].as_array_mut() {
                            hks.push(serde_json::json!({
                                "type": "command",
                                "command": cmd
                            }));
                        }
                    }
                }
            }
        }
    };

    add_hook(hooks, "PreToolUse", busy_cmd);
    add_hook(hooks, "UserPromptSubmit", busy_cmd);
    add_hook(hooks, "Stop", idle_cmd);
    add_hook(hooks, "SessionStart", idle_cmd);
    add_hook(hooks, "SessionEnd", idle_cmd);

    let _ = std::fs::write(
        &settings_path,
        serde_json::to_string_pretty(&settings).unwrap(),
    );
    eprintln!("[setup] configured Claude Code hooks in ~/.claude/settings.json");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let _ = window.set_shadow(false);
            let _ = window.set_visible_on_all_workspaces(true);

            #[cfg(target_os = "macos")]
            {
                use cocoa::appkit::{NSColor, NSWindow};
                use cocoa::base::{id, nil, NO};

                if let Ok(ns_win) = window.ns_window() {
                    let ns_win = ns_win as id;
                    unsafe {
                        ns_win.setOpaque_(NO);
                        ns_win.setBackgroundColor_(NSColor::clearColor(nil));
                    }
                }

                let _ = window.with_webview(|webview| {
                    use cocoa::foundation::NSString;
                    let wk: id = webview.inner() as id;
                    unsafe {
                        let no: id = msg_send![class!(NSNumber), numberWithBool: NO];
                        let key = NSString::alloc(nil).init_str("drawsBackground");
                        let _: () = msg_send![wk, setValue: no forKey: key];
                    }
                });
            }

            // Auto-setup zsh hooks + Claude Code hooks on first launch
            let setup_handle = app.handle().clone();
            auto_setup(app.path().resource_dir().unwrap(), setup_handle);

            let app_state = Arc::new(Mutex::new(AppState {
                sessions: HashMap::new(),
                current_ui: "searching".to_string(),
            }));

            start_http_server(app.handle().clone(), app_state.clone());
            start_watchdog(app.handle().clone(), app_state);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
