---
id: c3-103
c3-seal: 23952f8d8b2233153bf33dee92947caa592de60d4ede7758044f8b8555e62812
title: logger
type: component
category: foundation
parent: c3-1
goal: Provide a single logging facade for the backend — a file-backed log via tauri-plugin-log plus convenience macros (app_log!, app_warn!, app_error!) so every module emits structured, level-tagged messages through one path. Rotation is configured as KeepSome(3) with 1MB per file, and the reader seeks only the tail so the full file never lands in memory.
uses:
    - rule-app-log-macros
---

## Goal

Provide a single logging facade for the backend — a file-backed log via tauri-plugin-log plus convenience macros (app_log!, app_warn!, app_error!) so every module emits structured, level-tagged messages through one path. Rotation is configured as KeepSome(3) with 1MB per file, and the reader seeks only the tail so the full file never lands in memory.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Log calls from HTTP server | c3-101 |
| IN | Log calls from state layer | c3-102 |
| IN | Log calls from watchdog | c3-110 |
| IN | Log calls from peer discovery | c3-111 |
| IN | Log calls from setup flow | c3-112 |
| IN | Log calls from updater | c3-113 |
| OUT | Structured log lines read by Superpower Tool | c3-212 |
## Container Connection

logger.rs wraps the log crate; the macros route every app-level message through it so tauri-plugin-log writes to ani-mime.log inside the Tauri log directory. Third-party crate noise is filtered in lib.rs (e.g. mdns_sd set to Warn). The Superpower Tool reads the tail of that same file to render a live log viewer.
