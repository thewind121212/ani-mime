# Project Structure

Complete file tree with responsibilities for every file in the codebase.

## Root

```
ani-mime/
├── CLAUDE.md                  # Developer quick reference (read by Claude Code)
├── CHANGELOG.md               # Version history
├── README.md                  # User-facing documentation
├── package.json               # Frontend dependencies + scripts
├── bun.lock                   # Bun lockfile
├── tsconfig.json              # TypeScript config (frontend)
├── tsconfig.node.json         # TypeScript config (build tools)
├── vite.config.ts             # Vite bundler (multi-entry: main, settings, superpower)
├── index.html                 # Main window HTML entry
├── settings.html              # Settings window HTML entry
├── superpower.html            # Developer tool HTML entry
├── .gitignore                 # Git exclusions
└── .github/workflows/
    └── release.yml            # CI: build on tag push, create GitHub release
```

## Frontend (`src/`)

```
src/
├── main.tsx                   # ReactDOM mount → App
├── settings-main.tsx          # ReactDOM mount → Settings
├── superpower-main.tsx        # ReactDOM mount → SuperpowerTool
├── vite-env.d.ts              # Vite type declarations
│
├── components/
│   ├── Mascot.tsx             # Animated sprite (128x128), auto-freeze logic
│   ├── StatusPill.tsx         # Colored dot + label, neon glow effects
│   ├── SpeechBubble.tsx       # Floating message bubble with dismiss
│   ├── VisitorDog.tsx         # Peer's visiting dog sprite (96x96)
│   ├── DevTag.tsx             # Purple dev mode button → opens superpower
│   ├── Settings.tsx           # Settings window (General/Mime/About tabs)
│   ├── SuperpowerTool.tsx     # Dev tools (log viewer + scenarios)
│   └── scenarios/
│       ├── ScenarioViewer.tsx         # Scenario list/runner
│       ├── PetStatusScenario.tsx      # Test all 7 status states
│       ├── DialogPreviewScenario.tsx  # Preview native dialogs
│       └── registry.ts               # Scenario definitions
│
├── hooks/
│   ├── useStatus.ts           # Tauri "status-changed" + "dog-away" + "scenario-override"
│   ├── useDrag.ts             # Window drag via Tauri startDragging()
│   ├── useBubble.ts           # Speech bubble visibility + messages
│   ├── useVisitors.ts         # "visitor-arrived" / "visitor-left" events
│   ├── usePeers.ts            # "peers-changed" event → PeerInfo[]
│   ├── useTheme.ts            # Persistent theme (dark/light) + cross-window sync
│   ├── usePet.ts              # Persistent pet selection + cross-window sync
│   ├── useNickname.ts         # Persistent nickname + cross-window sync
│   ├── useGlow.ts             # Persistent glow mode (off/light/dark)
│   └── useDevMode.ts          # Session-only dev mode flag
│
├── constants/
│   └── sprites.ts             # Sprite registry: character → status → {file, frames}
│
├── types/
│   └── status.ts              # Status, Pet, Theme, GlowMode, SpriteConfig, PetInfo
│
├── styles/
│   ├── theme.css              # CSS variables for dark/light themes
│   ├── app.css                # Root layout, drag cursor, scenario badge
│   ├── mascot.css             # Sprite animation keyframes, glow effects
│   ├── status-pill.css        # Dot colors, pulse animations, neon glow
│   ├── speech-bubble.css      # Bubble shape, pop-in animation
│   ├── visitor.css            # Visitor slide-in, mirror, stagger
│   ├── dev-tag.css            # Dev button styling
│   ├── settings.css           # Settings layout, tabs, toggles, pet grid
│   └── superpower.css         # Log viewer, scenario grid, tag colors
│
└── assets/
    └── sprites/
        ├── rottweiler/        # Rottweiler PNG sprite sheets
        ├── dalmatian/         # Dalmatian PNG sprite sheets
        ├── samurai/           # Samurai PNG sprite sheets
        └── hancock/           # Hancock PNG sprite sheets
```

## Backend (`src-tauri/`)

