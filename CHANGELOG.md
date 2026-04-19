# Changelog

## [0.16.5] - 2026-04-20

### Added
- **Linux / WSL2 support** — Ani-Mime now runs on Linux and WSL2 via a cross-platform backend facade. Native Linux uses GTK `set_keep_above`; WSLg uses a `SetWindowPos(HWND_TOPMOST)` PowerShell shim, re-asserted on every focus-lost event so the pet stays on top after clicking into other maximized Windows apps. Dialogs use `zenity`, file/URL open uses `xdg-open`. macOS is unchanged. (#81, @cuongtranba)
- **Linux release artifacts in CI** — tag pushes now build and publish `.deb`, `.rpm`, and `.AppImage` for both `x86_64` and `aarch64` alongside the existing macOS DMGs. A release now ships 8 artifacts (2 DMGs + 6 Linux bundles). (#93)
- **Claude Code Management UI screenshot** — new `docs/assets/settings-claude-code.png` added to the README Screenshots table with a dedicated Features bullet describing the Settings → Claude Code tab. (#93)

### Fixed
- **Updater auto-install compile break** — the auto-install branch called `update_now(&app_handle)` with one argument while the function requires `(app_handle, release_url)`. This was a hard `E0061` compile error on Linux and a silent hole on macOS where auto-install never reached the upgrade flow. `release_url` is now computed once per run and passed to both the auto-install path and `show_update_dialog`. (#93)
- **macOS full-screen Spaces** — pet now floats over full-screen apps on every Space (`setCollectionBehavior` switched from `fullScreenNone` to `fullScreenAuxiliary`). (#81)
- **Peer discovery & visit flow** — hardened to match snor-oh parity; visitors now render reliably with a fallback sprite for unknown pet types. (#92)
- **Claude Code settings — MCP Servers** — "Global" and per-project sub-headers no longer hug the card's left edge; horizontal padding bumped from `0` to `12px` so they align with the server rows below. (#93)
- **Claude Code settings — Commands** — the expanded `/command` body (shown after tapping View) now sits inside the card with `12px` left/right margin instead of stretching flush edge-to-edge. (#93)
- **Claude Code settings — Plugins** — plugin rows now match the 2-line rhythm used by MCP, Commands, and Hooks: name + version badge on line 1, marketplace on line 2. The enable/disable toggle keeps its full size on narrow windows (`.toggle-switch` gets `flex-shrink: 0`). The plugin skills expand toggle ("N skills") is temporarily hidden pending UX work. (#93)

### Changed
- `.claude-item-info` now wraps so any row can drop an ellipsized preview onto a second line via `.claude-cmd-preview { flex-basis: 100%; }`. Unifies the layout across Commands, MCP Servers, Plugins, and Hooks rows. (#93)

## [0.16.4] - 2026-04-19

### Added
- **Install Updates Automatically** toggle in Settings (default ON) — when enabled, a detected new version runs `brew upgrade --cask ani-mime` directly instead of showing the Later/Changelog/Update Now dialog. Disable the toggle to restore the confirmation dialog. Manual menu checks always show the dialog. (#88)
- **Collapsible session groups** in the status-pill dropdown. Click a group header to hide its shells; the collapsed state is persisted in `settings.json` under `collapsedSessionGroups` and restored on the next dropdown open. (#90)

### Fixed
- Hook rows and the event-name label in the Claude Code settings tab now align with plugin rows and other row content (removed the `padding-left: 8px` override on `.claude-hook-row`, added horizontal padding to `.claude-hook-header`). (#89)
- Empty-state messages in the Claude Code tab ("No plugins installed", "No MCP servers registered", "No custom commands", "No hooks configured") now render inside the same grey card container as populated lists, keeping visual rhythm. (#89)

### Changed
- Release notes auto-generator now filters out `chore: release vX.Y.Z` PRs so each release's "What's Changed" list only shows real feature/fix PRs.

## [0.16.3] - 2026-04-18

### Added
- **Claude Code plugin manager tab** in Settings — view, enable, disable, and manage installed Claude Code plugins directly from Ani-Mime. (#86, @thanh-dong)

### Changed
- **GitHub release notes are now auto-generated from merged PRs** via `gh release create --generate-notes`. The release page shows a "What's Changed" list linking every PR + author since the previous tag, plus a "Full Changelog" compare link. `CHANGELOG.md` remains the curated long-form history.

## [0.16.2] - 2026-04-18

### Fixed
- **Claude Code session detection for the new `claude.exe` binary** — newer Claude Code releases ship a compiled single-file binary named `claude.exe` (with `claude` as a PATH symlink). `proc_scan` was still matching only `"claude"`, so on the owning shell's row the claude icon disappeared, the label showed `"claude.exe"`, and the claude session was dropped as a zombie every 2s — making the pet's busy/idle mirror flap instead of sticking on busy while Claude worked. `is_claude()` now matches both `"claude"` and `"claude.exe"`.
- **`ssh` classified as a service** — long-running SSH sessions were stuck on `busy` for the full connection, keeping the pet visually working the entire time. `ssh` now flashes service then returns to idle, matching `dev` / `serve` / `watch` etc.

### Added
- **`DEV` badge over the mascot** when running via `bun run tauri dev`. The badge is driven by Vite's build-time `import.meta.env.DEV` flag, so it tree-shakes out of release builds — zero visual change for installed-app users. Makes it easy to tell the running dev build apart from the installed `/Applications/Ani-Mime.app` at a glance.

## [0.16.1] - 2026-04-15

### Added
- **Session List Dropdown** — Click the status pill to see every open terminal grouped by project path. Each row shows state (busy / idle / service), foreground command, and a Claude Code badge when `claude` is running inside.
- **Click-to-Focus** — Click any shell row to jump directly to that terminal tab. Supports iTerm2 and Terminal.app (tab-precise via AppleScript), VS Code / Cursor (window focus via Accessibility), tmux (pane switch via CLI), plus Warp / WezTerm / kitty / Alacritty / Hyper / Ghostty (activation only).
- **OS Process Scanner** — 2-second `libproc` scan auto-discovers shells without needing the zsh hook, enriches pwd / tty / foreground command, detects running Claude Code instances, and removes zombie sessions immediately.
- **Per-Claude Session Tracking** — Claude Code hooks migrated from shared `pid=0` to `pid=$PPID`, so each Claude tab has its own session. Existing `~/.claude/settings.json` hooks are auto-migrated on every startup.
- **Session List toggle** in Settings (enabled by default) — lets users opt out of the feature.
- **`QuangHo0911`** added to the contributors grid on the About page.

### Fixed
- **Neon-glow clipping** — busy-state pulse was cut off at the window edge; container now reserves padding to fit the glow.
- **Effect toggle init flash** — disabled effects (e.g. Shadow Clone) briefly appeared "on" when reopening Settings. Hook now uses a module-level cache to start from the persisted value on every mount.
- **Tray is locked on while "Hide from Dock" is enabled** — prevents losing all access to Settings when both would be off.
- **Session list updates live while open** (hybrid `status-changed` event + 3s fallback poll) — no close/reopen required.

### Changed
- Shell hook scripts (zsh / bash / fish) now send `pwd` and `tty` via `curl -G --data-urlencode` for safe URL encoding and include them on every `/status` and `/heartbeat`.
- `/status` and `/heartbeat` return `410 Gone` when the PID isn't a live process — prevents orphaned heartbeat subshells from resurrecting dead sessions.
- Services shown in the session list keep their service color for the entire lifetime of the dev server (not just the 2s watchdog window).
- macOS menu bar no longer shows the Edit submenu.

### Docs
- Added a "Session List & Click-to-Focus" section to README with the full terminal-app support matrix.
- Updated `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/state-management.md`, `docs/http-api.md`, `docs/events-reference.md`, `docs/project-structure.md`, and `docs/shell-integration.md` to reflect the new modules, fields, events, Tauri commands, HTTP params, and terminal-app support matrix.

## [0.15.5] - 2026-04-14

### Added
- **MCP Server** — Claude Code can now interact with your desktop pet via Model Context Protocol (MCP) tools
  - `pet_say` — trigger a speech bubble with a custom message
  - `pet_react` — play a temporary reaction animation (celebrate, nervous, confused, excited, sleep)
  - `pet_status` — query the pet's current status, uptime, visitors, and nearby peers
- Zero-dependency Node.js MCP server (`server.mjs`) using JSON-RPC 2.0 over stdio
- MCP server auto-installed to `~/.ani-mime/mcp/` on every app launch (keeps up-to-date)
- MCP server auto-registered in `~/.claude.json` during first-launch Claude Code setup
- Manual setup: `claude mcp add ani-mime -- node ~/.ani-mime/mcp/server.mjs`
- New HTTP endpoints: `POST /mcp/say`, `POST /mcp/react`, `GET /mcp/pet-status`
- New Tauri events: `mcp-say` (speech bubble), `mcp-react` (temporary animation override)
- `pet`, `nickname`, `started_at` fields added to `AppState` for MCP status reporting
- **Smart Import frame selection** — preserve frame order and support directional ranges
- **Local Network permission** — request button in Settings for network access

### Fixed
- Shadow clone effect now works on custom mascots

## [0.15.4] - 2026-04-14

### Added
- **Pluggable effect system** — modular architecture for visual effects on the mascot
- **Shadow Clone animation** — Naruto-style kage bunshin effect triggered on busy status
- **Editable Smart Import** — re-edit previously imported custom mimes instead of starting from scratch
- **Smart Import metadata persistence** — source sheet and frame inputs saved for later editing
- **Source sheet cleanup** — deleting a custom mime also removes its source sheet file

### Changed
- Sprite animation engine upgraded from strip-only to 2D grid sheet support via `requestAnimationFrame`

### Fixed
- Dark outline artifact on transparent window after shadow-clone effect restores window shadow
- `smartImportMeta` preserved through manual editor path
- `arrayBuffer` rejection properly propagated in Smart Import canvas encoder

### Tests
- Smart Import edit-mode smoke tests and e2e round-trip assertions

## [0.15.3] - 2026-04-13

### Added
- **Log file reader** — replace in-memory log buffer with log file tail-reader; LogViewer updated for file-based format with source and debug level
- **SmartImport UX improvements** — direct file picker, auto-preview on blur, frame thumbnails with numbered overlays
- **Reveal in Finder** button in Superpower log toolbar to open the log directory
- **Show in Menu Bar** toggle in Settings to control tray icon visibility

### Changed
- Log level filter buttons replaced with compact dropdown select in Superpower toolbar

### Performance
- Tail-read log file instead of loading entirely — seeks to end and reads only the last N x 256 bytes

### Fixed
- Orphaned CSS block in `superpower.css` causing PostCSS parse error

### Tests
- SmartImport Charlotte flow with frame selection (e2e)
- Charlotte export with real sprite fixtures (e2e)
- Delete and re-import Charlotte via `.animime` file (e2e)
- Window auto-resize to fit sprite content (e2e)
- Split delete and import mime into separate tests (e2e)

### Docs
- Add e2e run guidance and tauri mock reference to CLAUDE.md

## [0.15.2] - 2026-04-12

### Fixed
- **Peer discovery broken in release builds** — added macOS entitlements (`Entitlements.plist`) for network access; Tauri's ad-hoc signing doesn't embed entitlements, so a post-build re-sign step is now required
- **Visitor collision when peers share a nickname** — visitors are now keyed by `instance_name` (unique per process) instead of `nickname`
- **Silent discovery failure** — mDNS daemon, registration, and browse errors now emit a `discovery-error` event to the frontend instead of failing silently
- **Log viewer overflow** — last rows in Superpower log viewer were clipped by container overflow

### Added
- **Menu Bar Tray Icon** — always-visible system tray icon; left-click toggles mascot window, right-click shows menu (Show, Settings, Quit)
- **Hide from Dock** — toggle in Settings to remove app from Dock and Cmd+Tab switcher via `ActivationPolicy`, persisted across restarts
- `src-tauri/Entitlements.plist` — macOS Hardened Runtime entitlements for network client/server, JIT, and library validation
- `bundle.macOS` config in `tauri.conf.json` — explicit entitlements and Info.plist references
- `src-tauri/script/post-build-sign.sh` — re-signs the .app with entitlements and re-creates the DMG after `tauri build`
- `src-tauri/script/install-mac.sh` — installer script for users receiving the app without notarization (removes quarantine)
- Peer visit troubleshooting section in README

### Changed
- Visit protocol now includes `instance_name` field in `/visit` and `/visit-end` request bodies (backward-compatible: falls back to `nickname` for older peers)
- `VisitingDog` struct has new `instance_name` field
- `visitor-arrived` and `visitor-left` events include `instance_name`
- Release workflow updated with post-build entitlement signing step

## [0.15.0] - 2026-04-12

### Added
- **Custom Mime Creator** — create your own mimes with per-status PNG sprites, frame range expressions (e.g. `1-5`, `41-55,57,58`), and auto frame detection from image dimensions
- **Smart Import** — auto-split sprite sheets into individual frames, assign frames to statuses, with chroma key background removal
- **Custom Mime Editing** — edit button on hover to rename or change sprites/frame ranges on existing custom mimes
- **Animation Preview** — click Preview to see animated sprite in a popup instead of static thumbnails
- **.animime Export/Import** — export custom mimes as self-contained `.animime` files for sharing; import to restore them locally
- **Display Scale** — Tiny / Normal / Large / XL size presets for the mascot sprite
- **Auto-resize Window** — window boundary matches visible content (sprite + pill + bubble)
- **Start at Login** — toggle in Settings to launch Ani-Mime on macOS login
- **Auto Update** — toggle in Settings, auto close and relaunch after update
- **Persistent File Logging** — logs written to disk via tauri-plugin-log with rotation (3 files, 1MB max)
- **Bubble Test Scenario** — "Free + Bubble" and "Long Bubble" in Pet Status scenario with persistent bubbles
- **DEV Tag Toggle** — toggle in Superpower toolbar to show/hide the DEV tag
- **Guide PDF** — "Read the guide" link in Create Your Own section
- **New contributor** — setnsail added to the About page
- **E2E tests** — Playwright test suite for app startup, statuses, bubbles, scenarios, settings, and custom sprites
- **Unit tests** — Vitest tests for all hooks and components with full Tauri mock layer
- **C3 architecture docs** — system context, container breakdowns, and component details

### Changed
- Removed Genjuro from built-in sprite roster
- Save button in custom mime forms always enabled — shows red validation errors instead of being disabled
- Refactored documentation: consolidated guides, added new references

### Fixed
- Zsh and bash job notifications from terminal-mirror hook
- Visible window boundary at large sprite scales
- Sprite sheets read via FS plugin instead of asset protocol
- Status pill glow shadow no longer clipped by window auto-resize

## [0.14.19] - 2026-04-10

### Added
- **Dialog Preview scenario**: New scenario in Superpower Tool to preview all native macOS dialogs and speech bubbles without side effects (update alerts, setup dialogs, bubbles)

### Changed
- **Native update dialog**: Replaced in-app update banner with native macOS alert dialog (Later / Changelog / Update Now)
- **Check for Updates menu**: Added "Check for Updates..." item to the macOS menu bar for manual update checks

## [0.14.16] - 2026-04-09

### Added
- **New contributor**: thanh-dong added to the About page

### Fixed
- Peer detection not working in release mode on macOS (added Info.plist with Bonjour networking entitlements)
- Unused variable in UpdateBanner causing CI build failure
- Version display in Settings now shows correct version

## [0.14.15] - 2026-04-08

### Added
- **In-app update checker**: Background check for new GitHub releases with dismissible update banner
- **Auto-dismiss speech bubble**: Bubble hides automatically when status transitions to busy or service

### Changed
- Claude Code setup dialog only appears when CLI is installed — no more prompt when Claude is not found
- Friendlier Claude Code setup dialog copy describing real-time mascot reactions

### Fixed
- Claude Code hooks no longer error when Ani-Mime is not running (silent fail with `--max-time 1`)

## [0.14.12] - 2026-04-08

### Added
- **Mime tab**: Dedicated settings tab for character selection with categorized grid (Pet, Character) and nickname input with save button
- **Samurai & Hancock**: Two new character sprites with full animation sets
- **Glow modes**: Glow effect upgraded from toggle to 3-mode selector (Off / Light / Dark)
- **Contributors section**: About page now shows contributors with GitHub avatars and a thank-you message
- `MimeCategory` type system for organizing mimes into extensible categories

### Changed
- Pet selection moved from General to its own Mime sidebar tab
- Pet grid now displays 4 items per row with compact card sizing
- Author and Twitter combined into a single row in About
- Nickname input now requires explicit Save button instead of saving on every keystroke

### Fixed
- Hancock sleep sprite: use single-frame image instead of multi-frame reference
- Peer discovery on macOS with enhanced diagnostic logging

## [0.14.3] - 2026-04-08

### Added
- **Superpower Tool**: Hidden devtool (easter egg) with sidebar menu layout, activated by clicking version text 10 times in Settings > About
- **Log viewer**: Real-time in-app log viewer with info/warn/error levels, text search, level filtering, color-coded module tags, and auto-scroll
- **Scenarios**: Visual testing mode that overrides mascot state — Pet Status scenario with buttons for all 7 statuses
- Global logger with `app_log!`/`app_warn!`/`app_error!` macros and 1000-entry ring buffer
- Comprehensive error handling and logging across all backend modules (discovery, server, watchdog, setup, state, platform)
- "SCENARIO" badge on mascot during test mode, "DEV" tag below status pill when dev mode is active
- Dev mode is session-only — resets on app restart

## [0.14.2] - 2026-04-08

### Fixed
- Peer discovery now advertises local IP and accepts external connections

## [0.14.1] - 2026-04-07

### Fixed
- Center mascot, status pill, and speech bubble within main window
- Settings content area now scrollable when content overflows

## [0.14.0] - 2026-04-07

### Added
- **Peer Visits**: Pets can visit each other across the local network via mDNS discovery
- mDNS-based peer discovery using `mdns-sd` crate
- `/visit` and `/visit-end` HTTP routes for cross-machine pet communication
- `VisitorDog` component with slide-in animation for visiting pets
- Right-click context menu to select which peer to visit
- Nickname setting for peer identity in Settings
- New "visiting" status type with purple dot indicator
- Configurable HTTP port via `ANI_MIME_PORT` environment variable
- Visitor watchdog for automatic cleanup of stale visits

### Fixed
- Handle hostname returning IP instead of proper hostname

### Changed
- Main window widened to accommodate visiting dogs

## [0.13.25] - 2026-04-07

### Added
- Speech bubble notifications on task completion with random fun messages
- Welcome bubble greeting on first "Free" status after app launch
- Neon glow effects on status pill: green pulse on task done, red pulse when busy
- Idle-to-sleep countdown: pet sleeps after 2 minutes of inactivity, wakes on real work
- Speech bubble toggle in Settings > General > Behavior with macOS-style switch
- Theme-aware bubble styling (grey bubble in dark mode, white in light mode)
- `busy_since` tracking for task duration measurement
- `task-completed` Tauri event emitted on busy→idle transition

### Fixed
- Claude Code (pid=0) sessions no longer expire prematurely during long tasks
- Heartbeats now keep busy sessions alive (long-running commands stay as "Working...")
- Fixed "Initializing..." flashing to "Sleep" on first app launch
- Widened mascot window (140→200px) to prevent speech bubble text clipping

### Changed
- Mascot window size increased to 200x190 for bubble space
- Status pill vertical padding reduced (8→6px) for tighter layout
- Added spacing between mascot and status pill

## [0.13.19] - 2026-04-04

### Added
- Native macOS menu bar with About, Settings (Cmd+,), and Quit
- Settings window with sidebar navigation (General, About)
- Dark/light theme toggle for status pill via CSS custom properties
- Pet selection: choose between Rottweiler and Dalmatian
- Dalmatian pixel art sprites (idle, bark, sniff, sit, sleep)
- Preferences persistence via tauri-plugin-store (theme + pet survive restarts)
- Cross-window real-time sync for theme and pet changes
- About page with app info, author, and Twitter link

### Changed
- Mascot window fitted to content size (140x175)
- Status pill colors now driven by CSS variables for theming
- Vite configured for multi-page build (main + settings)

### Fixed
- Opt out of macOS Sequoia window tiling/snapping via NSWindowCollectionBehavior

## [0.2.17] - 2026-04-03

### Fixed
- Setup dialogs only show on first launch — no more repeated prompts on every app open
- App now restarts automatically after first-time setup completes

### Added
- "Setup complete" dialog telling users to open a new terminal tab for tracking to take effect
- `~/.ani-mime/setup-done` marker file to track initialization state (delete to re-run setup)

## [0.2.14] - 2026-04-01

### Added
- Multi-shell support: zsh, bash, and fish
- Smart shell detection with multi-select dialog when 2+ shells are installed
- App quits if user skips setup with no shell configured
- Native macOS setup dialogs (osascript) for first-time configuration
- Claude Code hooks setup dialog (Yes/Skip for both installed and not installed)
- Auto-setup on first launch: injects hooks into shell RC files and Claude Code settings

## [0.2.11] - 2026-04-01

### Changed
- New pixel art cat app icon

## [0.2.0] - 2026-04-01

### Added
- Animated Rottweiler pixel art sprites for each status
  - Sniffing (busy/working)
  - Barking (service/dev server)
  - Sitting (idle/free)
  - Sleeping (disconnected/sleep)
  - Idle (searching/initializing)
- Auto-freeze idle and sleep animations after 10 seconds
- "Initializing..." status with orange pulse for first-time setup
- Disable window shadow
- Show on all macOS workspaces/Spaces
- Bundle shell scripts as Tauri resources

## [0.1.0] - 2026-04-01

### Added
- Initial release
- Floating status pill UI (always-on-top, transparent, draggable)
- Manual Tagging + Heartbeat architecture (no process tree scanning)
- Zsh terminal tracking via preexec/precmd hooks
- Claude Code integration via hooks (PreToolUse, Stop, etc.)
- Multi-session support with priority resolution (busy > service > idle)
- Watchdog for stale session cleanup (40s heartbeat timeout)
- Service command auto-detection (start, dev, serve, watch, metro, etc.)
- Claude alias detection via `whence` (works with any alias)
- GitHub Actions CI for macOS builds (arm64 + x86_64)
- Homebrew Cask distribution
- Debug endpoint (`/debug`) for session inspection
