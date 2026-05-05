# Claude Code Hook Mirror Fix — Stdin-Aware Wrapper Script

**Date:** 2026-05-05
**Branch (suggested):** `fix/claude-hook-mirror`
**Status:** Approved (design)

## Problem

ani-mime mirrors Claude Code's working/idle status by registering inline `curl` hooks in `~/.claude/settings.json`. With recent Claude Code versions, the mirror is incorrect:

1. **False idle / flicker during long sessions.** `SessionStart` now fires mid-turn with `source="compact"` whenever Claude auto-compacts. The current hook calls `state=idle` on every `SessionStart`, regardless of source — so the pill flips to **Free** while Claude is still **Working…**, then flicks back when the next `PreToolUse` fires.
2. **Stuck busy after a failed turn.** `StopFailure` (turn ends in error) is not subscribed; `Stop` doesn't fire on failure → busy stays.
3. **Stuck busy when Claude is waiting on the user.** `Notification` with `notification_type=permission_prompt` or `idle_prompt` is not subscribed → mirror stays **Working…** while Claude is actually idle waiting for input.

Inline curl one-liners cannot read the stdin JSON payload, so they cannot distinguish `SessionStart(startup)` from `SessionStart(compact)`, nor `Notification(permission_prompt)` from `Notification(auth_success)`.

## Goal

Mirror Claude Code's working/idle state correctly through every hook event the latest Claude Code emits, with low ongoing maintenance as Claude continues to add events.

## Non-Goals

- New UI states (no new "waiting-for-permission" pill — `permission_prompt` maps to existing **Free**).
- Changing the shell terminal-mirror scripts (`terminal-mirror.{zsh,bash,fish}`).
- Replacing the HTTP wire format (`/status?pid=&state=&type=`) — that contract stays.

## Approach — Stdin-aware Node hook script

Replace the inline curl commands with a single Node script that reads the stdin JSON payload Claude Code sends to every hook, then routes to the existing `:1234/status` endpoint with the right state.

Node is guaranteed available wherever Claude Code is installed (Claude Code itself runs on Node), so no new dependency.

### Architecture

```
src-tauri/script/ani-mime-hook.mjs   ← bundled resource (new)
        │ copied at every startup, like server.mjs
        ▼
~/.ani-mime/hooks/ani-mime-hook.mjs  ← installed location
        │ invoked by Claude Code per hook event
        ▼
~/.claude/settings.json hooks → "node ~/.ani-mime/hooks/ani-mime-hook.mjs"
        │ HTTP POST
        ▼
127.0.0.1:1234/status?pid=<claude_pid>&state=busy|idle&type=task
```

### Components

| File | Responsibility |
|---|---|
| `src-tauri/script/ani-mime-hook.mjs` (new) | Reads stdin JSON, decides state, posts to `:1234`. Zero dependencies. |
| `src-tauri/src/setup/hooks.rs` (new) | Installs the script to `~/.ani-mime/hooks/`. Mirrors `setup/mcp.rs`. Owns the canonical hook command string. |
| `src-tauri/src/setup/claude.rs` (modified) | Uses `setup::hooks::HOOK_COMMAND` instead of inline curl. Hook event list updated to include `StopFailure` and `Notification`. |
| `src-tauri/src/claude_config.rs` (modified) | `migrate_claude_hooks` upgrades existing users: replaces inline curl commands with the script command. |
| `src-tauri/tauri.conf.json` (modified) | Add `script/ani-mime-hook.mjs` to bundle resources. |
| `src-tauri/src/setup/mod.rs` (modified) | Call `hooks::install_hook_script(&home)` before `claude::setup_claude_hooks(&home)`. |

### Hook Script Behavior

`ani-mime-hook.mjs` reads stdin to EOF, parses JSON, and selects an action:

| `hook_event_name` | Condition | POST | UI label after |
|---|---|---|---|
| `PreToolUse` | always | `state=busy&type=task` | **Working…** |
| `UserPromptSubmit` | always | `state=busy&type=task` | **Working…** |
| `Stop` | always | `state=idle` | **Free** |
| `StopFailure` | always | `state=idle` | **Free** |
| `SessionStart` | `source` ∈ {`startup`, `resume`, `clear`} | `state=idle` | **Free** |
| `SessionStart` | `source == "compact"` | no-op | unchanged |
| `SessionEnd` | always | `state=idle` | **Free** |
| `Notification` | `notification_type` ∈ {`permission_prompt`, `idle_prompt`} | `state=idle` | **Free** |
| `Notification` | other types | no-op | unchanged |
| any other event | unknown | no-op (forward-compatible) | unchanged |

