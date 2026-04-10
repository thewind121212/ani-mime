# Ani-Mime

A floating macOS desktop mascot (pixel dog) that reacts to terminal and Claude Code activity in real-time. Built with Tauri 2 + React 19.

## Commands

| Task | Command |
|------|---------|
| Dev | `bun run tauri dev` |
| Build | `bun run tauri build` |
| Type check frontend | `npx tsc --noEmit` |
| Type check backend | `cd src-tauri && cargo check` |
| Package manager | Bun (not npm/yarn) |

## Data Flow

```
Shell hooks (curl) → HTTP :1234 → Rust state → Tauri event → React UI
```

## Documentation Map

### "I want to understand..."

| Topic | Document |
|-------|----------|
| System overview, design decisions, request lifecycle | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Where files live and what they do | [docs/project-structure.md](docs/project-structure.md) |
| How state flows (AppState, hooks, state machine, threading) | [docs/state-management.md](docs/state-management.md) |
| All events and commands between backend and frontend | [docs/events-reference.md](docs/events-reference.md) |
| HTTP endpoints (`/status`, `/heartbeat`, `/visit`) | [docs/http-api.md](docs/http-api.md) |
| Sprite animation, CSS engine, frame timing | [docs/animation-system.md](docs/animation-system.md) |
| Theme system, CSS variables, glow effects | [docs/theming.md](docs/theming.md) |
| mDNS peer discovery and visit protocol | [docs/peer-discovery.md](docs/peer-discovery.md) |
| Shell hooks (zsh/bash/fish), command classification | [docs/shell-integration.md](docs/shell-integration.md) |
| First-launch auto-setup | [docs/setup-flow.md](docs/setup-flow.md) |

### "I want to build/change..."

| Task | Start here |
|------|-----------|
| Add a new UI status | [docs/adding-features.md](docs/adding-features.md) → "New UI Status" |
| Add a new HTTP endpoint | [docs/adding-features.md](docs/adding-features.md) → "New HTTP Endpoint" |
| Add a new Tauri command | [docs/adding-features.md](docs/adding-features.md) → "New Tauri Command" |
| Add a new component or hook | [docs/adding-features.md](docs/adding-features.md) → "New React Component" / "New Hook" |
| Add a new character/pet | [docs/animation-system.md](docs/animation-system.md) → "Adding a New Character" |
| Add a new shell | [docs/adding-features.md](docs/adding-features.md) → "New Shell Support" |
| Add a new window | [docs/adding-features.md](docs/adding-features.md) → "New Window" |
| Add a new theme | [docs/theming.md](docs/theming.md) → "Adding a New Theme" |
| Add a new persistent setting | [docs/adding-features.md](docs/adding-features.md) → "New Persistent Setting" |
| Add a new event | [docs/events-reference.md](docs/events-reference.md) → "Adding a New Event" |

### "I need to look up..."

| What | Document |
|------|----------|
| Timeouts, ports, magic numbers | [docs/constants-reference.md](docs/constants-reference.md) |
| Naming rules, code patterns, git conventions | [docs/conventions.md](docs/conventions.md) |
| Tauri Store keys and defaults | [docs/constants-reference.md](docs/constants-reference.md) → "Tauri Store Keys" |
| Status colors and dot animations | [docs/theming.md](docs/theming.md) → "Status Colors" |
| Window sizes and config | [docs/constants-reference.md](docs/constants-reference.md) → "Window Configuration" |

## Critical Rules

- **Port 1234** is hardcoded across shell scripts, Claude hooks, and Rust server (override via `ANI_MIME_PORT` env var)
- **pid=0** is reserved for Claude Code hooks (virtual session, never times out)
- **Status priority**: `busy > service > idle > disconnected` — always one winner across all terminals
- **Three shells must stay in sync**: any change to shell hooks must be applied to zsh, bash, AND fish
- **Frontend/backend status strings** are synced manually (no codegen) — update both sides
