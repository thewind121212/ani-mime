# Data Flow

End-to-end lifecycle of a status change, from shell command to pixel on screen.

## Request Lifecycle

### 1. User runs a command in terminal

```
$ yarn dev
```

### 2. Shell hook intercepts (preexec)

The zsh/bash/fish hook fires **before** the command executes:

```
preexec("yarn dev")
  → _tm_classify("yarn dev") → "service" (matches "dev" keyword)
  → curl "http://127.0.0.1:1234/status?pid=12345&state=busy&type=service"
```

### 3. HTTP server receives request

```
server.rs: GET /status?pid=12345&state=busy&type=service
  → Lock AppState
  → Upsert session for pid=12345
  → Set ui_state = "service", service_since = now
  → Call emit_if_changed()
```

### 4. State resolution

```
resolve_ui_state(sessions):
  pid=12345 → "service"
  pid=67890 → "idle"
  → Winner: "service" (service > idle)
```

### 5. Tauri event emitted

```
emit_if_changed():
  previous = "idle"
  resolved = "service"
  → They differ → emit("status-changed", "service")
```

### 6. React receives event

```
useStatus hook:
  listen("status-changed") → payload = "service"
  → setStatus("service")
```

### 7. UI updates

```
<Mascot status="service" />
  → spriteMap["service"] = { file: "RottweilerBark.png", frames: 12 }
  → Renders barking animation

<StatusPill status="service" />
  → dot class = "dot service" (blue glow)
  → label = "Service"
```

### 8. Watchdog auto-transition (2s later)

```
watchdog.rs (tick):
  session pid=12345: ui_state="service", service_since = 2s ago
  → Transition to "idle"
  → emit_if_changed() → emit("status-changed", "idle")
  → UI updates to idle (green, "Free")
```

## State Machine

```
                    ┌──────────────────┐
                    │   initializing   │  (app starting up)
                    └────────┬─────────┘
                             │ first shell connects
                             ▼
                    ┌──────────────────┐
         ┌────────>│    searching     │  (waiting for shells)
         │         └────────┬─────────┘
         │                  │ /status received
         │                  ▼
         │         ┌──────────────────┐
         │    ┌───>│      idle        │<──────────────────┐
         │    │    └────────┬─────────┘                    │
         │    │             │                              │
         │    │    state=busy&type=task          state=idle│
         │    │             │                              │
         │    │             ▼                              │
         │    │    ┌──────────────────┐                    │
         │    │    │      busy        │────────────────────┘
         │    │    └──────────────────┘   command finishes
         │    │
         │    │    state=busy&type=service
         │    │             │
         │    │             ▼
         │    │    ┌──────────────────┐
         │    │    │    service       │───┐
         │    │    └──────────────────┘   │ watchdog (2s)
         │    │                           │
         │    └───────────────────────────┘
         │
         │  all sessions removed (40s timeout)
         │
         │         ┌──────────────────┐
         └─────────│  disconnected    │
                   └──────────────────┘
```

## Multi-Terminal Resolution

When multiple terminals are active, each has its own session. The UI shows one "winning" state.

```
Terminal A: busy    ─┐
Terminal B: idle    ─┼─→ resolve_ui_state() → "busy"
Terminal C: idle    ─┘

Terminal A: idle    ─┐
Terminal B: service ─┼─→ resolve_ui_state() → "service"
Terminal C: idle    ─┘

Terminal A: idle    ─┐
Terminal B: idle    ─┼─→ resolve_ui_state() → "idle"
Terminal C: idle    ─┘
```

## Claude Code Integration

Claude Code uses pid=0 as a virtual session:

```
Claude starts working:
  Hook fires → curl /status?pid=0&state=busy&type=task
  → Session pid=0 created with ui_state="busy"

Claude finishes:
  Hook fires → curl /status?pid=0&state=idle
  → Session pid=0 set to "idle"

All shell sessions die:
  → Watchdog removes pid=0 too (it's only kept alive while real shells exist)
```

## Heartbeat Flow

```
Every 20s per shell:
  curl /heartbeat?pid=$$
    → server refreshes session.last_seen
    → session stays alive in watchdog

Shell closes (no more heartbeats):
  → 40s pass with no signal
  → Watchdog removes session
  → If last session → emit "disconnected"
```
