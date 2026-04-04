# Shell Integration

Shell hooks are the primary way ani-mime detects terminal activity. Each supported shell has a script that hooks into command execution lifecycle.

## Supported Shells

| Shell | Script | Hook Mechanism |
|-------|--------|----------------|
| zsh | `terminal-mirror.zsh` | `add-zsh-hook preexec/precmd` |
| bash | `terminal-mirror.bash` | `PROMPT_COMMAND` + `trap DEBUG` |
| fish | `terminal-mirror.fish` | `fish_preexec` / `fish_postexec` |

## How It Works

### 1. Command Classification

Before a command executes, the hook classifies it:

**Service commands** (long-running dev servers):
```
start, dev, serve, watch, metro, docker-compose, docker compose, up,
run dev, run start, run serve
```

Regex (zsh): `(^|[[:space:]/])(start|dev|serve|watch|...)([[:space:]]|$)`

**Examples:**
| Command | Type | Why |
|---------|------|-----|
| `yarn start` | service | matches "start" |
| `npm run dev` | service | matches "run dev" |
| `bun dev` | service | matches "dev" |
| `vite` | task | no keyword match |
| `git push` | task | no keyword match |
| `make build` | task | no keyword match |

### 2. Claude Code Exclusion

Commands starting with `claude` (or aliases resolving to claude) are skipped entirely. Claude Code has its own hook system that reports directly to ani-mime.

### 3. Hooks

| Event | Signal Sent | Purpose |
|-------|-------------|---------|
| **preexec** (before command) | `/status?pid=$$&state=busy&type={task\|service}` | Mark terminal as working |
| **precmd** (after command) | `/status?pid=$$&state=idle` | Mark terminal as free |

### 4. Heartbeat

A background loop runs once per shell session:

```bash
while true; do
  curl -s --max-time 2 "http://127.0.0.1:1234/heartbeat?pid=$$" > /dev/null 2>&1
  sleep 20
done
```

- Proves the shell is still alive
- Uses PID guard (`$_TM_HEARTBEAT_PID`) to prevent duplicate loops
- Cleaned up on shell exit via `trap EXIT`

## Installation

Hooks are installed by the auto-setup flow (see [Setup Flow](./setup-flow.md)).

The setup appends a `source` line to the shell's RC file:

```bash
# --- Ani-Mime Terminal Hook ---
source "/path/to/terminal-mirror.zsh"
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TAURI_MIRROR_PORT` | `1234` | Port for HTTP communication |
| `_TM_URL` | Derived from port | Base URL for curl requests |
| `_TM_HEARTBEAT_PID` | Set automatically | PID of heartbeat background job |

## Adding a New Shell

1. Create `terminal-mirror.{shell}` in `src-tauri/script/`
2. Implement: preexec equivalent, precmd equivalent, heartbeat loop
3. Add `ShellInfo` entry in `setup/shell.rs`
4. Add the script to Tauri resource bundling in `tauri.conf.json`
