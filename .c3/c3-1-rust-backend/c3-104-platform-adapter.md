---
id: c3-104
c3-seal: 55ab02e7a6b50cea19fa14ea656da86bbfa54e5ac0260dfa08697f610d3c76ba
title: platform-adapter
type: component
category: foundation
parent: c3-1
goal: Isolate all OS-specific work behind a single cross-platform facade so the rest of the backend can request window setup, dock visibility, dialogs, URL/path opening, local-network permission, and update flows without touching FFI or shelling out. Dispatches to macos.rs (Cocoa/objc) or linux.rs (zenity/xdg-open) via cfg gates — callers never see the underlying OS.
uses:
    - rule-app-log-macros
    - rule-macos-cfg-gate
---

## Goal

Isolate all OS-specific work behind a single cross-platform facade so the rest of the backend can request window setup, dock visibility, dialogs, URL/path opening, local-network permission, and update flows without touching FFI or shelling out. Dispatches to macos.rs (Cocoa/objc) or linux.rs (zenity/xdg-open) via cfg gates — callers never see the underlying OS.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Window references and dock hide flag | c3-102 |
| IN | Dialog requests | c3-112 |
| IN | Dialog and update-launch requests | c3-113 |
| OUT | Log lines | c3-103 |
## Container Connection

`platform/mod.rs` declares `mod macos` under `#[cfg(target_os = "macos")]` and `mod linux` under `#[cfg(target_os = "linux")]`, then re-exports the same set of function names from whichever module is active (`setup_main_window`, `set_dock_visibility`, `open_path`, `open_url`, `show_dialog`, `show_choose_list`, `open_local_network_settings`, `restart_app`, `run_update_command`). Callers in `lib.rs`, `setup/mod.rs`, `setup/shell.rs`, and `updater.rs` only see `platform::fn_name` and never touch OS FFI directly.

`platform/macos.rs` uses the `cocoa` and `objc` crates to set NSWindow properties (clear background, ignore mouse events off the sprite), pin the window onto all Spaces, opt out of Sequoia window tiling, and toggle `ActivationPolicy::Accessory` when hiding the dock; dialogs go through `osascript`, paths/URLs through `open`, and updates through `brew upgrade --cask`. `platform/linux.rs` relies on Tauri's built-in `transparent: true` (rendered by webkit2gtk/WSLg), treats dock visibility as a no-op (taskbar is already skipped via `skipTaskbar: true`), routes dialogs through `zenity --question --info --list`, paths/URLs through `xdg-open`, and opens the GitHub release page for manual upgrade.
