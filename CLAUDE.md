# Ani-Mime

A floating macOS desktop mascot (pixel dog) that reacts to terminal and Claude Code activity in real-time. Built with Tauri 2 + React 19.

## Quick Reference

- **Dev**: `bun run tauri dev`
- **Build**: `bun run tauri build && bash src-tauri/script/post-build-sign.sh`
- **Type check frontend**: `npx tsc --noEmit`
- **Type check backend**: `cd src-tauri && cargo check`
- **Package manager**: Bun (not npm/yarn)
- **Entitlements**: `src-tauri/Entitlements.plist` (network + Hardened Runtime); post-build re-sign is required for ad-hoc builds

## Architecture

See `docs/ARCHITECTURE.md` for full details. Key data flow:

```
Shell hooks (curl) → HTTP :1234 → Rust state → Tauri event → React UI
Claude Code ←stdio→ MCP server (Node.js) ←HTTP→ :1234 → Tauri event → React UI
```

### Backend (`src-tauri/src/`)

| Module | Responsibility |
|--------|---------------|
| `lib.rs` | Tauri setup, plugin registration, tray icon, composition root, all `#[tauri::command]` functions |
| `state.rs` | `AppState`, `Session`, `SessionInfo`, `resolve_ui_state()`, `emit_if_changed()` |
| `server.rs` | HTTP server on `127.0.0.1:1234` (tiny_http), incl. MCP endpoints. Rejects status/heartbeat with 410 when the pid isn't alive |
| `watchdog.rs` | Background thread: service→idle transition, stale session cleanup |
| `proc_scan.rs` | Background thread (2s): libproc-based OS scan — auto-discovers shells, fills `pwd`/`tty`/`fg_cmd`, detects `claude` via `KERN_PROCARGS2` argv, drops zombie sessions |
| `focus.rs` | `focus_terminal_for_pid()` — walks parent chain to find owning terminal app (iTerm/Terminal/VS Code/Cursor/tmux/etc.), activates via `open -a`, optionally targets tab via AppleScript |
| `helpers.rs` | `now_secs()`, `get_query_param()` |
| `setup/mod.rs` | First-launch auto-setup orchestrator |
| `setup/shell.rs` | Shell detection, native dialogs, RC file injection |
| `setup/claude.rs` | Claude Code hooks configuration |
| `setup/mcp.rs` | MCP server installation + Claude Code MCP registration |
| `logger.rs` | Log file tail-reader, `app_log!`/`app_warn!`/`app_error!` macros |
| `platform/macos.rs` | Cocoa/objc window transparency, workspace visibility, dock visibility |

### MCP Server (`src-tauri/mcp-server/`)

| File | Responsibility |
|------|---------------|
| `server.mjs` | Zero-dependency Node.js MCP server (JSON-RPC 2.0 over stdio) |

### Frontend (`src/`)

| Module | Responsibility |
|--------|---------------|
| `App.tsx` | Root composition: layout + drag |
| `components/Mascot.tsx` | Sprite animation with auto-freeze |
| `components/StatusPill.tsx` | Colored dot + status label + session list dropdown (grouped by PWD) |
| `hooks/useStatus.ts` | Tauri `"status-changed"` + `"mcp-react"` event listener |
| `hooks/useDrag.ts` | Window drag via Tauri API |
| `hooks/useBubble.ts` | Speech bubbles: task-completed, welcome, `"mcp-say"` |
| `hooks/useDockVisible.ts` | Toggle dock visibility via `set_dock_visible` command |
| `hooks/useSessions.ts` | `fetchSessions()` wrapper around the `get_sessions` Tauri command |
| `hooks/useSessionList.ts` | Persistent setting: whether the pill-click session dropdown is enabled |
| `constants/sprites.ts` | Sprite file map, frame counts, auto-stop set |
| `types/status.ts` | `Status` type, `SpriteConfig` interface |
| `assets/claude-logo.png` | Claude Code icon shown on sessions running `claude` |

### Status Priority

When multiple terminals are open, the UI shows one winner: `busy > service > idle > disconnected`

## Conventions

- **Rust**: Modules are flat files or directories with `mod.rs`. Shared state uses `Arc<Mutex<AppState>>`.
- **React**: Functional components, hooks for logic. No state management library — `useState` + Tauri events.
- **CSS**: Split by component (`styles/app.css`, `styles/mascot.css`, `styles/status-pill.css`). Uses CSS custom properties for sprite animation.
- **Types**: `Status` is the core shared type. Keep frontend and backend status strings in sync manually (no codegen yet).
- **Shell scripts**: One per shell (`terminal-mirror.{zsh,bash,fish}`). All use `curl` to talk to `:1234`.

