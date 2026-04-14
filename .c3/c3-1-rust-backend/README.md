---
id: c3-1
c3-version: 4
c3-seal: 39dcedb461738b662d8b734c04df81a65ee47a2e3e9c61a9e64821d987312411
title: Rust Backend
type: container
boundary: app
parent: c3-0
goal: Receive activity signals from shells and Claude Code, manage state, resolve status priority, discover peers, run auto-setup on first launch, expose log + updater + MCP machinery, and emit events to the frontend — all inside a single Tauri 2 Rust process.
summary: Tauri 2 Rust backend providing an HTTP server on port 1234, centralized AppState with session tracking, background watchdog, mDNS peer discovery, and first-launch setup flow
---

## Goal

Receive activity signals from shells and Claude Code, manage state, resolve status priority, discover peers, run auto-setup on first launch, expose log + updater + MCP machinery, and emit events to the frontend — all inside a single Tauri 2 Rust process.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-101 | HTTP Server | foundation | active | Accepts every external signal on 127.0.0.1:1234 |
| c3-102 | State Management | foundation | active | Single source of truth, priority resolution, emit-if-changed |
| c3-103 | Logger | foundation | active | File-backed logging facade shared by every module |
| c3-104 | Platform Adapter | foundation | active | Cross-platform facade with macOS (Cocoa/objc) and Linux (zenity/xdg-open/GTK) implementations |
| c3-110 | Watchdog | feature | active | Service to idle transition, session eviction, sleep mode |
| c3-111 | Peer Discovery | feature | active | mDNS discovery, visit protocol |
| c3-112 | Setup Flow | feature | active | First-launch shell and Claude Code integration |
| c3-113 | Updater | feature | active | GitHub release check with skipped-version preference |
## Responsibilities

- Own the process lifecycle: startup, plugin registration, tray menu, window creation, thread spawning
- Hold the single mutex-protected AppState and resolve UI status via a fixed priority (busy > service > idle > disconnected)
- Expose a minimal HTTP surface on 127.0.0.1:1234 for shell hooks, Claude Code hooks, peer visits, and the MCP server
- Run the watchdog, discovery, and updater threads on a schedule and log every noteworthy transition through the logger
- Route every OS-specific concern (AppKit/Cocoa on macOS, GTK/zenity/xdg-open on Linux) through the platform adapter facade so the rest of the backend stays platform-agnostic
- Emit Tauri events to the frontend whenever the resolved UI state or visitor/peer list changes
## Complexity Assessment

Concurrency risk is limited to a single mutex; threads must never hold the lock across I/O or emit calls. mDNS failures must be logged but must not crash the app. Port 1234 is hardcoded across Rust, shell scripts, and Claude Code hooks — changes to the port break every integration. macOS entitlements must stay aligned with post-build-sign.sh. Linux builds require GTK development packages (libwebkit2gtk-4.1-dev, libgtk-3-dev, libglib2.0-dev, libayatana-appindicator3-dev, librsvg2-dev) to link against webkit2gtk.