```
src-tauri/
├── Cargo.toml                 # Rust dependencies
├── Cargo.lock                 # Rust lockfile
├── build.rs                   # Tauri build script
├── tauri.conf.json            # Window config, bundle resources, app metadata
├── Info.plist                 # macOS app metadata
│
├── src/
│   ├── main.rs                # Binary entry (#![cfg_attr(not(debug), windows_subsystem)])
│   ├── lib.rs                 # Tauri setup: plugins, commands, menu, state init, thread spawns
│   ├── state.rs               # AppState, Session, PeerInfo, VisitingDog, resolve_ui_state()
│   ├── server.rs              # HTTP server: /status, /heartbeat, /visit, /visit-end, /debug
│   ├── watchdog.rs            # Background thread: service→idle, stale cleanup, sleep mode
│   ├── discovery.rs           # mDNS peer discovery (register, browse, resolve)
│   ├── helpers.rs             # Utilities: now_secs(), get_port(), get_query_param()
│   ├── logger.rs              # Global log buffer + app_log!/app_warn!/app_error! macros
│   ├── updater.rs             # GitHub release checker + native update dialog
│   ├── setup/
│   │   ├── mod.rs             # auto_setup() orchestrator, setup-done marker
│   │   ├── shell.rs           # Shell detection, RC file injection, dialog prompts
│   │   └── claude.rs          # Claude Code hooks config + migration
│   └── platform/
│       ├── mod.rs             # Platform module re-exports
│       └── macos.rs           # NSWindow transparency, workspace visibility, tiling opt-out
│
├── script/
│   ├── terminal-mirror.zsh    # Zsh: preexec/precmd hooks, heartbeat, classification
│   ├── terminal-mirror.bash   # Bash: DEBUG trap + PROMPT_COMMAND, heartbeat
│   ├── terminal-mirror.fish   # Fish: fish_preexec/postexec events, heartbeat
│   ├── tauri-hook.sh          # Claude Code integration hook
│   └── install-hook.sh        # Manual hook installation helper
│
├── icons/                     # App icons (all platforms/sizes)
│   ├── icon.icns              # macOS
│   ├── icon.ico               # Windows
│   ├── icon.png               # Generic
│   ├── 32x32.png ... 512x512@2x.png  # Various sizes
│   └── ios/                   # iOS icon variants
│
└── capabilities/
    └── default.json           # Tauri permission capabilities
```

## Documentation (`docs/`)

```
docs/
├── ARCHITECTURE.md            # System overview, tech stack, design decisions
├── project-structure.md       # Complete file tree with responsibilities (this file)
├── state-management.md        # AppState, hooks, state machine, threading
├── events-reference.md        # All Tauri events (backend↔frontend)
├── http-api.md                # HTTP endpoint reference
├── animation-system.md        # Sprite format, CSS engine, adding characters
├── theming.md                 # Theme system, CSS variables, colors
├── conventions.md             # Coding rules, naming, patterns
├── constants-reference.md     # All magic numbers, timeouts, config values
├── adding-features.md         # Step-by-step recipes for common additions
├── shell-integration.md       # Shell hook details per shell
├── setup-flow.md              # First-launch auto-setup flow
├── peer-discovery.md          # mDNS discovery, visit protocol
├── assets/
│   ├── design.png             # Mascot states visual diagram
│   └── demo.gif               # Animated demo
└── plans/
    ├── 2026-04-07-peer-visits-design.md   # Peer visits feature design
    └── 2026-04-07-peer-visits-plan.md     # Peer visits implementation plan
```

## Key Relationships

```
Shell scripts ──curl──► server.rs ──mutex──► state.rs ──emit──► useStatus.ts ──► Mascot.tsx
                                                                                      │
                                                                    sprites.ts ◄──────┘
                                                                        │
                                                                  mascot.css (animation)

Settings.tsx ──Store──► settings.json ──event──► useTheme/usePet/... ──► App.tsx

discovery.rs ──mDNS──► peers ──event──► usePeers.ts ──► context menu
                                                              │
                                                    start_visit command
                                                              │
                                              lib.rs ──HTTP──► peer's server.rs
```
