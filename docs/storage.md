# Storage (Planned)

This document describes the planned persistent storage layer for ani-mime.

## Current State

Today, persistence is minimal:
- **`~/.ani-mime/setup-done`** — flat file marker for first-launch setup
- **All runtime state is in-memory** — `HashMap<u32, Session>` inside `Arc<Mutex<AppState>>`
- **No user preferences are saved** — window position resets, no customization

## Planned Approach

### Phase 1: User Preferences (`tauri-plugin-store`)

Use Tauri's built-in key-value store for simple settings.

**What to store:**
| Key | Type | Description |
|-----|------|-------------|
| `window.x` | number | Window X position |
| `window.y` | number | Window Y position |
| `mascot.skin` | string | Selected mascot sprite set |
| `animation.autoFreeze` | boolean | Auto-freeze idle animations |
| `animation.freezeDelay` | number | Seconds before freeze (default: 10) |
| `setup.completedAt` | string | ISO timestamp (replaces flat file marker) |
| `setup.shells` | string[] | Which shells were configured |
| `setup.claudeHooks` | boolean | Whether Claude hooks were set up |

**Storage location:** `~/.ani-mime/store.json` (managed by tauri-plugin-store)

**Module structure:**
```
src-tauri/src/storage/
├── mod.rs             # Storage initialization, migration helpers
├── preferences.rs     # Read/write user preferences
└── setup.rs           # Setup state (replaces ~/.ani-mime/setup-done)
```

### Phase 2: Activity Data (SQLite — if needed)

Only add SQLite if we need queryable history. Potential use cases:

- **Session history**: How long you worked today/this week
- **Command stats**: Most common command types, busy vs idle ratio
- **Activity timeline**: Visual breakdown of terminal activity

**Would use:** `tauri-plugin-sql` with SQLite

**Schema sketch:**
```sql
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY,
  pid INTEGER NOT NULL,
  state TEXT NOT NULL,         -- 'busy', 'idle', 'service'
  command_type TEXT,           -- 'task', 'service'
  started_at INTEGER NOT NULL, -- unix timestamp
  ended_at INTEGER             -- null if ongoing
);
```

This is **not planned for immediate implementation** — only add when there's a concrete feature that needs it.

## Migration Path

### From flat file to store
1. On startup, check if `~/.ani-mime/setup-done` exists
2. If yes, migrate to store: `setup.completedAt = file modified time`
3. Delete the flat file
4. All future reads check the store

### Store versioning
- Include a `store.version` key
- On startup, check version and run migrations if needed
- Migrations are simple functions: `fn migrate_v1_to_v2(store: &mut Store)`

## Frontend Access

Preferences will be exposed to React via Tauri commands:

```rust
#[tauri::command]
fn get_preference(key: String, store: State<Store>) -> Option<serde_json::Value> { ... }

#[tauri::command]
fn set_preference(key: String, value: serde_json::Value, store: State<Store>) { ... }
```

React side:
```ts
import { invoke } from "@tauri-apps/api/core";

const pos = await invoke("get_preference", { key: "window.position" });
await invoke("set_preference", { key: "window.position", value: { x: 100, y: 200 } });
```

## Dependencies to Add

### Phase 1
```toml
# Cargo.toml
tauri-plugin-store = "2"
```

```json
// package.json
"@tauri-apps/plugin-store": "^2"
```

### Phase 2 (if needed)
```toml
# Cargo.toml
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
```
