use tauri::Manager;

pub fn setup_main_window(app: &tauri::App) {
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => {
            crate::app_error!("[platform] main window not found");
            return;
        }
    };

    if let Err(e) = window.set_shadow(false) {
        crate::app_warn!("[platform] failed to disable shadow: {}", e);
    }
    if let Err(e) = window.set_visible_on_all_workspaces(true) {
        crate::app_warn!("[platform] failed to set visible on all workspaces: {}", e);
    }
    crate::app_log!("[platform] linux main window configured (relying on tauri transparent=true)");
}

/// Linux has no global dock concept; `skipTaskbar: true` in tauri.conf.json already
/// hides the window from the taskbar. Nothing to toggle at runtime.
pub fn set_dock_visibility(_app: &tauri::AppHandle, visible: bool) {
    crate::app_log!("[platform] linux dock visibility requested ({}) — no-op", if visible { "visible" } else { "hidden" });
}

pub fn open_path(path: &std::path::Path) {
    if let Err(e) = std::process::Command::new("xdg-open").arg(path).spawn() {
        crate::app_error!("[platform] xdg-open path failed: {}", e);
    }
}

pub fn open_url(url: &str) {
    if let Err(e) = std::process::Command::new("xdg-open").arg(url).spawn() {
        crate::app_error!("[platform] xdg-open url failed: {}", e);
    }
}

fn zenity_available() -> bool {
    std::process::Command::new("zenity")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Show a native Linux dialog via zenity. Returns the button text the user clicked.
///
/// Contract:
/// - `buttons.len() == 1`: info/OK dialog. Always returns `buttons[0]`.
/// - `buttons.len() == 2`: question with OK/Cancel labels. Returns `buttons[0]` on accept, `buttons[1]` on reject.
/// - `buttons.len() >= 3`: question with --extra-button entries. Clicking the default OK button returns `buttons[0]`;
///   clicking an extra button returns its label; dismissing returns `buttons[1]` as a sensible "cancel".
pub fn show_dialog(title: &str, message: &str, buttons: &[&str]) -> String {
    if buttons.is_empty() {
        crate::app_warn!("[platform] show_dialog called with no buttons");
        return String::new();
    }

    if !zenity_available() {
        crate::app_error!("[platform] zenity not installed — cannot show dialog '{}'. Install with 'sudo apt install zenity'", title);
        return String::new();
    }

    let mut cmd = std::process::Command::new("zenity");
    cmd.arg(format!("--title={}", title));

    match buttons.len() {
        1 => {
            cmd.arg("--info");
            cmd.arg(format!("--text={}", message));
            cmd.arg(format!("--ok-label={}", buttons[0]));
        }
        2 => {
            cmd.arg("--question");
            cmd.arg(format!("--text={}", message));
            cmd.arg(format!("--ok-label={}", buttons[0]));
            cmd.arg(format!("--cancel-label={}", buttons[1]));
        }
        _ => {
            cmd.arg("--question");
            cmd.arg(format!("--text={}", message));
            cmd.arg(format!("--ok-label={}", buttons[0]));
            cmd.arg(format!("--cancel-label={}", buttons[1]));
            for extra in &buttons[2..] {
                cmd.arg(format!("--extra-button={}", extra));
            }
        }
    }

    match cmd.output() {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let button = if o.status.success() {
                buttons[0].to_string()
            } else if !stdout.is_empty() && buttons[2..].iter().any(|b| *b == stdout.as_str()) {
                stdout
            } else {
                buttons[1].to_string()
            };
            crate::app_log!("[platform] dialog '{}': user pressed '{}'", title, button);
            button
        }
        Err(e) => {
            crate::app_error!("[platform] failed to run zenity for '{}': {}", title, e);
            String::new()
        }
    }
}

/// Show a multi-select list dialog via zenity --list --checklist.
pub fn show_choose_list(title: &str, message: &str, items: &[&str]) -> Vec<String> {
    if items.is_empty() {
        return vec![];
    }

    if !zenity_available() {
        crate::app_error!("[platform] zenity not installed — cannot show list for '{}'", title);
        return vec![];
    }

    let mut cmd = std::process::Command::new("zenity");
    cmd.arg("--list")
        .arg("--checklist")
        .arg(format!("--title={}", title))
        .arg(format!("--text={}", message))
        .arg("--column=Pick")
        .arg("--column=Item")
        .arg("--separator=|");

    for item in items {
        cmd.arg("FALSE").arg(*item);
    }

    match cmd.output() {
        Ok(o) => {
            let result = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if !o.status.success() || result.is_empty() {
                crate::app_log!("[platform] choose list '{}': user cancelled", title);
                return vec![];
            }
            let selected: Vec<String> = result.split('|').map(|s| s.to_string()).collect();
            crate::app_log!("[platform] choose list '{}': user selected {:?}", title, selected);
            selected
        }
        Err(e) => {
            crate::app_error!("[platform] failed to run zenity list for '{}': {}", title, e);
            vec![]
        }
    }
}

/// Linux has no single "local network privacy" panel. mDNS works without a prompt,
/// subject to firewall rules, so this is a no-op with a log line.
pub fn open_local_network_settings() {
    crate::app_log!("[platform] linux has no local network privacy panel — no-op");
}

/// Linux has no auto-install path yet; open the release page so the user can
/// download the AppImage or .deb manually.
pub fn run_update_command(release_url: &str) {
    crate::app_log!("[platform] opening release page for manual upgrade: {}", release_url);
    open_url(release_url);
}
