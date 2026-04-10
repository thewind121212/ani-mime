# State Management

How application state flows between backend and frontend, and patterns for extending it.

## Overview

Ani-Mime uses a two-tier state model:

```
Backend (Rust)                          Frontend (React)
┌─────────────────────┐                ┌───────────────────────┐
│ Arc<Mutex<AppState>> │ ──emit()──→   │ useState + listen()   │
│                      │                │                       │
│ Sessions (per-PID)   │                │ useStatus → Status    │
│ Peers (mDNS)         │                │ usePeers → PeerInfo[] │
│ Visitors             │                │ useVisitors → Visitor[]│
│ UI resolution        │                │ useBubble → messages  │
└─────────────────────┘                └───────────────────────┘

Frontend (React)                        Tauri Store (Disk)
┌───────────────────────┐              ┌────────────────────┐
│ Settings hooks        │ ──store──→   │ settings.json      │
│                       │               │                    │
│ useTheme → Theme      │               │ theme: "dark"      │
│ usePet → Pet          │               │ pet: "rottweiler"  │
│ useNickname → string  │               │ nickname: "..."    │
│ useGlow → GlowMode    │               │ glowMode: "off"    │
│ useBubble → enabled   │               │ bubbleEnabled: true │
└───────────────────────┘              └────────────────────┘
```

## Backend State (`AppState`)

Single source of truth for runtime state. Defined in `src-tauri/src/state.rs`.

### Structure

```rust
pub struct AppState {
    // Terminal sessions (keyed by shell PID)
    pub sessions: HashMap<u32, Session>,

    // Resolved UI state (the "winner" across all sessions)
    pub current_ui: String,          // "busy" | "service" | "idle" | "disconnected" | ...
    pub idle_since: u64,             // when idle started (for sleep mode)
    pub sleeping: bool,              // suppresses redundant idle emits

    // Peer discovery
    pub peers: HashMap<String, PeerInfo>,
    pub visitors: Vec<VisitingDog>,
    pub visiting: Option<String>,    // peer_id currently visiting

    // mDNS registration info
    pub discovery_instance: String,
    pub discovery_addrs: Vec<String>,
    pub discovery_port: u16,
}
```

### Session Lifecycle

```
Terminal opens → first curl /status → Session created (pid=N)
    ↓
Commands run → /status?state=busy → Session.busy_type = "task"|"service"
    ↓
Command ends → /status?state=idle → Session.ui_state = "idle"
    ↓
Heartbeat loop → /heartbeat every 20s → Session.last_seen refreshed
    ↓
Terminal closes → no more heartbeats → 40s timeout → Session removed
```

### UI Resolution Priority

When multiple sessions exist, `resolve_ui_state()` picks the highest-priority state:

```
busy > service > idle > disconnected
```

- If ANY session is busy → UI shows busy
- Else if ANY session is service → UI shows service
- Else if ANY session is idle → UI shows idle
- Else (no sessions) → UI shows disconnected

### State Machine

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

### Special Cases

| Case | Behavior |
|------|----------|
| PID 0 (Claude Code) | Never times out from heartbeat |
| Sleep mode | After 120s idle, stops emitting idle events |
| Service display | Shows for exactly 2s, then auto-transitions to idle |
| Busy heartbeat | Heartbeats don't refresh `last_seen` for busy sessions (prevents stuck state) |
| Multi-terminal | Each terminal has its own session; UI shows the "winning" state via priority resolution |

## Frontend State

No global state library. Each concern has its own hook.

### Runtime State (from backend events)

| Hook | State | Updated By |
|------|-------|-----------|
| `useStatus` | `Status` | `status-changed`, `dog-away`, `scenario-override` events |
| `useVisitors` | `Visitor[]` | `visitor-arrived`, `visitor-left` events |
| `usePeers` | `PeerInfo[]` | `peers-changed` event |
| `useBubble` | `{ visible, message }` | `status-changed`, `task-completed`, `discovery-hint` events |
| `useDevMode` | `boolean` | `dev-mode-changed` event |

### Persistent State (Tauri Store)

| Hook | Key | Default | Broadcast Event |
|------|-----|---------|-----------------|
| `useTheme` | `"theme"` | `"dark"` | `theme-changed` |
| `usePet` | `"pet"` | `"rottweiler"` | `pet-changed` |
| `useNickname` | `"nickname"` | `""` | `nickname-changed` |
| `useGlow` | `"glowMode"` | `"off"` | `glow-changed` |
| `useBubble` | `"bubbleEnabled"` | `true` | `bubble-changed` |

### Persistent Settings Hook Pattern

All settings hooks follow this pattern:

```typescript
function useSetting<T>(key: string, defaultValue: T, eventName: string) {
  const [value, setValue] = useState<T>(defaultValue);
  const [loaded, setLoaded] = useState(false);

  // Load from store on mount
  useEffect(() => {
    const store = new Store("settings.json");
    store.get<T>(key).then((v) => {
      if (v !== null) setValue(v);
      setLoaded(true);
    });
  }, []);

  // Listen for cross-window changes
  useEffect(() => {
    const unlisten = listen<T>(eventName, (e) => setValue(e.payload));
    return () => { unlisten.then(f => f()); };
  }, []);

  // Setter: persist + broadcast
  const set = (newValue: T) => {
    setValue(newValue);
    const store = new Store("settings.json");
    store.set(key, newValue);
    store.save();
    emit(eventName, newValue);
  };

  return { value, set, loaded };
}
```

## Adding New State

### New Backend State

1. Add field to `AppState` in `state.rs`
2. Initialize in `lib.rs` where `AppState` is constructed
3. Mutate inside a `state.lock().unwrap()` scope
4. Emit changes via `app.emit("your-event", payload)`
5. If it affects UI resolution, update `resolve_ui_state()`

### New Frontend Runtime State

1. Create `src/hooks/useYourThing.ts`
2. Listen to the backend event
3. Return state and any actions
4. Use in components that need it

### New Persistent Setting

1. Create `src/hooks/useYourSetting.ts` following the pattern above
2. Add UI control in `Settings.tsx`
3. The hook handles persistence, loading, and cross-window sync automatically

## Thread Safety Notes

- `AppState` is always accessed through `Arc<Mutex<>>` - never share raw references
- The HTTP server, watchdog, and discovery threads all hold their own `Arc` clone
- Lock ordering: there is only one lock (`AppState`), so no deadlock risk
- Keep lock duration minimal - clone data out, drop lock, then do I/O
