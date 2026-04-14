---
id: ref-setup-flow
c3-seal: 9defbd2dfb2f1270a9df96ba2e168814e91d7fac7ac2bb0fd39016c53fc1f61f
title: setup-flow
type: ref
goal: Get a brand-new install talking to at least one shell and, optionally, Claude Code without asking the user to run any command after launching the app.
---

## Goal

Get a brand-new install talking to at least one shell and, optionally, Claude Code without asking the user to run any command after launching the app.

## Choice

First-launch auto-setup orchestrated in Rust. It detects installed shells from /etc/shells and the user's environment, asks which to configure via native AppleScript dialogs, appends a single source line to each RC file referencing the bundled terminal-mirror script, optionally installs Claude Code hooks in ~/.claude/settings.json and registers the MCP server in ~/.claude.json. Completion is marked by creating ~/.ani-mime/setup-done.

## Why

A macOS consumer app cannot count on users editing their shell config, and asking them to paste commands breaks the "it just works" promise. Running the setup inside the Rust process lets us use Tauri's process permissions to write RC files and show native dialogs via osascript — no GUI framework, no extra binary. The completion marker is a file rather than a setting so users can re-run the flow by deleting one path.

## How

- Orchestrator lives in setup/mod.rs; shell detection in setup/shell.rs; Claude hooks in setup/claude.rs; MCP install in setup/mcp.rs
- Shell detection reads ${SHELL}, /etc/shells, and actual on-disk binaries; the RC file is chosen per shell (~/.zshrc, ~/.bashrc, ~/.config/fish/config.fish)
- A block fenced by `# --- Ani-Mime Terminal Hook ---` is idempotently injected so re-runs never duplicate
- The MCP server file is copied to ~/.ani-mime/mcp/server.mjs on every launch (not only first run) so bundled updates propagate
- Dialogs go through macOS osascript — avoids taking a dialog-crate dependency and gives the native look
- `preview_dialog` Tauri command exists for the Superpower Tool to exercise dialog paths in isolation