PID: `process.ppid` (the `node` process is a direct child of the `claude` binary — same semantics as today's `$PPID`).

### Error Handling

- All logic wrapped in try/catch. Any error → `process.exit(0)`. Hooks must never block Claude.
- HTTP request uses `AbortController` with 1000 ms timeout — matches today's `--max-time 1`.
- Stdout silent on success. Errors → `console.error` (Claude logs first stderr line in debug log).
- If stdin is empty or not JSON → exit 0 silently.
- If `hook_event_name` is missing or unknown → exit 0 silently.

### settings.json Layout (after install)

```json
{
  "hooks": {
    "PreToolUse":       [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \"$HOME/.ani-mime/hooks/ani-mime-hook.mjs\" || true" }] }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node \"$HOME/.ani-mime/hooks/ani-mime-hook.mjs\" || true" }] }],
    "Stop":             [...same...],
    "StopFailure":      [...same...],
    "SessionStart":     [...same...],
    "SessionEnd":       [...same...],
    "Notification":     [...same...]
  }
}
```

The `|| true` is kept so a missing/broken script never blocks Claude — same defense-in-depth as today.

The marker used to detect "this is an ani-mime hook" changes from `127.0.0.1:1234` to a stable token. Use `ani-mime-hook.mjs` as the new marker — it appears in every command line we own, never in commands we don't.

### Migration for Existing Users

`claude_config.rs::migrate_claude_hooks` runs on every startup. New behavior:

1. Walk every hook event in `~/.claude/settings.json`.
2. For each hook command containing `127.0.0.1:1234` (the legacy curl marker), **replace** it with the new node command string.
3. Remove the legacy hook entries entirely if duplicates exist (don't keep both).
4. Add hooks for any of the seven events that aren't already configured (handled by `setup_claude_hooks`).
5. Log applied migrations once per startup, deduped.

The migration is idempotent — safe on every startup. Already-migrated installations are no-ops.

### Setup Flow

`setup/mod.rs` orchestrator gains one step:

```
1. Install MCP server (existing)
2. Install hook script (new — copy from bundle to ~/.ani-mime/hooks/)
3. Configure Claude hooks (existing — now uses node command)
4. Migrate legacy hooks (existing — now also rewrites old curl commands)
5. Setup shell integration (existing)
```

### Logging

- `[setup] installed hook script to ~/.ani-mime/hooks/ani-mime-hook.mjs`
- `[setup] migrated claude hooks: legacy curl → node script (3 events)`
- Hook script itself is silent (no logs) — its work shows up as `[http] pid=N -> busy/idle` in the existing server log.

## Testing

**Manual smoke test (primary acceptance):**

1. Start Claude Code in a terminal where ani-mime is running.
2. Submit a long prompt that triggers tools. Pill should be **Working…** for the duration, never flicker.
3. Continue past the auto-compact threshold. When TUI shows "Compacted", pill must stay **Working…** (never flip to Free).
4. End turn. Pill goes **Free**.
5. Trigger a permission prompt (e.g., a tool needing approval). Pill should go **Free** while waiting.
6. Approve. Pill goes back to **Working…** for the next tool call.
7. Force a turn error (e.g., kill the API mid-response). Pill should still go **Free** (via StopFailure).

**Build check:**
- `cd src-tauri && cargo check` — must pass
- `npx tsc --noEmit` — must pass (no frontend type changes expected)

**Unit-test scope (none added):**
- The hook script is small and exercised by manual integration. Adding a test harness for stdin/HTTP would be larger than the script itself.

## Risks / Open Questions

- **Node startup latency.** A `node` cold start is ~50–80 ms vs. ~5 ms for curl. Hook fires per-tool-call. Acceptable budget — Claude Code's hook timeout default is 60 s. Will monitor; if it ever matters, a single long-running daemon could replace the per-invocation script (out of scope here).
- **`process.ppid` vs `$PPID`.** Should be identical for the `node` child of `claude`. If Claude Code ever wraps hook invocations in an extra `sh -c`, both `$PPID` and `process.ppid` would shift to the `sh` (which has `claude` as its parent). Both break the same way; no regression.
- **`Notification(idle_prompt)` semantics.** The docs label this as "Claude Code is idle and prompting user for input" — mapping to **Free** is correct. If a future variant of `idle_prompt` actually means something else, the table can be tightened.
- **`SessionStart(source=compact)` no-op.** If Claude ever fires this without an active session (corner case), the pill would stay at whatever state it was — including `disconnected`. The watchdog would then resolve it on the next `proc_scan` cycle (≤2 s). Acceptable.

## Out of Scope

- Adding a "waiting-for-permission" sub-state with its own sprite/label (could be a follow-up; the table above only uses existing states).
- Subscribing to richer events (`SubagentStart/Stop`, `PreCompact`, `PostToolBatch`) for analytics — not needed for mirror correctness.
- Replacing the HTTP wire format with a Unix socket — performance is fine.
