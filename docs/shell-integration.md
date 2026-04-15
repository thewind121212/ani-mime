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

All hooks go through a single `_tm_send` helper that uses `curl -G --data-urlencode` (instead of naive string concatenation) so paths with spaces/special characters don't break the URL.

| Event | Signal Sent | Purpose |
|-------|-------------|---------|
| **preexec** (before command) | `/status?pid=$$&state=busy&type={task\|service}&title=...&pwd=...&tty=...` | Mark terminal as working |
| **precmd** (after command) | `/status?pid=$$&state=idle&title=...&pwd=...&tty=...` | Mark terminal as free |

**Parameters always included:**

| Param | Source | Purpose |
|-------|--------|---------|
| `pid` | `$$` (zsh/bash) / `$fish_pid` (fish) | Shell process ID |
| `title` | `${PWD##*/}` / `(basename $PWD)` | Directory basename |
| `pwd` | `$PWD` | Full working directory — used by the Session List to group sessions by project |
| `tty` | `$TTY` (zsh) / `$(tty)` (bash/fish) | Controlling terminal device, e.g. `/dev/ttys001` — used for precise tab focus |

### 4. Heartbeat

A background loop runs once per shell session:

```bash
while true; do
  _tm_send /heartbeat   # via -G --data-urlencode with pid, title, pwd, tty
  sleep 20
done
```

- Proves the shell is still alive
- Uses PID guard (`$_TM_HEARTBEAT_PID`) to prevent duplicate loops
- **Re-sourcing the script restarts the heartbeat** — if `$_TM_HEARTBEAT_PID` is already set, the old subshell is killed and a fresh one is spawned with the current script body. This lets users pick up script changes via `source ~/.zshrc` without opening a new tab
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
