use std::path::Path;

use super::hooks::{HOOK_COMMAND, HOOK_MARKER};

/// Legacy marker for inline curl hooks installed by older ani-mime versions.
const LEGACY_MARKER: &str = "127.0.0.1:1234";

/// Every hook event ani-mime subscribes to. The same `HOOK_COMMAND` is
/// registered for all of them — the script reads the JSON payload from
/// stdin and decides what to do.
const HOOK_EVENTS: &[&str] = &[
    "PreToolUse",
    "UserPromptSubmit",
    "Stop",
    "StopFailure",
    "SessionStart",
    "SessionEnd",
    "Notification",
];

/// Returns true if `~/.claude/settings.json` already contains any
/// ani-mime-owned hook (legacy curl or new script).
pub fn claude_hooks_configured(home: &Path) -> bool {
    let path = home.join(".claude/settings.json");
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    content.contains(LEGACY_MARKER) || content.contains(HOOK_MARKER)
}

/// Run on every startup. Two responsibilities:
///   1. Rewrite legacy inline-curl hooks (containing 127.0.0.1:1234) to the
///      new node script command.
///   2. Add any of the seven hook events that aren't yet configured — so
///      existing users automatically pick up StopFailure and Notification
///      without re-running first-launch setup.
pub fn migrate_claude_hooks(home: &Path) {
    let settings_path = home.join(".claude/settings.json");
    if !settings_path.exists() {
        return;
    }

    let content = match std::fs::read_to_string(&settings_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let has_legacy = content.contains(LEGACY_MARKER);
    let has_new = content.contains(HOOK_MARKER);

    // User never set up claude hooks — nothing to migrate.
    if !has_legacy && !has_new {
        return;
    }

    let mut settings: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return,
    };

    let mut migrations: Vec<String> = Vec::new();
    let mut patched = false;

    // --- Step 1: rewrite legacy curl commands to the new script command ---
    if has_legacy {
        if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
            for (_event, entries) in hooks.iter_mut() {
                let Some(entries) = entries.as_array_mut() else { continue };
                for entry in entries.iter_mut() {
                    let Some(hks) = entry.get_mut("hooks").and_then(|h| h.as_array_mut()) else {
                        continue;
                    };
                    for hook in hks.iter_mut() {
                        let Some(cmd) = hook
                            .get_mut("command")
                            .and_then(|c| c.as_str().map(String::from))
                        else {
                            continue;
                        };
                        if cmd.contains(LEGACY_MARKER) && !cmd.contains(HOOK_MARKER) {
                            hook["command"] = serde_json::Value::String(HOOK_COMMAND.to_string());
                            patched = true;
                        }
                    }
                }
            }
        }
        if patched {
            migrations.push("legacy curl → node script".into());
        }
    }

    // --- Step 2: dedupe ani-mime hooks within each entry ---
    if let Some(hooks) = settings.get_mut("hooks").and_then(|h| h.as_object_mut()) {
        for (_event, entries) in hooks.iter_mut() {
            let Some(entries) = entries.as_array_mut() else { continue };
            for entry in entries.iter_mut() {
                let Some(hks) = entry.get_mut("hooks").and_then(|h| h.as_array_mut()) else {
                    continue;
                };
                let before = hks.len();
                let mut seen_ours = false;
                hks.retain(|h| {
                    let cmd = h["command"].as_str().unwrap_or("");
                    let is_ours = cmd.contains(HOOK_MARKER);
                    if is_ours {
                        if seen_ours {
                            return false;
                        }
                        seen_ours = true;
                    }
                    true
                });
                if hks.len() != before {
                    patched = true;
                }
            }
        }
    }

    // --- Step 3: add any missing events from HOOK_EVENTS ---
    let added = ensure_hook_events(&mut settings);
    if !added.is_empty() {
        migrations.push(format!("added events: {}", added.join(", ")));
        patched = true;
    }

    if !patched {
        return;
    }

    if let Ok(json_str) = serde_json::to_string_pretty(&settings) {
        if std::fs::write(&settings_path, json_str).is_ok() {
            crate::app_log!("[setup] migrated claude hooks: {}", migrations.join("; "));
        }
    }
}

/// First-launch hook setup. Adds every event in `HOOK_EVENTS` to
/// ~/.claude/settings.json with the canonical `HOOK_COMMAND`.
pub fn setup_claude_hooks(home: &Path) {
    crate::app_log!("[setup] configuring Claude Code hooks");

    let claude_dir = home.join(".claude");
    let settings_path = claude_dir.join("settings.json");

    let mut settings: serde_json::Value = if settings_path.exists() {
        match std::fs::read_to_string(&settings_path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
                crate::app_error!("[setup] failed to parse claude settings: {}", e);
                serde_json::json!({})
            }),
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

    let added = ensure_hook_events(&mut settings);
    if added.is_empty() {
        crate::app_log!("[setup] all claude hooks already configured");
    } else {
        crate::app_log!("[setup] added claude hooks for: {}", added.join(", "));
    }

    match serde_json::to_string_pretty(&settings) {
        Ok(json_str) => {
            if let Err(e) = std::fs::write(&settings_path, json_str) {
                crate::app_error!("[setup] failed to write claude settings: {}", e);
            } else {
                crate::app_log!(
                    "[setup] claude hooks written to {}",
                    settings_path.display()
                );
            }
        }
        Err(e) => crate::app_error!("[setup] failed to serialize claude settings: {}", e),
    }
}

/// Adds an ani-mime hook entry for every event in `HOOK_EVENTS` that
/// doesn't already have one. Returns the list of events that were added.
fn ensure_hook_events(settings: &mut serde_json::Value) -> Vec<String> {
    let hooks = settings
        .as_object_mut()
        .expect("settings must be a JSON object")
        .entry("hooks")
        .or_insert(serde_json::json!({}));

    let mut added = Vec::new();
    for event in HOOK_EVENTS {
        let arr = hooks
            .as_object_mut()
            .unwrap()
            .entry((*event).to_string())
            .or_insert(serde_json::json!([]));

        if entry_array_has_marker(arr, HOOK_MARKER) {
            continue;
        }

        if let Some(entries) = arr.as_array_mut() {
            if entries.is_empty() {
                entries.push(serde_json::json!({
                    "matcher": "",
                    "hooks": [{ "type": "command", "command": HOOK_COMMAND }]
                }));
            } else if let Some(first) = entries.first_mut() {
                if let Some(hks) = first["hooks"].as_array_mut() {
                    hks.push(serde_json::json!({
                        "type": "command",
                        "command": HOOK_COMMAND
                    }));
                }
            }
            added.push((*event).to_string());
        }
    }
    added
}

fn entry_array_has_marker(arr: &serde_json::Value, marker: &str) -> bool {
    arr.as_array().map_or(false, |entries| {
        entries.iter().any(|entry| {
            entry["hooks"].as_array().map_or(false, |hks| {
                hks.iter()
                    .any(|h| h["command"].as_str().map_or(false, |c| c.contains(marker)))
            })
        })
    })
}
