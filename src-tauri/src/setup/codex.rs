use std::path::Path;

/// Configure OpenAI Codex CLI hooks so codex busy/idle reaches the dog.
///
/// Codex (>= 0.x with `codex_hooks` feature, default-enabled and stable) loads
/// lifecycle hooks from `~/.codex/hooks.json` — same shape as Claude Code's
/// `~/.claude/settings.json`. We register one ani-mime hook per relevant
/// event; each hook curls `/status?pid=$PPID&...` against the local HTTP
/// server. `$PPID` inside the hook shell is the codex binary itself, so the
/// session is created/refreshed under codex's PID — the same flow Claude Code
/// uses. proc_scan picks the codex PID up via `is_codex` and the UI promotes
/// the parent shell row to codex's busy/idle state.
///
/// Idempotent: detects a prior ani-mime hook by the `127.0.0.1:1234` marker
/// in any command and skips re-adding for that event.
pub fn setup_codex_hooks(home: &Path) {
    if !super::shell::cmd_exists("codex") {
        return;
    }

    crate::app_log!("[setup] configuring Codex CLI hooks");

    let codex_dir = home.join(".codex");
    let hooks_path = codex_dir.join("hooks.json");

    let mut settings: serde_json::Value = if hooks_path.exists() {
        match std::fs::read_to_string(&hooks_path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(json) => json,
                Err(e) => {
                    crate::app_error!("[setup] failed to parse codex hooks.json: {}", e);
                    return;
                }
            },
            Err(e) => {
                crate::app_error!("[setup] failed to read codex hooks.json: {}", e);
                return;
            }
        }
    } else {
        if let Err(e) = std::fs::create_dir_all(&codex_dir) {
            crate::app_error!("[setup] failed to create .codex dir: {}", e);
            return;
        }
        serde_json::json!({})
    };

    let hooks = settings
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert(serde_json::json!({}));

    let busy_cmd = "curl -s --max-time 1 \"http://127.0.0.1:1234/status?pid=$PPID&state=busy&type=task\" > /dev/null 2>&1 || true";
    let idle_cmd = "curl -s --max-time 1 \"http://127.0.0.1:1234/status?pid=$PPID&state=idle\" > /dev/null 2>&1 || true";
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

    fn remove_ani_hook(
        hooks_obj: &mut serde_json::Value,
        event: &str,
        marker: &str,
    ) {
        let Some(arr) = hooks_obj
            .as_object_mut()
            .and_then(|o| o.get_mut(event))
            .and_then(|v| v.as_array_mut())
        else {
            return;
        };
        for entry in arr.iter_mut() {
            if let Some(hks) = entry.get_mut("hooks").and_then(|h| h.as_array_mut()) {
                hks.retain(|h| {
                    h.get("command")
                        .and_then(|c| c.as_str())
                        .map_or(true, |c| !c.contains(marker))
                });
            }
        }
        // Drop any matcher entries whose hooks list is now empty.
        arr.retain(|entry| {
            entry
                .get("hooks")
                .and_then(|h| h.as_array())
                .map_or(true, |hks| !hks.is_empty())
        });
        if arr.is_empty() {
            if let Some(o) = hooks_obj.as_object_mut() {
                o.remove(event);
            }
        }
    }

    let add_hook = |hooks_obj: &mut serde_json::Value, event: &str, cmd: &str| {
        let arr = hooks_obj
            .as_object_mut()
            .unwrap()
            .entry(event)
            .or_insert(serde_json::json!([]));

        if has_ani_hook(arr) {
            return;
        }

        if let Some(entries) = arr.as_array_mut() {
            if entries.is_empty() {
                entries.push(serde_json::json!({
                    "matcher": "",
                    "hooks": [{ "type": "command", "command": cmd }]
                }));
            } else if let Some(first) = entries.first_mut() {
                if let Some(hks) = first["hooks"].as_array_mut() {
                    hks.push(serde_json::json!({
                        "type": "command",
                        "command": cmd
                    }));
                }
            }
        }
        crate::app_log!("[setup] added codex hook for {}", event);
    };

    add_hook(hooks, "PreToolUse", busy_cmd);
    add_hook(hooks, "UserPromptSubmit", busy_cmd);
    add_hook(hooks, "Stop", idle_cmd);
    add_hook(hooks, "SessionStart", idle_cmd);
    // Intentionally NOT hooking PermissionRequest: it fires on every exec /
    // tool approval — including ones auto-approved by trusted-project config.
    // Marking idle there caused the dog to drop out of busy while a long
    // background subprocess (e.g. `npm install`) was still running.

    // Strip any pre-existing ani-mime PermissionRequest hook that an older
    // ani-mime build may have written. Without this, users who installed the
    // earlier hook stay stuck on the broken behavior.
    remove_ani_hook(hooks, "PermissionRequest", ani_marker);

    match serde_json::to_string_pretty(&settings) {
        Ok(json_str) => {
            if let Err(e) = std::fs::write(&hooks_path, json_str) {
                crate::app_error!("[setup] failed to write codex hooks.json: {}", e);
            } else {
                crate::app_log!("[setup] codex hooks written to {}", hooks_path.display());
            }
        }
        Err(e) => {
            crate::app_error!("[setup] failed to serialize codex hooks: {}", e);
        }
    }
}
