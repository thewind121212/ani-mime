---
id: c3-110
c3-version: 4
c3-seal: b4cf2fb9cfd5f778f24b3e8f6700c5ef4e8992873ab279cb9d8d68731f973300
title: Watchdog
type: component
category: feature
parent: c3-1
goal: Run the periodic background sweep that transitions `service` → `idle` after 2 seconds, evicts sessions idle longer than 40 seconds, expires overdue visitors, and enters sleep mode after 120 seconds of idle so the UI stops re-emitting.
summary: Background thread running every 2 seconds that handles service→idle transitions (2s display), stale session removal (40s timeout), and idle→sleep transitions (120s)
uses:
    - ref-status-priority
    - ref-tauri-events
    - rule-app-log-macros
    - rule-pid-zero-reserved
---

## Goal

Run the periodic background sweep that transitions `service` → `idle` after 2 seconds, evicts sessions idle longer than 40 seconds, expires overdue visitors, and enters sleep mode after 120 seconds of idle so the UI stops re-emitting.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | AppState handle | c3-102 |
| OUT | Mutated sessions / visitors / sleeping flag | c3-102 |
| OUT | status-changed, visitor-left events | c3-201 |
| OUT | Log lines | c3-103 |
## Container Connection

Spawned once from `lib.rs` as a dedicated `std::thread`. Wakes every 2 seconds, holds the `AppState` mutex only for the minimum scope, and never performs I/O under the lock.
