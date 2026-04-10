# Coding Conventions

Rules and patterns followed throughout the codebase. Follow these when contributing.

## General Principles

- **Minimal dependencies** - avoid adding libraries for things that can be done simply
- **Flat over nested** - prefer flat module structure; only use directories when grouping 3+ related files
- **No premature abstraction** - duplicate is better than wrong abstraction; extract only when a pattern repeats 3+ times
- **macOS-first** - platform-specific code behind `#[cfg(target_os = "macos")]`; other platforms are not yet supported

## Rust (Backend)

### Module Organization

| Pattern | Example |
|---------|---------|
| One file per concern | `server.rs`, `watchdog.rs`, `logger.rs` |
| Directory for grouped concerns | `setup/mod.rs`, `setup/shell.rs`, `setup/claude.rs` |
| Re-export from `mod.rs` | `pub mod shell; pub mod claude;` |

### State & Concurrency

- Shared state uses `Arc<Mutex<AppState>>` managed by Tauri
- Always scope mutex locks to the smallest possible block:
  ```rust
  {
      let mut st = state.lock().unwrap();
      st.sessions.insert(pid, session);
  } // lock released here, before any expensive work
  ```
- Never hold a lock across I/O, sleep, or emit calls
- Background threads: spawn with `std::thread::spawn`, pass cloned `Arc` handles
- No async runtime - all concurrency is thread-based with `std::thread`

### Naming

| Item | Convention | Example |
|------|-----------|---------|
| Modules | `snake_case` | `shell_integration.rs` |
| Structs | `PascalCase` | `AppState`, `Session` |
| Functions | `snake_case` | `resolve_ui_state()` |
| Constants | `SCREAMING_SNAKE_CASE` | `HEARTBEAT_TIMEOUT_SECS` |
| Tauri commands | `snake_case` | `#[tauri::command] fn start_visit()` |
| HTTP routes | lowercase with slash | `/status`, `/heartbeat` |

### Error Handling

- Thread panics: catch with `.join().map_err()` at spawn site
- HTTP/network errors: log and continue (never crash the app)
- State errors: return `Result<T, String>` from Tauri commands
- Use `app_log!()`, `app_warn!()`, `app_error!()` macros from `logger.rs`
- Shell hook commands always append `|| true` for graceful offline handling

### Event Emission

- Always go through `emit_if_changed()` for status updates - never emit `status-changed` directly
- `emit_if_changed()` deduplicates: only emits when `current_ui` actually changes
- Other events (visitors, peers, tasks) emit directly via `app.emit()`

## TypeScript / React (Frontend)

### Component Patterns

- **Functional components only** - no class components
- **One component per file** - file name matches component name (`Mascot.tsx` exports `Mascot`)
- **Props interface inline** - define props in the same file, not imported
- **No state management library** - `useState` + Tauri events is sufficient
- **Hooks for logic** - extract reusable logic into `hooks/use*.ts`

### Hook Patterns

- Prefix with `use` (React convention): `useStatus`, `useDrag`, `useTheme`
- Each hook manages one concern
- Persistent settings: read from `Store` on mount, write on change, broadcast via Tauri event
- Event cleanup: always return unlisten function from `useEffect`

```typescript
// Standard hook pattern for persistent settings
useEffect(() => {
  const store = new Store("settings.json");
  store.get<T>(KEY).then((val) => {
    if (val !== null) setState(val);
    setLoaded(true);
  });
}, []);
```

### Naming

| Item | Convention | Example |
|------|-----------|---------|
| Components | `PascalCase.tsx` | `StatusPill.tsx` |
| Hooks | `useCamelCase.ts` | `useStatus.ts` |
| Types | `PascalCase` | `Status`, `SpriteConfig` |
| Constants | `camelCase` or `SCREAMING_SNAKE` | `autoStopStatuses`, `BUBBLE_DURATION_MS` |
| CSS files | `kebab-case.css` | `status-pill.css` |
| Event names | `kebab-case` | `"status-changed"`, `"task-completed"` |

### CSS Patterns

- **One CSS file per component** - in `styles/` directory
- **CSS custom properties** for theming (defined in `theme.css`)
- **No CSS-in-JS** - plain CSS files imported at component level
- **No CSS modules** - global styles scoped by class names
- Animations: CSS `@keyframes` preferred over JS animation
- Use `backdrop-filter: blur()` for glass effect
- Pixel art: always use `image-rendering: pixelated`

### Asset Handling

- Sprites live in `src/assets/sprites/{character}/`
- Import via Vite's `import.meta.url`:
  ```typescript
  new URL(`../assets/sprites/${sprite.file}`, import.meta.url).href
  ```
- No assets in `public/` (all bundled through Vite)

## Shell Scripts

- One script per shell: `terminal-mirror.{zsh,bash,fish}`
- All HTTP calls use `curl -s --max-time 1 ... > /dev/null 2>&1 || true`
- Prefix internal functions with `_tm_` to avoid namespace collisions
- Heartbeat loop: background process with PID guard file at `/tmp/tauri-heartbeat-{shell_pid}`
- Clean up on shell exit (trap EXIT)

## Git & Versioning

- **Commit style**: imperative mood, concise ("Fix heartbeat timeout", "Add peer discovery")
- **Branch naming**: `feature/`, `fix/`, `release/` prefixes
- **Version**: Semantic versioning in 3 places (keep in sync):
  - `package.json` → `version`
  - `src-tauri/Cargo.toml` → `version`
  - `src-tauri/tauri.conf.json` → `version`
- **Changelog**: update `CHANGELOG.md` for each release
- **Tags**: `v{major}.{minor}.{patch}` triggers CI release build

## Adding Dependencies

- **Frontend**: `bun add <package>` (never npm/yarn)
- **Backend**: add to `src-tauri/Cargo.toml`, prefer crates with minimal transitive deps
- Before adding a dependency, check if the feature can be done with existing deps or std lib