## Important Details

- HTTP server runs on `127.0.0.1:1234` — this port is hardcoded in shell scripts, Claude hooks, and Rust server
- pid=0 is reserved for Claude Code hooks (virtual session)
- Heartbeats only refresh `last_seen` for non-busy sessions (prevents stuck commands from staying alive)
- `/status` and `/heartbeat` reject with 410 when the pid isn't a live OS process — stops orphaned heartbeat subshells from re-registering dead sessions
- Service state auto-transitions to idle after 2 seconds (watchdog)
- Sessions are removed after 40 seconds with no heartbeat (watchdog) OR immediately once `proc_scan` sees the PID is gone
- Shell hooks send `pwd=$PWD` and `tty=$TTY` on every `/status` and `/heartbeat`; `proc_scan` fills the same fields authoritatively from libproc every 2 seconds
- `proc_scan` uses `KERN_PROCARGS2` sysctl to read argv[0] because `claude` shows up as `"node"` in `p_comm` (Claude Code is a Node binary)
- `focus_terminal` Tauri command walks the parent chain via libproc + a `ps`-based ppid fallback (needed because libproc refuses BSDInfo for root-owned `login`)
- Setup marker file: `~/.ani-mime/setup-done`
- macOS-only: uses `cocoa` + `objc` crates for window transparency (behind `#[cfg(target_os = "macos")]`)
- Tray icon is always present; left-click toggles main window, right-click shows menu (Show, Settings, Quit)
- "Hide from Dock" preference stored as `hideDock` in `settings.json`; applied at startup via `ActivationPolicy::Accessory`
- MCP server (`server.mjs`) is installed to `~/.ani-mime/mcp/` on every startup; registered in `~/.claude.json` during first-launch setup
- MCP endpoints: `/mcp/say` (speech bubble), `/mcp/react` (temp animation), `/mcp/pet-status` (JSON status)
- MCP reactions map to existing statuses: celebrate/excited→service, nervous→busy, confused→searching, sleep→disconnected

## Logging

- **Writer**: `tauri-plugin-log` appends structured lines to `ani-mime.log` inside the Tauri log dir (`~/Library/Logs/<bundle-id>/`)
- **Reader**: `logger.rs` reads the tail of that same file to display in the Superpower Tool UI
- **Rotation**: Configured as `KeepSome(3)` with 1MB max per file — do not increase without reason
- **Tail-read**: `read_log_file()` seeks to the end of the file and reads only the last ~N×256 bytes. Never load the entire log file into memory.
- **Macros**: Use `app_log!()`, `app_warn!()`, `app_error!()` for app-level logging — these route through the `log` crate so the plugin writes them to file
- **Levels**: `debug` for dev diagnostics, `info` for state changes, `warn`/`error` for problems. Third-party crate noise is filtered in `lib.rs` (e.g. `mdns_sd` set to `Warn`)
- **Don't truncate the log file externally** — `tauri-plugin-log` holds its own file handle; truncating causes stale size tracking and premature rotation

## Testing

### Automation-Friendly UI

Every interactive or observable UI element must be locatable by automated tests without coupling to styling or DOM structure.

- **Always add `data-testid`** to any element that a test might need to find — buttons, inputs, status indicators, containers, cards, toggles, labels. When in doubt, add one.
- **Naming**: `data-testid="section-element"` (e.g., `settings-tab-appearance`, `pet-card-shiba`, `creator-save-btn`). Use kebab-case. Parameterize with dynamic values where appropriate (`pet-card-${id}`).
- **Semantic HTML first**: Use `<button>`, `<input>`, `<nav>`, `<main>`, `<label>` — not styled `<div>`s. This enables `getByRole()` locators.
- **ARIA attributes**: Add `aria-label` on icon-only buttons, `role="switch"` + `aria-checked` on toggles, and `htmlFor` on `<label>` elements. These serve both accessibility and testability.
- **Never rely on CSS classes or DOM position for test selectors.** Selectors like `.sidebar-item:nth-child(2)` break when styling or order changes.

### Selector Priority (for both unit and e2e tests)

1. `getByRole()` — preferred, tests what users see
2. `getByTestId()` / `[data-testid="..."]` — explicit, stable
3. `getByText()` / `getByPlaceholderText()` — acceptable for unique visible text
4. **Avoid**: `container.querySelector(".class")`, CSS class selectors, `:nth-child()`

