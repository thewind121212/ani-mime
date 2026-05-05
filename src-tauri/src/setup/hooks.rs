use std::path::Path;

/// Marker token used to identify ani-mime-owned hook commands in
/// ~/.claude/settings.json — must be unique to commands we own.
pub const HOOK_MARKER: &str = "ani-mime-hook.mjs";

/// Canonical hook command Claude Code runs for every event we subscribe to.
/// Uses $HOME so the path expands inside the shell Claude Code spawns,
/// and `|| true` so a missing/broken script never blocks Claude.
pub const HOOK_COMMAND: &str =
    "node \"$HOME/.ani-mime/hooks/ani-mime-hook.mjs\" || true";

/// Copy the hook script to ~/.ani-mime/hooks/ so Claude Code can run it.
/// Called on every startup to keep the script up-to-date with the bundle.
pub fn install_hook_script(resource_dir: &Path, home: &Path) {
    let hooks_dir = home.join(".ani-mime/hooks");
    if let Err(e) = std::fs::create_dir_all(&hooks_dir) {
        crate::app_error!(
            "[hooks] failed to create {}: {}",
            hooks_dir.display(),
            e
        );
        return;
    }

    let source = resource_dir.join("script/ani-mime-hook.mjs");
    let dest = hooks_dir.join("ani-mime-hook.mjs");

    if !source.exists() {
        crate::app_warn!("[hooks] source not found: {}", source.display());
        return;
    }

    match std::fs::copy(&source, &dest) {
        Ok(_) => crate::app_log!("[hooks] installed script to {}", dest.display()),
        Err(e) => crate::app_error!("[hooks] failed to copy script: {}", e),
    }
}
