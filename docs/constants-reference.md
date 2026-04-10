# Constants & Configuration Reference

All hardcoded values, timeouts, and configurable parameters in the codebase.

## Backend Constants (Rust)

### Timing

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| `HEARTBEAT_TIMEOUT_SECS` | 40 | `watchdog.rs` | Remove session if no heartbeat for this long |
| `SERVICE_DISPLAY_SECS` | 2 | `watchdog.rs` | How long service state shows before auto-transitioning to idle |
| `IDLE_TO_SLEEP_SECS` | 120 | `watchdog.rs` | Idle duration before entering sleep mode (suppresses emits) |
| `VISIT_DURATION_SECS` | 15 | `lib.rs` | How long a dog visit lasts |
| Watchdog tick | 2s | `watchdog.rs` | Background thread check interval |
| Discovery heartbeat | 30s | `discovery.rs` | Peer count check and hint interval |
| Update check delay | 3s | `updater.rs` | Delay before first background update check |

### Networking

| Value | File | Purpose |
|-------|------|---------|
| Default port: `1234` | `helpers.rs` | HTTP server port (overridable via `ANI_MIME_PORT` env var) |
| Bind address: `0.0.0.0` | `server.rs` | Listen on all interfaces (for peer visits) |
| mDNS service: `_ani-mime._tcp.local.` | `discovery.rs` | Service type for peer discovery |
| curl timeout: `1s` | shell scripts | `--max-time 1` on all curl calls |

### Limits

| Value | File | Purpose |
|-------|------|---------|
| Max log entries: `1000` | `logger.rs` | Ring buffer size, oldest dropped on overflow |
| Nickname max length: `20` | `useNickname.ts` | Character limit for display names |

### Special Values

| Value | Meaning | File |
|-------|---------|------|
| PID `0` | Claude Code virtual session | `server.rs`, `watchdog.rs` |
| `/tmp/tauri-heartbeat-{pid}` | Heartbeat PID guard file | shell scripts |
| `/tmp/tauri-shell-pid` | Claude Code PID bridge | `tauri-hook.sh` |
| `~/.ani-mime/setup-done` | First-launch marker | `setup/mod.rs` |

## Frontend Constants (TypeScript)

### Animation

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| Frame size | 128px | `Mascot.tsx` | Sprite frame width and height |
| Frame duration | 80ms | `Mascot.tsx` | Milliseconds per animation frame |
| Freeze delay | 10,000ms | `Mascot.tsx` | Auto-freeze after idle/disconnected |
| Visitor frame size | 96px | `VisitorDog.tsx` | Smaller sprite for visitors |
| Visitor spacing | 80px | `VisitorDog.tsx` | Horizontal offset between visitors |

### UI

| Constant | Value | File | Purpose |
|----------|-------|------|---------|
| `BUBBLE_DURATION_MS` | 7,000 | `useBubble.ts` | Auto-dismiss speech bubble timeout |
| Log poll interval | 1,000ms | `SuperpowerTool.tsx` | Log viewer refresh rate |
| Dev mode clicks | 10 | `Settings.tsx` | Clicks on version to enable dev mode |

### Tauri Store Keys

| Key | Type | Default | Hook |
|-----|------|---------|------|
| `"theme"` | `"dark" \| "light"` | `"dark"` | `useTheme` |
| `"pet"` | `Pet` | `"rottweiler"` | `usePet` |
| `"nickname"` | `string` | `""` | `useNickname` |
| `"glowMode"` | `GlowMode` | `"off"` | `useGlow` |
| `"bubbleEnabled"` | `boolean` | `true` | `useBubble` |
| `"skippedVersion"` | `string` | `""` | `updater.rs` |

## Window Configuration (`tauri.conf.json`)

| Window | Size | Decorations | Always on Top | Visible |
|--------|------|-------------|---------------|---------|
| main | 500x220 | No | Yes | Yes |
| settings | 620x440 | Yes | No | Hidden |
| superpower | 800x500 | Yes | No | Hidden |

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ANI_MIME_PORT` | Override HTTP server port | `1234` |

## Shell Hook Classification

Commands matching these patterns are classified as "service" (otherwise "task"):

```regex
(start|dev|serve|watch|metro|docker-compose|docker compose|up|run dev|run start|run serve)
```

Defined in each `terminal-mirror.{zsh,bash,fish}` script.