### Test Structure

- **Unit tests** (Vitest + React Testing Library): `src/**/*.test.{ts,tsx}`
- **E2E tests** (Playwright): `e2e/*.spec.ts`
- **Run e2e**: `bunx playwright test -c e2e/playwright.config.ts --project=chromium`
- **Playwright config**: `e2e/playwright.config.ts` — chromium + webkit, trace on failure
- **When to run e2e**: Before pushing. No pre-commit or pre-push hook is configured — run manually. E2e takes ~7s on Chromium; too slow for a commit hook.
- **Tauri mock**: `e2e/tauri-mock.ts` — injects fake `__TAURI_INTERNALS__` for store, dialog, FS, window, and event plugins. Supports `__MOCK_DIALOG_RESULT__`, `__MOCK_READ_FILE_BYTES__`, `__MOCK_READ_FILE_MAP__`, `__MOCK_SAVE_DIALOG_RESULT__`, `__MOCK_WRITTEN_FILES__`, `__MOCK_WINDOW_SIZES__` for test assertions.

## Adding Features

- **New UI state**: Update `Status` type → `sprites.ts` → `StatusPill.tsx` → `status-pill.css` → `resolve_ui_state()` in `state.rs`
- **New HTTP endpoint**: Add route in `server.rs`, lock `AppState` if mutating, call `emit_if_changed()`
- **New Tauri command**: Define `#[tauri::command] fn` in `lib.rs`, register in the `invoke_handler!` macro. Domain logic may live in its own module (e.g. `focus.rs`), but the `#[tauri::command]` wrapper stays in `lib.rs`.
- **New MCP tool**: Add tool definition in `mcp-server/server.mjs`, add HTTP endpoint in `server.rs`, emit Tauri event for frontend
- **New shell**: Add script in `src-tauri/script/`, add `ShellInfo` in `setup/shell.rs`, add to `tauri.conf.json` bundle resources
- **New terminal app for click-to-focus**: Add an entry to `classify_bundle()` in `proc_scan.rs`, dispatch in `focus.rs` with either an existing strategy (`open -a` + AppleScript tab selection) or a new strategy
- **New persistent setting**: Follow the `useDockVisible` pattern — hook uses `load("settings.json")` + `listen`/`emit` on a `*-changed` event; add a row in `Settings.tsx`
- **Storage**: See `docs/storage.md` for the planned approach (tauri-plugin-store for prefs, SQLite for history)

## Releasing a New Version

Every version bump must update **all 4 files** — missing one causes the app to show stale version info:

| File | Field |
|------|-------|
| `package.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src/components/Settings.tsx` | Hardcoded `Version X.Y.Z` string in About section |

After editing `Cargo.toml`, run `cargo check` in `src-tauri/` to regenerate `Cargo.lock`.

### Release checklist

1. **Bump version** in all 4 files above + update `CHANGELOG.md` header
2. **Commit**: `chore: release vX.Y.Z`
3. **PR → merge to main** (branch protection requires PR)
4. **Tag on main**: `git tag vX.Y.Z && git push origin vX.Y.Z`
5. **CI builds automatically** — triggered by `v*` tag push:
   - `create-release` job runs first: calls `gh release create --notes "$(gh api .../releases/generate-notes)"` to publish the GitHub release with an auto-generated "What's Changed" list of PRs merged since the previous tag, plus a **Full Changelog** compare link
   - `build` matrix then builds aarch64 + x86_64 DMGs and uploads them to that same release
   - Write PR titles in conventional-commit style (`feat:`, `fix:`, `chore:`, etc.) — they become the release-note bullet text verbatim
6. **Update Homebrew cask** after CI publishes DMG artifacts:
   - Download both DMGs: `gh release download vX.Y.Z --pattern "*.dmg"`
   - Compute hashes: `shasum -a 256 *.dmg`
   - Update `Casks/ani-mime.rb` in `vietnguyenhoangw/homebrew-ani-mime` with new version + SHA256s

### Naming conventions

- **Branch**: `release/vX.Y.Z`
- **Tag**: `vX.Y.Z`
- **Commit message**: `chore: release vX.Y.Z`
- **DMG artifacts**: `ani-mime_X.Y.Z_aarch64.dmg`, `ani-mime_X.Y.Z_x64.dmg`
- **Homebrew tap**: `vietnguyenhoangw/homebrew-ani-mime` → `Casks/ani-mime.rb`
