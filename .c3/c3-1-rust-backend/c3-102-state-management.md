---
id: c3-102
c3-version: 4
c3-seal: 1ddda7a7cc338f2a802495a0df22c92d848b3b86e94851e3600a18c5479867b7
title: State Management
type: component
category: foundation
parent: c3-1
goal: Hold the backend's single source of truth — terminal sessions, peers, visitors, discovery metadata, and the resolved UI state — behind one `Arc<Mutex<AppState>>` and resolve the winning status using a fixed priority (`busy > service > idle > disconnected`).
summary: Arc<Mutex<AppState>> holding session map (by PID), peer registry, visitor list, and current UI state with priority-based resolution and change-driven event emission
uses:
    - ref-status-priority
    - ref-tauri-events
    - rule-app-log-macros
    - rule-pid-zero-reserved
---

## Goal

Hold the backend's single source of truth — terminal sessions, peers, visitors, discovery metadata, and the resolved UI state — behind one `Arc<Mutex<AppState>>` and resolve the winning status using a fixed priority (`busy > service > idle > disconnected`).

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Mutations from HTTP routes | c3-101 |
| IN | Mutations from watchdog sweeps | c3-110 |
| IN | Peer add/remove events | c3-111 |
| IN | Setup completion flags | c3-112 |
| OUT | resolve_ui_state() + emit_if_changed() → status-changed | c3-201 |
| OUT | Log lines | c3-103 |
## Container Connection

`state.rs` defines `AppState`, `Session`, `PeerInfo`, `VisitingDog`, and the pure `resolve_ui_state()` function. The `Arc<Mutex<AppState>>` is constructed in `lib.rs` and cloned to every long-running thread.
