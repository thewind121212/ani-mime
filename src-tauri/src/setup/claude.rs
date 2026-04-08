use std::path::Path;

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
