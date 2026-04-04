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
                                     │  └────────┬────────┘  │                    │ └────────┘ │
                                     │           │           │                    └────────────┘
                                     │  ┌────────▼────────┐  │
                                     │  │  Watchdog       │  │
                                     │  │  (every 2s)     │  │
                                     │  └─────────────────┘  │
                                     └───────────────────────┘
```

## Key Design Decisions

1. **HTTP over IPC** — Shell hooks use `curl` to talk to the backend. This is simpler than Unix sockets and works across all shells.
2. **Heartbeat over process scanning** — Shells prove they're alive via periodic pings. No `sysinfo` crate, no process tree walking.
3. **Priority-based state resolution** — Multiple terminals resolve to one UI state: `busy > service > idle > disconnected`.
4. **Service auto-transition** — Dev servers flash "service" (blue) for 2s then become "idle". Prevents permanently-blue pill.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Backend](./backend.md) | Rust module structure, state management, HTTP server |
| [Frontend](./frontend.md) | React components, hooks, sprite system |
| [Data Flow](./data-flow.md) | End-to-end request lifecycle, state machine |
| [HTTP API](./http-api.md) | Endpoint reference for shell/Claude hooks |
| [Shell Integration](./shell-integration.md) | Hook scripts for zsh, bash, fish |
| [Setup Flow](./setup-flow.md) | First-launch auto-setup, shell detection |
| [Storage](./storage.md) | Planned persistent storage layer |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript 5.8, Vite 7 |
| Backend | Rust, Tauri 2, tiny_http |
| Shell hooks | zsh/bash/fish scripts, curl |
| macOS native | cocoa + objc crates |
| Package manager | Bun |

## Project Structure (Target)

```
ani-mime/
├── src/                          # React frontend
│   ├── main.tsx                  # Entry point
│   ├── App.tsx                   # Root component (composition)
│   ├── components/
│   │   ├── Mascot.tsx            # Sprite animation
│   │   └── StatusPill.tsx        # Dot + label pill
│   ├── hooks/
│   │   └── useStatus.ts          # Tauri event listener + state
│   ├── constants/
│   │   └── sprites.ts            # Sprite config map
│   ├── types/
│   │   └── status.ts             # Shared Status type
│   └── styles/
│       ├── app.css               # Global styles
│       ├── mascot.css            # Sprite animation
│       └── status-pill.css       # Pill + dot styles
│
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs               # Binary entry point
│   │   ├── lib.rs                # Tauri setup, run()
│   │   ├── state.rs              # AppState, Session, resolve_ui_state()
│   │   ├── server.rs             # HTTP server, route handling
│   │   ├── watchdog.rs           # Heartbeat monitor, stale cleanup
│   │   ├── helpers.rs            # Shared utilities (now_secs, query params)
│   │   ├── setup/
│   │   │   ├── mod.rs            # auto_setup() orchestrator
│   │   │   ├── shell.rs          # Shell detection, RC file injection
│   │   │   └── claude.rs         # Claude Code hooks config
│   │   └── platform/
│   │       └── macos.rs          # Cocoa/objc window setup
│   └── script/
│       ├── terminal-mirror.zsh
│       ├── terminal-mirror.bash
│       ├── terminal-mirror.fish
│       ├── tauri-hook.sh
│       └── install-hook.sh
│
├── docs/                         # Architecture documentation
└── public/                       # Static assets
```
