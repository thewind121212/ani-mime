use std::path::Path;

/// Patch existing ani-mime hooks for compatibility with newer behaviors.
/// Safe to run on every startup — only modifies hooks that actually need fixing.
///
/// Migrations applied (idempotently):
///   1. Add `|| true` so a missing app doesn't error in claude
///   2. Replace `pid=0` (shared session) with `pid=$PPID` (per-claude session)
///      and switch single quotes to double so the shell expands $PPID
pub fn migrate_claude_hooks(home: &Path) {
    let settings_path = home.join(".claude/settings.json");
    if !settings_path.exists() {
        return;
    }

    let content = match std::fs::read_to_string(&settings_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    if !content.contains("127.0.0.1:1234") {
        return;
    }

    let mut settings: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return,
    };

    let mut patched = false;
    let mut migrations_applied: Vec<&str> = Vec::new();

    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for (_event, entries) in hooks.iter_mut() {
            if let Some(entries) = entries.as_array_mut() {
                for entry in entries.iter_mut() {
                    if let Some(hks) = entry.get_mut("hooks").and_then(|h| h.as_array_mut()) {
                        for hook in hks.iter_mut() {
                            let Some(cmd) = hook
                                .get_mut("command")
                                .and_then(|c| c.as_str().map(String::from))
                            else {
                                continue;
                            };
                            if !cmd.contains("127.0.0.1:1234") {
                                continue;
                            }

                            let mut new_cmd = cmd.clone();

                            // Migration 2: pid=0 → pid=$PPID. Replace the
                            // single-quoted URL wrapping (which prevents $PPID
                            // expansion) with double quotes.
                            if new_cmd.contains("pid=0") {
                                new_cmd = new_cmd.replace("pid=0", "pid=$PPID");
                                // Convert any single-quoted URL into a double-quoted one
                                // so the shell actually expands $PPID at runtime.
                                if let Some(start) = new_cmd.find("'http://127.0.0.1:1234") {
                                    if let Some(end_rel) = new_cmd[start + 1..].find('\'') {
                                        let end = start + 1 + end_rel;
                                        new_cmd.replace_range(start..start + 1, "\"");
                                        new_cmd.replace_range(end..end + 1, "\"");
                                    }
                                }
                                migrations_applied.push("pid=0 → pid=$PPID");
                            }

                            // Migration 1: append `|| true` if missing.
                            if !new_cmd.contains("|| true") {
                                new_cmd = format!("{} || true", new_cmd);
                                migrations_applied.push("added || true");
                            }

                            if new_cmd != cmd {
                                hook["command"] = serde_json::Value::String(new_cmd);
                                patched = true;
                            }
                        }
                    }
                }
            }
        }
    }

    if patched {
        if let Ok(json_str) = serde_json::to_string_pretty(&settings) {
            if std::fs::write(&settings_path, json_str).is_ok() {
                migrations_applied.sort();
                migrations_applied.dedup();
                crate::app_log!(
                    "[setup] migrated claude hooks: {}",
                    migrations_applied.join(", ")
                );
            }
        }
    }
}

pub fn setup_claude_hooks(home: &Path) {
    crate::app_log!("[setup] configuring Claude Code hooks");

    let claude_dir = home.join(".claude");
    let settings_path = claude_dir.join("settings.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        match std::fs::read_to_string(&settings_path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(json) => {
                    crate::app_log!("[setup] loaded existing claude settings");
                    json
                }
                Err(e) => {
                    crate::app_error!("[setup] failed to parse claude settings: {}", e);
                    serde_json::json!({})
                }
            },
            Err(e) => {
                crate::app_error!("[setup] failed to read claude settings: {}", e);
                serde_json::json!({})
            }
        }
    } else {
        crate::app_log!("[setup] creating new claude settings");
        if let Err(e) = std::fs::create_dir_all(&claude_dir) {
            crate::app_error!("[setup] failed to create .claude dir: {}", e);
        }
        serde_json::json!({})
    };

    let hooks = settings
        .as_object_mut()
        .unwrap()
        .entry("hooks")
        .or_insert(serde_json::json!({}));

    // Use $PPID instead of a hardcoded 0: each running `claude` binary becomes
    // its own session (so two concurrent Claude tabs don't share the same dot).
    // $PPID inside the hook subshell is the parent process — i.e. the claude
    // binary that spawned the hook.
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

    let add_hook = |hooks_obj: &mut serde_json::Value, event: &str, cmd: &str| {
        let arr = hooks_obj
            .as_object_mut()
            .unwrap()
            .entry(event)
            .or_insert(serde_json::json!([]));

        if has_ani_hook(arr) {
            crate::app_log!("[setup] claude hook for {} already exists", event);
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
        crate::app_log!("[setup] added claude hook for {}", event);
    };

    add_hook(hooks, "PreToolUse", busy_cmd);
    add_hook(hooks, "UserPromptSubmit", busy_cmd);
    add_hook(hooks, "Stop", idle_cmd);
    add_hook(hooks, "SessionStart", idle_cmd);
    add_hook(hooks, "SessionEnd", idle_cmd);

    match serde_json::to_string_pretty(&settings) {
        Ok(json_str) => {
            if let Err(e) = std::fs::write(&settings_path, json_str) {
                crate::app_error!("[setup] failed to write claude settings: {}", e);
            } else {
                crate::app_log!("[setup] claude hooks written to {}", settings_path.display());
            }
        }
        Err(e) => {
            crate::app_error!("[setup] failed to serialize claude settings: {}", e);
        }
    }
}
