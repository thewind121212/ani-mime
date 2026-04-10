# Events Reference

Complete reference for all Tauri events used for backend-frontend communication.

## Event Flow Overview

```
Shell hooks (curl) → HTTP :1234 → Rust state → app.emit() → React listen()
                                                                    ↓
User interaction → invoke() command → Rust handler → app.emit() → React listen()
```

## Backend → Frontend Events

### Core Status

| Event | Payload | Source | Listener |
|-------|---------|--------|----------|
| `status-changed` | `string` (Status) | `emit_if_changed()` in `state.rs` | `useStatus` |
| `task-completed` | `{ duration_secs: u64 }` | `/status` route (busy→idle) | `useBubble` |

### Peer Discovery

| Event | Payload | Source | Listener |
|-------|---------|--------|----------|
| `peers-changed` | `Vec<PeerInfo>` | `discovery.rs` (resolve/remove) | `usePeers` |
| `discovery-hint` | `string` ("no_peers") | `discovery.rs` (30s heartbeat) | `useBubble` |

### Visiting

| Event | Payload | Source | Listener |
|-------|---------|--------|----------|
| `dog-away` | `bool` | `start_visit` command / visit thread | `useStatus` |
| `visitor-arrived` | `{ pet, nickname, duration_secs }` | `/visit` route | `useVisitors` |
| `visitor-left` | `{ nickname }` | `/visit-end` route / watchdog | `useVisitors` |

### Dev/Testing

| Event | Payload | Source | Listener |
|-------|---------|--------|----------|
| `scenario-override` | `{ status: string } \| null` | `scenario_override` command | `useStatus` |

## Frontend → Frontend Events (Cross-Window Broadcast)

These events synchronize settings across the main, settings, and superpower windows.

| Event | Payload | Emitter | Listener |
|-------|---------|---------|----------|
| `bubble-changed` | `bool` | `useBubble.setEnabled()` | `useBubble` |
| `theme-changed` | `string` (Theme) | `useTheme.setTheme()` | `useTheme` |
| `glow-changed` | `string` (GlowMode) | `useGlow.setMode()` | `useGlow` |
| `nickname-changed` | `string` | `useNickname.setNickname()` | `useNickname` |
| `pet-changed` | `string` (Pet) | `usePet.setPet()` | `usePet` |
| `dev-mode-changed` | `bool` | Settings (10x version click) | `useDevMode` |

## Tauri Commands (Frontend → Backend)

Invoked via `invoke()` from the frontend.

| Command | Arguments | Returns | Purpose |
|---------|-----------|---------|---------|
| `start_visit` | `peer_id: string, nickname: string, pet: string` | `Result<(), String>` | Initiate visit to peer |
| `get_logs` | none | `Vec<LogEntry>` | Fetch log buffer |
| `clear_logs` | none | `()` | Clear log buffer |
| `scenario_override` | `status: string \| null` | `()` | Override UI state for testing |
| `preview_dialog` | `dialog_id: string` | `()` | Show test dialog |
| `open_superpower` | none | `()` | Open dev tools window |

## Event Naming Convention

- Backend events: `kebab-case` (e.g., `status-changed`)
- All events are global (not window-scoped) - every window receives every event
- Payload is always JSON-serializable

## Adding a New Event

### Backend → Frontend

1. Define the event name as a string constant (or inline in `app.emit()`)
2. Emit from Rust: `app.emit("my-event", payload).ok();`
3. Listen in React hook:
   ```typescript
   useEffect(() => {
     const unlisten = listen<PayloadType>("my-event", (event) => {
       setState(event.payload);
     });
     return () => { unlisten.then(f => f()); };
   }, []);
   ```

### Cross-Window Broadcast

1. Emit from the originating hook: `emit("setting-changed", value);`
2. Listen in the same hook (all windows run the same hooks):
   ```typescript
   const unlisten = listen<T>("setting-changed", (event) => {
     setState(event.payload);
   });
   ```
3. Persist to store if the value should survive restarts
