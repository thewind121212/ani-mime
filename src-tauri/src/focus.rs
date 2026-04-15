//! Focus a terminal window: walk the process tree up from a shell pid, find the
//! owning terminal app (iTerm, Terminal, VS Code, etc.) and activate it. For
//! terminals that expose AppleScript, also jump to the specific tab that owns
//! the given TTY.
//!
//! Strategy:
//!   1. Always fall back to `open -a <App>` — that's a plain Launch Services
//!      call, doesn't need automation permission, and works for every GUI app.
//!   2. Additionally try AppleScript for tab-precise targeting on apps that
//!      support it (iTerm2, Terminal.app). If AppleScript fails (permission
//!      not yet granted, etc.), step 1 has already brought the app forward so
//!      the user still sees something happen.

use std::sync::{Arc, Mutex};

use crate::proc_scan::{find_terminal_app_for_pid, get_proc_info};
use crate::state::AppState;

/// Bundle ID for VS Code. Used by `tell application id` which works regardless
/// of where the .app is installed or what the local name is.
const BUNDLE_VSCODE: &str = "com.microsoft.VSCode";
/// Bundle ID for Cursor. Todesktop-based apps have these auto-generated IDs.
const BUNDLE_CURSOR: &str = "com.todesktop.230313mzl4w4u92";

fn escape_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Run an AppleScript snippet via `osascript -e`. Returns Ok(()) on success,
/// Err with stderr on failure.
fn run_applescript(script: &str) -> Result<(), String> {
    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("spawn: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Activate an app using Launch Services (`open -a`). No automation permission
/// needed. Always our safety-net fallback.
fn open_app(app_name: &str) {
    let res = std::process::Command::new("open")
        .arg("-a")
        .arg(app_name)
        .output();
    match res {
        Ok(o) if !o.status.success() => {
            let err = String::from_utf8_lossy(&o.stderr);
            crate::app_warn!("[focus] open -a {} failed: {}", app_name, err.trim());
        }
        Err(e) => {
            crate::app_error!("[focus] open -a {} spawn failed: {}", app_name, e);
        }
        _ => {
            crate::app_log!("[focus] open -a {} ok", app_name);
        }
    }
}

/// iTerm2: try to pick the session whose tty matches ours. The script
/// activates iTerm first (so even if the tab match fails we still see it).
fn try_focus_iterm_tab(tty: &str) -> Result<(), String> {
    let tty_escaped = escape_applescript(tty);
    // Use bundle id for robustness — works whether the app is named "iTerm" or "iTerm2".
    let script = format!(
        r#"tell application id "com.googlecode.iterm2"
    activate
    repeat with w in windows
        repeat with t in tabs of w
            repeat with s in sessions of t
                if tty of s is equal to "{}" then
                    tell w to select t
                    tell t to select s
                    return "ok"
                end if
            end repeat
        end repeat
    end repeat
    return "activated-no-match"
end tell"#,
        tty_escaped
    );
    run_applescript(&script)
}

/// Electron apps like VS Code / Cursor don't expose terminal panes via
/// AppleScript, but their windows have titles that include the workspace name.
/// We use System Events (Accessibility API) to raise the window whose title
/// contains the workspace we want.
///
/// Returns Ok(()) if a matching window was raised, Err with stderr otherwise.
fn try_focus_electron_window(bundle_id: &str, title_needle: &str) -> Result<(), String> {
    let needle = escape_applescript(title_needle);
    let bid = escape_applescript(bundle_id);
    let script = format!(
        r#"tell application id "{}" to activate
tell application "System Events"
    set procs to (every process whose bundle identifier is "{}")
    repeat with p in procs
        repeat with w in windows of p
            if title of w contains "{}" then
                perform action "AXRaise" of w
                set frontmost of p to true
                return "ok"
            end if
        end repeat
    end repeat
    return "activated-no-window-match"
end tell"#,
        bid, bid, needle
    );
    run_applescript(&script)
}

/// Detect if a shell sits under a tmux server (walks up the parent chain
/// looking for a process named "tmux" or whose path ends in "/tmux").
/// Returns the tmux server's PID if found.
fn shell_is_in_tmux(pid: u32) -> Option<u32> {
    use crate::proc_scan::get_proc_info;

    // Use ps-based ppid map as fallback (same trick we use elsewhere for
    // root-owned ancestors). Inline here to avoid re-exporting it.
    let ps_out = std::process::Command::new("/bin/ps")
        .args(["-axo", "pid=,ppid="])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&ps_out.stdout);
    let mut ppid_map: std::collections::HashMap<u32, u32> =
        std::collections::HashMap::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            if let (Ok(p), Ok(pp)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                ppid_map.insert(p, pp);
            }
        }
    }

    let mut cursor = pid;
    let mut steps = 0;
    while cursor > 1 && steps < 12 {
        let info = get_proc_info(cursor);
        let name = info.as_ref().map(|i| i.name.as_str()).unwrap_or("");
        if name == "tmux" || name.starts_with("tmux:") {
            return Some(cursor);
        }
        cursor = ppid_map.get(&cursor).copied().unwrap_or(0);
        steps += 1;
    }
    None
}

