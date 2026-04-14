mod claude;
mod mcp;
pub(crate) mod shell;

use std::path::PathBuf;
use tauri::Emitter;

use self::claude::{migrate_claude_hooks, setup_claude_hooks};
use self::mcp::{install_mcp_server, register_mcp_server};
use self::shell::{detect_shells, install_shell_hooks, ShellInfo};
use crate::platform;

/// Auto-setup on first launch:
/// 1. Detect installed shells (zsh, bash, fish)
/// 2. Ask user which shells to set up
/// 3. Optionally configure Claude Code hooks
pub fn auto_setup(resource_dir: PathBuf, app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        crate::app_log!("[setup] checking first-launch setup");

        let home = match dirs::home_dir() {
            Some(h) => h,
            None => {
                crate::app_error!("[setup] could not determine home directory");
                return;
            }
        };
        // Always run migrations for existing users
        migrate_claude_hooks(&home);

        // Always install/update MCP server files
        install_mcp_server(&resource_dir, &home);

        let setup_marker = home.join(".ani-mime/setup-done");

        // Already ran setup once — skip entirely
        if setup_marker.exists() {
            crate::app_log!("[setup] already initialized (marker found), skipping");
            return;
        }

        crate::app_log!("[setup] first launch detected, starting setup");

        let settings_path = home.join(".claude/settings.json");

        // Detect shells and determine what needs setup
        let shells = detect_shells(&home);
        let available: Vec<&ShellInfo> = shells.iter().filter(|s| s.is_installed()).collect();
        let needs_setup: Vec<&ShellInfo> = available
            .iter()
            .filter(|s| !s.is_configured())
            .copied()
            .collect();

        crate::app_log!("[setup] shells detected: {} installed, {} need setup",
            available.len(), needs_setup.len());
        for s in &available {
            crate::app_log!("[setup]   {} (installed={}, configured={})", s.name, s.is_installed(), s.is_configured());
        }

        let claude_done = {
            let content = std::fs::read_to_string(&settings_path).unwrap_or_default();
            content.contains("127.0.0.1:1234")
        };
        crate::app_log!("[setup] claude hooks already configured: {}", claude_done);

        // Nothing to do — skip silently
        if needs_setup.is_empty() && claude_done {
            crate::app_log!("[setup] everything already configured, skipping");
            return;
        }

        if let Err(e) = app_handle.emit("status-changed", "initializing") {
            crate::app_error!("[setup] failed to emit initializing status: {}", e);
        }

        // --- 1. Shell setup ---
        if !needs_setup.is_empty() {
            crate::app_log!("[setup] prompting user for shell selection");
            let chosen = shell::prompt_shell_selection(&needs_setup);
            crate::app_log!("[setup] user selected shells: {:?}", chosen);

            // User skipped all shells and none were previously configured — quit
            if chosen.is_empty() {
                let any_shell_configured = shells.iter().any(|s| s.is_configured());
                if !any_shell_configured {
                    crate::app_warn!("[setup] no shell selected and none configured, exiting");
                    platform::show_dialog(
                        "Ani-Mime",
                        "Ani-Mime requires at least one shell (zsh, bash, or fish) to be configured for terminal tracking.\n\nThe app will now close.\nRestart Ani-Mime when you're ready to set up.",
                        &["OK"],
                    );
                    std::process::exit(0);
                }
            }

            install_shell_hooks(&needs_setup, &chosen, &resource_dir);
        } else if available.is_empty() {
            crate::app_error!("[setup] no supported shells found");
            platform::show_dialog(
                "Ani-Mime",
                "No supported shell found (zsh, bash, or fish).\n\nPlease install one and restart the app.",
                &["OK"],
            );
            std::process::exit(0);
        }

        // --- 2. Claude Code hooks ---
        if !claude_done {
            let has_claude = shell::cmd_exists("claude");
            crate::app_log!("[setup] claude CLI installed: {}", has_claude);

            if has_claude {
                let answer = platform::show_dialog(
                    "Ani-Mime Setup",
                    "Ani-Mime also supports Claude Code! Your mascot can react in real-time when Claude is thinking or using tools.\n\nThis will add lightweight hooks to ~/.claude/settings.json.\n\nWould you like to enable it?",
                    &["Yes", "Skip"],
                );

                crate::app_log!("[setup] user chose '{}' for Claude hooks", answer);
                if answer == "Yes" {
                    setup_claude_hooks(&home);
                    register_mcp_server(&home);
                } else {
                    crate::app_log!("[setup] user skipped Claude Code hooks setup");
                }
            } else {
                crate::app_log!("[setup] claude CLI not installed, skipping hooks setup");
            }
        }

        // Mark setup as done
        if let Err(e) = std::fs::create_dir_all(home.join(".ani-mime")) {
            crate::app_error!("[setup] failed to create .ani-mime dir: {}", e);
        }
        if let Err(e) = std::fs::write(&setup_marker, "done") {
            crate::app_error!("[setup] failed to write setup marker: {}", e);
        }
        crate::app_log!("[setup] setup complete, marker written");

        platform::show_dialog(
            "Ani-Mime",
            "Setup complete!\n\nPlease open a new terminal tab or window for the tracking to take effect.\n\nThe app will now restart.",
            &["OK"],
        );

        // Restart the app via Tauri — lets the event loop clean up GTK before relaunching
        crate::app_log!("[setup] restarting app via tauri");
        app_handle.restart();
    });
}
