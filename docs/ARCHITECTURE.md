# Ani-Mime Architecture

A floating macOS desktop mascot that reacts to your terminal and Claude Code activity in real-time.

## System Overview

```
┌──────────────┐     HTTP :1234     ┌───────────────────────┐    Tauri Events    ┌────────────┐
│  Shell Hooks │ ──────────────────> │     Rust Backend      │ ─────────────────> │   React    │
│  (zsh/bash/  │  /status            │                       │  "status-changed"  │  Frontend  │
│   fish)      │  /heartbeat         │  ┌─────────────────┐  │                    │            │
└──────────────┘                     │  │  HTTP Server     │  │                    │ ┌────────┐ │
                                     │  │  (tiny_http)     │  │                    │ │Mascot  │ │
┌──────────────┐     HTTP :1234      │  └────────┬────────┘  │                    │ │Sprite  │ │
│ Claude Code  │ ──────────────────> │           │           │                    │ └────────┘ │
│   Hooks      │  /status            │  ┌────────▼────────┐  │                    │ ┌────────┐ │
└──────────────┘                     │  │  App State      │  │                    │ │Status  │ │
                                     │  │  (sessions map) │  │                    │ │Pill    │ │
┌──────────────┐  stdio   ┌───────┐ │  └────────┬────────┘  │                    │ └────────┘ │
│ Claude Code  │ <──────> │  MCP  │ │           │           │                    │ ┌────────┐ │
│ MCP Client   │          │Server │──> /mcp/*   │           │                    │ │Speech  │ │
└──────────────┘          └───────┘ │           │           │                    │ │Bubble  │ │
                                     │  ┌────────▼────────┐  │                    │ └────────┘ │
┌──────────────┐     mDNS           │  │  Watchdog       │  │                    │ ┌────────┐ │
│  Peer        │ <─────────────────> │  │  (every 2s)     │  │                    │ │Visitor │ │
│  Discovery   │  _ani-mime._tcp     │  └─────────────────┘  │                    │ │Dogs    │ │
└──────────────┘                     └───────────────────────┘                    └────────────┘
```

## Key Design Decisions

1. **HTTP over IPC** — Shell hooks use `curl` to talk to the backend. Simpler than Unix sockets, works across all shells.
2. **Heartbeat drives state, libproc enriches** — Shells drive `ui_state` transitions via hook pings (event-driven, instant). A separate `proc_scan` thread polls `libproc` every 2s to auto-discover sessions that don't have hooks installed, fill `pwd`/`tty`/`fg_cmd` authoritatively from the OS, detect `claude` descendants, and drop zombie sessions immediately. Hooks stay authoritative for state; scanning stays authoritative for discovery. See `src-tauri/src/proc_scan.rs`.
3. **Priority-based state resolution** — Multiple terminals resolve to one UI state: `busy > service > idle > disconnected`.
4. **Service auto-transition** — Dev servers flash "service" (blue) for 2s then become "idle". Prevents permanently-blue pill.
5. **mDNS peer discovery** — LAN-local Bonjour for zero-config multi-machine awareness.
6. **MCP sidecar pattern** — A zero-dependency Node.js MCP server bridges Claude Code to the HTTP server via stdio. Claude Code calls MCP tools, which translate to HTTP requests on `:1234`.
7. **Click-to-focus via parent-chain walk** — The `focus_terminal` command walks a shell's PID up through its parents using `pidpath()` + a `ps`-based ppid fallback (needed because libproc refuses BSDInfo for root-owned `login`). Once a `.app` bundle is found in the path, we activate via `open -a` and optionally AppleScript the specific tab. See `src-tauri/src/focus.rs` and the support matrix in `README.md`.

## Request Lifecycle

End-to-end flow from shell command to pixel on screen:

```
1. User runs command     $ yarn dev
                             │
2. Shell preexec fires       ▼
                         _tm_classify("yarn dev") → "service"
                         curl /status?pid=12345&state=busy&type=service
                             │
3. HTTP server               ▼
                         Lock AppState → upsert session → emit_if_changed()
                             │
4. State resolution          ▼
                         resolve_ui_state(): pid=12345 "service" > pid=67890 "idle"
                         → Winner: "service"
                             │
5. Tauri event               ▼
                         previous="idle", resolved="service" → emit("status-changed", "service")
                             │
6. React hook                ▼
                         useStatus → setStatus("service")
                             │
7. UI renders                ▼
                         Mascot: RottweilerBark.png (12 frames)
                         StatusPill: blue dot, "Service"
                             │
8. Watchdog (2s later)       ▼
                         service_since = 2s ago → transition to "idle"
                         → emit("status-changed", "idle")
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript 5.8, Vite 7 |
| Backend | Rust, Tauri 2, tiny_http |
| Peer discovery | mdns-sd (Bonjour) |
| MCP server | Node.js, JSON-RPC 2.0 over stdio |
| Shell hooks | zsh/bash/fish scripts, curl |
| macOS native | cocoa + objc crates |
| Package manager | Bun |

## Documentation Index

| Document | Description |
|----------|-------------|
| [Project Structure](./project-structure.md) | Complete file tree with responsibilities |
| [State Management](./state-management.md) | AppState, hooks, state machine, threading |
| [Events Reference](./events-reference.md) | All Tauri events and commands |
| [HTTP API](./http-api.md) | Endpoint reference for shell/Claude/peer hooks |
| [Animation System](./animation-system.md) | Sprite format, CSS engine, adding characters |
| [Theming](./theming.md) | CSS variables, dark/light themes, glow effects |
| [Conventions](./conventions.md) | Coding rules, naming, patterns |
| [Constants Reference](./constants-reference.md) | All magic numbers, timeouts, config values |
| [Adding Features](./adding-features.md) | Step-by-step recipes for common additions |
| [Shell Integration](./shell-integration.md) | Hook scripts for zsh, bash, fish |
| [Setup Flow](./setup-flow.md) | First-launch auto-setup, shell detection |
| [Peer Discovery](./peer-discovery.md) | mDNS discovery, visit protocol |