/// Run `tmux select-pane` + `select-window` targeting the pane whose `pane_tty`
/// matches the given /dev path. The pane TTY that tmux reports is the pty the
/// shell inside the pane runs on — same value we store on Session.tty.
fn try_focus_tmux_pane(tty: &str) -> Result<(), String> {
    // Query tmux for a (pane_id, pane_tty, window_id, session_id) list.
    let output = std::process::Command::new("/usr/bin/env")
        .args([
            "tmux",
            "list-panes",
            "-a",
            "-F",
            "#{pane_id}|#{pane_tty}|#{window_id}|#{session_id}",
        ])
        .output()
        .map_err(|e| format!("spawn tmux: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "tmux list-panes failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let listing = String::from_utf8_lossy(&output.stdout);
    for line in listing.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 4 && parts[1] == tty {
            let pane_id = parts[0];
            let window_id = parts[2];
            let session_id = parts[3];
            // Select the pane + its window + its session (best effort).
            let _ = std::process::Command::new("/usr/bin/env")
                .args(["tmux", "select-pane", "-t", pane_id])
                .status();
            let _ = std::process::Command::new("/usr/bin/env")
                .args(["tmux", "select-window", "-t", window_id])
                .status();
            let _ = std::process::Command::new("/usr/bin/env")
                .args(["tmux", "switch-client", "-t", session_id])
                .status();
            return Ok(());
        }
    }
    Err(format!("tmux: no pane with tty {}", tty))
}

/// Terminal.app: pick the tab whose tty matches.
fn try_focus_terminal_tab(tty: &str) -> Result<(), String> {
    let tty_escaped = escape_applescript(tty);
    let script = format!(
        r#"tell application id "com.apple.Terminal"
    activate
    repeat with w in windows
        repeat with t in tabs of w
            if tty of t is equal to "{}" then
                set selected of t to true
                set index of w to 1
                return "ok"
            end if
        end repeat
    end repeat
    return "activated-no-match"
end tell"#,
        tty_escaped
    );
    run_applescript(&script)
}

pub fn focus_terminal_for_pid(
    pid: u32,
    tty_hint: Option<&str>,
    app_state: &Arc<Mutex<AppState>>,
) {
    crate::app_log!("========== [focus] click pid={} tty_hint={:?} ==========", pid, tty_hint);

    // ---- 1) Session info (what our app state knows) ----
    let session_pwd: Option<String> = {
        let st = app_state.lock().unwrap();
        if let Some(s) = st.sessions.get(&pid) {
            crate::app_log!(
                "[focus] session: ui_state={:?} busy_type={:?} title={:?} pwd={:?} tty={:?} \
                 has_claude={} claude_pid={:?} fg_cmd={:?} last_seen={} busy_since={} service_since={}",
                s.ui_state, s.busy_type, s.title, s.pwd, s.tty,
                s.has_claude, s.claude_pid, s.fg_cmd,
                s.last_seen, s.busy_since, s.service_since
            );
            if s.pwd.is_empty() { None } else { Some(s.pwd.clone()) }
        } else {
            crate::app_log!("[focus] session: <not tracked in AppState>");
            None
        }
    };

    // ---- 2) Live OS process info (what libproc reports right now) ----
    match get_proc_info(pid) {
        Some(info) => {
            crate::app_log!(
                "[focus] proc:    name={:?} argv0={:?} ppid={} pgid={} tpgid={} tdev={} cwd={:?}",
                info.name, info.argv0, info.ppid, info.pgid, info.tpgid, info.tdev, info.cwd
            );
        }
        None => {
            crate::app_warn!("[focus] proc:    <libproc returned nothing — pid may be dead>");
        }
    }

    // ---- 3) tmux? Switch the pane inside tmux before touching the host app ----
    if let Some(tmux_pid) = shell_is_in_tmux(pid) {
        crate::app_log!("[focus] tmux detected: server pid={}", tmux_pid);
        if let Some(tty) = tty_hint {
            match try_focus_tmux_pane(tty) {
                Ok(()) => crate::app_log!("[focus] tmux pane selected for tty={}", tty),
                Err(e) => crate::app_warn!("[focus] tmux pane select failed: {}", e),
            }
        }
        // After switching panes, keep going so we also activate the host
        // terminal app that tmux is running under.
    }

    // ---- 4) Parent-chain walk to find owning terminal app ----
    let Some((app_id, bundle, open_name)) = find_terminal_app_for_pid(pid) else {
        crate::app_warn!(
            "[focus] no terminal app found for pid={} — walked parent chain and hit neither a .app bundle nor tmux/sshd",
            pid
        );
        return;
    };
    crate::app_log!(
        "[focus] detected: app_id={:?} bundle={:?} open_name={:?}",
        app_id, bundle, open_name
    );

    // ---- 5) Activate via Launch Services (always works, no perms needed) ----
    open_app(&open_name);

    // ---- 6) App-specific tab / window targeting ----
    let workspace = session_pwd.as_deref().map(|p| {
        p.rsplit('/').next().unwrap_or(p)
    });

    let result = match app_id.as_str() {
        "iTerm2" => tty_hint.map(|tty| {
            crate::app_log!("[focus] iTerm2 tab targeting for tty={}", tty);
            try_focus_iterm_tab(tty)
        }),
        "Terminal" => tty_hint.map(|tty| {
            crate::app_log!("[focus] Terminal.app tab targeting for tty={}", tty);
            try_focus_terminal_tab(tty)
        }),
        "VSCode" => workspace.map(|ws| {
            crate::app_log!("[focus] VS Code window match by title={:?}", ws);
            try_focus_electron_window(BUNDLE_VSCODE, ws)
        }),
        "Cursor" => workspace.map(|ws| {
            crate::app_log!("[focus] Cursor window match by title={:?}", ws);
            try_focus_electron_window(BUNDLE_CURSOR, ws)
        }),
        other => {
            crate::app_log!("[focus] no precise targeting for app_id={:?}, activation only", other);
            None
        }
    };
    match result {
        Some(Ok(())) => {
            crate::app_log!("[focus] precise targeting ok");
        }
        Some(Err(e)) => {
            crate::app_warn!(
                "[focus] precise targeting failed for {}: {}. \
                 If this is a permission issue: for iTerm/Terminal enable Automation, for VS Code/Cursor enable Accessibility (System Settings → Privacy & Security).",
                app_id, e
            );
        }
        None => {}
    }
}

// The `focus_terminal` Tauri command itself is defined in lib.rs (per the
// project convention that all #[tauri::command] functions live there) — it
// just delegates to `focus_terminal_for_pid` above.
