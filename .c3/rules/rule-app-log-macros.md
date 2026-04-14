---
id: rule-app-log-macros
c3-seal: 79363c3c7efb21abff27d73ca5aa14ffad293374575d89c67cea7b9b789ce5cb
title: app-log-macros
type: rule
goal: Route every Rust log line through the `app_log!` / `app_warn!` / `app_error!` macros so tauri-plugin-log is the single writer and logger.rs can tail-read the same file for the Superpower Tool UI.
---

## Goal

Route every Rust log line through the `app_log!` / `app_warn!` / `app_error!` macros so tauri-plugin-log is the single writer and logger.rs can tail-read the same file for the Superpower Tool UI.

## Rule

In src-tauri/src/, backend code MUST emit log lines via the `app_log!`, `app_warn!`, or `app_error!` macros. Direct `println!`, `eprintln!`, `log::info!`, or `log::error!` calls are forbidden in application code.

## Golden Example

```rust
use crate::{app_log, app_warn, app_error};

fn handle_status(pid: u32, state: &str) {
    app_log!("status received: pid={} state={}", pid, state);
    if !is_valid_state(state) {
        app_warn!("ignoring unknown state: {}", state);
        return;
    }
}
```
## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| println!("session {} busy", pid) | app_log!("session {} busy", pid) | Bypasses tauri-plugin-log — the line never lands in ani-mime.log and the Superpower Tool can't see it |
| eprintln!("watchdog error: {}", e) | app_error!("watchdog error: {}", e) | Same as above, and loses the error level classification |
| log::info!("starting mdns") | app_log!("starting mdns") | The direct log:: macros work but break the project convention; reviewers expect the app_* prefix to locate all app-level logging |
## Scope

Applies to every `.rs` file under src-tauri/src/ that is part of the Ani-Mime backend. Does not apply to build scripts (build.rs), tests, or the mcp-server/ subtree (Node.js, uses stderr).

## Override

Third-party crate log noise is filtered in lib.rs (e.g. `mdns_sd` set to `Warn`) and is not covered by this rule. If a debugger trace truly needs stdout rather than the app log file, add a comment explaining why and use `eprintln!` — never `println!`.
