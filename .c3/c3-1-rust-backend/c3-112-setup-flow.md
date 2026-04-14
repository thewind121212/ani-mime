---
id: c3-112
c3-version: 4
c3-seal: 087c207e3905e2b75ef4236dccf52692fc8ae4f2accbda4bd6c8ad065f81ca06
title: Setup Flow
type: component
category: feature
parent: c3-1
goal: 'Run once on first launch: detect installed shells, ask the user which to configure via native AppleScript dialogs, inject terminal-mirror.{zsh,bash,fish} source lines into RC files, optionally install Claude Code hooks and register the MCP server, then write ~/.ani-mime/setup-done so the flow never runs again.'
summary: First-launch detection, shell RC file injection, Claude settings.json hook configuration, and native osascript dialog prompts
uses:
    - ref-setup-flow
    - rule-app-log-macros
---

## Goal

Run once on first launch: detect installed shells, ask the user which to configure via native AppleScript dialogs, inject terminal-mirror.{zsh,bash,fish} source lines into RC files, optionally install Claude Code hooks and register the MCP server, then write ~/.ani-mime/setup-done so the flow never runs again.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| OUT | Hook installation commands consumed by Terminal Mirror | c3-301 |
| OUT | settings.json entries consumed by Claude Hooks | c3-310 |
| OUT | server.mjs installation + .claude.json registration | c3-311 |
| OUT | Log lines | c3-103 |
## Container Connection

setup/mod.rs orchestrates setup/shell.rs, setup/claude.rs, and setup/mcp.rs. It writes the ~/.ani-mime/setup-done marker, reads and mutates the user's RC files (~/.zshrc, ~/.bashrc, ~/.config/fish/config.fish), and invokes osascript for every dialog. A preview_dialog Tauri command is also exposed so the Superpower Tool can exercise every dialog path without rerunning the full flow.
