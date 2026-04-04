# Backend Architecture

The Rust backend runs inside Tauri and manages all state, HTTP communication, and platform integration.

## Module Overview

```
src-tauri/src/
├── main.rs          # Binary entry (calls lib::run)
├── lib.rs           # Tauri builder, plugin registration, window setup
├── state.rs         # AppState, Session, state resolution
├── server.rs        # HTTP server on :1234
├── watchdog.rs      # Background thread: cleanup + transitions
├── helpers.rs       # Shared utilities
├── setup/
│   ├── mod.rs       # auto_setup() orchestrator
│   ├── shell.rs     # Shell detection + RC injection
│   └── claude.rs    # Claude Code hooks configuration
└── platform/
    └── macos.rs     # Cocoa/objc window transparency
```

## Modules

### `state.rs` — State Management

Core data structures shared across all modules.

```rust
// Per-shell session
struct Session {
    busy_type: String,     // "task", "service", or ""
    ui_state: String,      // "busy", "service", "idle"
    last_seen: u64,        // Unix timestamp
    service_since: u64,    // When service started (0 = not in service)
}

// Global app state (behind Arc<Mutex<>>)
struct AppState {
    sessions: HashMap<u32, Session>,  // PID → Session
    current_ui: String,               // What frontend currently shows
}
```

**State resolution** picks one winner across all sessions:
- Priority: `busy > service > idle > disconnected`
- If any session is busy, the whole app shows busy
- Only shows disconnected when zero sessions remain

**`emit_if_changed()`** compares new resolved state vs `current_ui` and only emits a Tauri event when it actually changes.

### `server.rs` — HTTP Server

Runs `tiny_http` on `127.0.0.1:1234` in a dedicated OS thread.

Routes:
| Route | Action |
|-------|--------|
| `GET /status?pid=X&state=busy&type=task` | Mark session as busy (task) |
| `GET /status?pid=X&state=busy&type=service` | Mark session as service |
| `GET /status?pid=X&state=idle` | Mark session as idle |
| `GET /heartbeat?pid=X` | Refresh session's `last_seen` |
| `GET /debug` | Dump all sessions (debug only) |

All responses return `200 OK` with CORS header.

**Heartbeat note:** Heartbeats only refresh `last_seen` for non-busy sessions. Busy sessions are left to timeout naturally — this prevents a stuck heartbeat from keeping a dead command "alive."

### `watchdog.rs` — Background Monitor

Runs every 2 seconds on its own OS thread.

Three responsibilities:
1. **Service auto-transition**: Sessions in "service" for 2+ seconds → transition to "idle"
2. **Stale session removal**: Sessions with no heartbeat for 40+ seconds → remove
3. **Claude Code session (pid=0)**: Kept alive as long as any real shell session exists. Removed when all shells are gone.

### `helpers.rs` — Shared Utilities

- `now_secs()` — Current Unix timestamp in seconds
- `get_query_param(url, key)` — Parse query string parameters from URL

### `setup/` — First-Launch Setup

See [Setup Flow](./setup-flow.md) for the full flow.

- **`mod.rs`**: `auto_setup()` — checks marker file, orchestrates shell + Claude setup, restarts app
- **`shell.rs`**: Detects installed shells, shows native dialogs, injects hook lines into RC files
- **`claude.rs`**: Reads/writes `~/.claude/settings.json` to add ani-mime hooks

### `platform/macos.rs` — macOS Window Setup

Uses `cocoa` and `objc` crates to:
- Set window as transparent (`setOpaque_(NO)`, `clearColor`)
- Disable window shadow
- Disable WebView background (`drawsBackground = NO`)
- Make window visible on all workspaces/desktops

### `lib.rs` — App Entry Point

The `run()` function:
1. Initialize Tauri with plugins
2. Apply macOS window customization
3. Kick off `auto_setup()` in background thread
4. Create shared `AppState`
5. Start HTTP server thread
6. Start watchdog thread

## Threading Model

```
Main Thread (Tauri)
  ├── HTTP Server Thread     (blocking loop: tiny_http::Server::incoming_requests)
  ├── Watchdog Thread        (sleep 2s → check → repeat)
  └── Setup Thread           (one-shot, only on first launch)
```

All threads share `Arc<Mutex<AppState>>`. Lock contention is minimal — operations are fast (HashMap lookups/inserts).

## Adding New Features

### New HTTP endpoint
1. Add route match in `server.rs`
2. If it modifies state, lock `AppState` and call `emit_if_changed()`

### New UI state
1. Add variant to state resolution in `state.rs`
2. Add priority in `resolve_ui_state()`
3. Add frontend handling (see [Frontend](./frontend.md))

### New platform support
1. Add new file under `platform/` (e.g., `windows.rs`)
2. Use `#[cfg(target_os = "...")]` to conditionally compile
3. Call from `lib.rs` setup
