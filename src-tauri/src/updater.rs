use tauri::{Emitter, Manager};

const GITHUB_RELEASES_URL: &str =
    "https://api.github.com/repos/vietnguyenhoangw/ani-mime/releases/latest";

/// Check GitHub for a newer release and show a native dialog if one exists.
/// Runs in a background thread, non-blocking.
pub fn check_for_updates(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Small delay so the app window appears first
        std::thread::sleep(std::time::Duration::from_secs(3));

        let current = env!("CARGO_PKG_VERSION");
        crate::app_log!("[updater] checking for updates (current: v{})", current);

        let latest = match fetch_latest_version() {
            Some(v) => v,
            None => {
                crate::app_log!("[updater] could not fetch latest version, skipping");
                return;
            }
        };

        crate::app_log!("[updater] latest release: v{}", latest);

        if !is_newer(&latest, current) {
            crate::app_log!("[updater] already up to date");
            return;
        }

        // Check if user previously skipped this version
        let app_data_dir = match app_handle.path().app_data_dir() {
            Ok(d) => d,
            Err(_) => return,
        };
        let store_path = app_data_dir.join("settings.json");
        if let Ok(content) = std::fs::read_to_string(&store_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(skipped) = json.get("skippedVersion").and_then(|v| v.as_str()) {
                    if skipped == latest {
                        crate::app_log!("[updater] v{} was skipped by user", latest);
                        return;
                    }
                }
            }
        }

        // Emit update-available event to frontend
        let _ = app_handle.emit("update-available", serde_json::json!({
            "latest": latest,
            "current": current,
        }));
        crate::app_log!("[updater] emitted update-available event");
    });
}

fn fetch_latest_version() -> Option<String> {
    let mut response = ureq::get(GITHUB_RELEASES_URL)
        .header("User-Agent", "ani-mime-updater")
        .call()
        .ok()?;

    let json: serde_json::Value = response.body_mut().read_json().ok()?;
    let tag = json.get("tag_name")?.as_str()?;

    // Strip leading 'v' if present
    Some(tag.trim_start_matches('v').to_string())
}

fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.')
            .filter_map(|s| s.parse().ok())
            .collect()
    };
    let l = parse(latest);
    let c = parse(current);
    l > c
}

#[tauri::command]
pub fn update_now() {
    crate::app_log!("[updater] user chose: Update");
    let script = r#"tell application "Terminal"
    activate
    do script "brew upgrade --cask ani-mime"
end tell"#;
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .spawn();
}

#[tauri::command]
pub fn skip_version(version: String, app_handle: tauri::AppHandle) {
    crate::app_log!("[updater] user chose: Skip v{}", version);
    if let Ok(app_data_dir) = app_handle.path().app_data_dir() {
        save_skipped_version(&app_data_dir.join("settings.json"), &version);
    }
}

fn save_skipped_version(store_path: &std::path::Path, version: &str) {
    let mut json: serde_json::Value = if store_path.exists() {
        std::fs::read_to_string(store_path)
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    json["skippedVersion"] = serde_json::Value::String(version.to_string());

    if let Ok(s) = serde_json::to_string_pretty(&json) {
        let _ = std::fs::write(store_path, s);
        crate::app_log!("[updater] saved skipped version: v{}", version);
    }
}
