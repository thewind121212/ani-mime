# Changelog

## [0.2.17] - 2026-04-03

### Fixed
- Setup dialogs only show on first launch — no more repeated prompts on every app open
- App now restarts automatically after first-time setup completes

### Added
- "Setup complete" dialog telling users to open a new terminal tab for tracking to take effect
- `~/.ani-mime/setup-done` marker file to track initialization state (delete to re-run setup)

## [0.2.14] - 2026-04-01

### Added
- Multi-shell support: zsh, bash, and fish
- Smart shell detection with multi-select dialog when 2+ shells are installed
- App quits if user skips setup with no shell configured
- Native macOS setup dialogs (osascript) for first-time configuration
- Claude Code hooks setup dialog (Yes/Skip for both installed and not installed)
- Auto-setup on first launch: injects hooks into shell RC files and Claude Code settings

## [0.2.11] - 2026-04-01

### Changed
- New pixel art cat app icon

## [0.2.0] - 2026-04-01

### Added
- Animated Rottweiler pixel art sprites for each status
  - Sniffing (busy/working)
  - Barking (service/dev server)
  - Sitting (idle/free)
  - Sleeping (disconnected/sleep)
  - Idle (searching/initializing)
- Auto-freeze idle and sleep animations after 10 seconds
- "Initializing..." status with orange pulse for first-time setup
- Disable window shadow
- Show on all macOS workspaces/Spaces
- Bundle shell scripts as Tauri resources

## [0.1.0] - 2026-04-01

### Added
- Initial release
- Floating status pill UI (always-on-top, transparent, draggable)
- Manual Tagging + Heartbeat architecture (no process tree scanning)
- Zsh terminal tracking via preexec/precmd hooks
- Claude Code integration via hooks (PreToolUse, Stop, etc.)
- Multi-session support with priority resolution (busy > service > idle)
- Watchdog for stale session cleanup (40s heartbeat timeout)
- Service command auto-detection (start, dev, serve, watch, metro, etc.)
- Claude alias detection via `whence` (works with any alias)
- GitHub Actions CI for macOS builds (arm64 + x86_64)
- Homebrew Cask distribution
- Debug endpoint (`/debug`) for session inspection
