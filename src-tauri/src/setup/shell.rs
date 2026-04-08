use std::path::{Path, PathBuf};

pub struct ShellInfo {
    pub name: &'static str,
    pub script_file: &'static str,
    pub rc_path: PathBuf,
    pub marker: &'static str,
}

impl ShellInfo {
    pub fn is_installed(&self) -> bool {
        cmd_exists(self.name)
    }

    pub fn is_configured(&self) -> bool {
        let content = std::fs::read_to_string(&self.rc_path).unwrap_or_default();
        content.contains(self.marker)
    }
}

pub fn cmd_exists(name: &str) -> bool {
    match std::process::Command::new("which").arg(name).output() {
        Ok(o) => {
            let exists = o.status.success();
            crate::app_log!("[setup] which {}: {}", name, if exists { "found" } else { "not found" });
            exists
        }
        Err(e) => {
            crate::app_error!("[setup] failed to run 'which {}': {}", name, e);
            false
        }
    }
}

pub fn detect_shells(home: &Path) -> Vec<ShellInfo> {
    vec![
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
    ]
}

/// Show a native macOS dialog. Returns the button text the user clicked.
pub fn macos_dialog(title: &str, message: &str, buttons: &[&str]) -> String {
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

    match std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
    {
        Ok(o) => {
            let result = String::from_utf8_lossy(&o.stdout).to_string();
            let button = result
                .split("button returned:")
                .nth(1)
                .unwrap_or("")
                .trim()
                .to_string();
            crate::app_log!("[setup] dialog '{}': user pressed '{}'", title, button);
            button
        }
        Err(e) => {
            crate::app_error!("[setup] failed to show dialog '{}': {}", title, e);
            String::new()
        }
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

    match std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
    {
        Ok(o) => {
            let result = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if result == "false" || result.is_empty() {
                crate::app_log!("[setup] choose list '{}': user cancelled", title);
                return vec![];
            }
            let selected: Vec<String> = result.split(", ").map(|s| s.to_string()).collect();
            crate::app_log!("[setup] choose list '{}': user selected {:?}", title, selected);
            selected
        }
        Err(e) => {
            crate::app_error!("[setup] failed to show choose list '{}': {}", title, e);
            vec![]
        }
    }
}

/// Prompt user to select which shells to configure. Returns list of shell names.
pub fn prompt_shell_selection(needs_setup: &[&ShellInfo]) -> Vec<String> {
    if needs_setup.len() == 1 {
        let shell = needs_setup[0];
        let answer = macos_dialog(
            "Ani-Mime Setup",
            &format!(
                "{} detected. Ani-Mime needs to add a hook to {} to track terminal activity.\n\nAllow setup?",
                shell.name,
                shell.rc_path.display()
            ),
            &["Yes", "Skip"],
        );
        if answer == "Yes" {
            vec![shell.name.to_string()]
        } else {
            vec![]
        }
    } else {
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
    }
}

/// Install hook lines into RC files for chosen shells.
pub fn install_shell_hooks(
    needs_setup: &[&ShellInfo],
    chosen: &[String],
    resource_dir: &Path,
) {
    for shell in needs_setup {
        if !chosen.iter().any(|c| c == shell.name) {
            crate::app_log!("[setup] skipping {} (not selected)", shell.name);
            continue;
        }
        let script_path = resource_dir.join(format!("script/{}", shell.script_file));
        if !script_path.exists() {
            crate::app_error!("[setup] script not found: {}", script_path.display());
            continue;
        }

        // Ensure parent directory exists (for fish)
        if let Some(parent) = shell.rc_path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                crate::app_error!("[setup] failed to create dir {}: {}", parent.display(), e);
            }
        }

        let line = format!(
            "\n# --- Ani-Mime Terminal Hook ---\nsource \"{}\"\n",
            script_path.display()
        );

        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&shell.rc_path)
            .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()))
        {
            Ok(_) => {
                crate::app_log!("[setup] injected {} into {}", shell.script_file, shell.rc_path.display());
            }
            Err(e) => {
                crate::app_error!("[setup] failed to write to {}: {}", shell.rc_path.display(), e);
            }
        }
    }
}
