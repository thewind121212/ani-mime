# Claude Usage Popover on Status Dot Click

## Goal

Let users check their Claude Code usage and reset timers (the same info shown by `/usage` inside Claude Code) directly from ani-mime, by clicking the colored status dot in the StatusPill.

## UX

- Clicking the colored status dot opens a popover anchored below the dot.
- The popover displays the raw output of `claude /usage` in a monospace block, plus a refresh button.
- The popover closes on: ESC key, click outside, or a second click on the dot.
- The popover obeys the existing "only one overlay open at a time" rule: opening it closes the session list, chat, spotify, and peer popovers; opening any of those closes the usage popover.
- The current brief "Idle"/"Busy" status-tip text that flashes when clicking the dot is removed.

## Data source

`/usage` data is server-tracked and is only emitted by Claude Code's interactive REPL — `claude -p "/usage"` does **not** return it (slash commands aren't surfaced via `-p`, confirmed during brainstorming).

The chosen approach: spawn `claude` in a pseudo-terminal, send `/usage\n`, capture and strip ANSI from stdout, then terminate the process.

- Cache result for 30 seconds in `AppState` to avoid re-spawning on every popover open.
- Deduplicate in-flight requests: if a second click arrives while a fetch is in progress, both callers await the same future.
- Hard timeout of 10 seconds per fetch; on timeout, the child process is killed and an error is surfaced.

Tradeoffs accepted:
- Each fresh fetch takes ~2–5 seconds (cold pty + REPL boot). Cache hides this for subsequent opens.
- The scraped text is the exact display string Claude Code uses, so if Anthropic changes the format we still surface whatever Claude shows. No parsing layer to break.
- Risk: the pty approach may not work in all environments (e.g. sandboxed builds or if `claude` refuses non-tty stdin even via pty). If it fails in practice we fall back to one of two alternatives, both deferred:
  - Reverse-engineer the underlying HTTPS endpoint (`/usage` likely hits an authenticated Anthropic API). More reliable long-term, requires investigation of the OAuth token storage in `~/.claude`.
  - Local token-count estimation from `~/.claude/projects/*/sessions/` transcripts. Loses reset-time info.

## Architecture

### Backend (Rust)

New module `src-tauri/src/usage.rs`:

- `fetch_claude_usage_raw() -> Result<String, UsageError>` — spawns `claude` in a pty (via the `portable-pty` crate), writes `/usage\n`, reads stdout until a quiescent period (no new bytes for ~500ms) or the 10-second timeout, sends `/exit\n` (and kills the child if it doesn't exit cleanly), strips ANSI escape codes, returns the cleaned text.
- `strip_ansi(input: &str) -> String` — pure helper.
- `UsageCache { text: String, fetched_at: u64 }` — stored on `AppState` behind the same `Arc<Mutex<…>>` as other shared state.
- `get_or_fetch_usage(state, force_refresh) -> Result<UsageResult, String>` — returns cached value if fresh (≤30s) and `force_refresh` is false; otherwise performs a fetch, deduplicating concurrent calls via an `Arc<tokio::sync::Mutex<Option<Shared<Future>>>>` or equivalent.
- `UsageError` variants: `CliNotFound`, `Timeout`, `Spawn(String)`, `Parse(String)`. Converted to user-facing strings at the command boundary.

New Tauri command in `lib.rs`:

```rust
#[tauri::command]
async fn get_claude_usage(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    force_refresh: bool,
) -> Result<UsageResult, String>
```

Returns `{ text: String, fetched_at: u64 }`.

New `Cargo.toml` dependency: `portable-pty = "0.8"` (or current version) in `src-tauri/`.

### Frontend (React)

New hook `src/hooks/useClaudeUsage.ts`:

- API: `const { data, loading, error, refresh } = useClaudeUsage({ enabled });`
- When `enabled` flips to true (popover opens), invokes `get_claude_usage` once.
- `refresh()` invokes with `force_refresh: true`.
- Does not poll.

New component `src/components/UsagePopover.tsx`:

- Props: `{ open: boolean; onClose: () => void; anchorRef: RefObject<HTMLElement>; }`
- Renders a popover anchored under `anchorRef`. Layout follows the existing session-list popover.
- Loading state: small spinner + "Checking usage…".
- Success state: monospace `<pre>` block with the scraped text + a small "Refresh" icon button.
- Error state: short message + "Retry" button.
- Dismiss: ESC keydown, outside click, or `open` flipping false externally.
- `data-testid`s: `usage-popover`, `usage-popover-text`, `usage-popover-refresh`, `usage-popover-error`.

`StatusPill.tsx` changes:

- Remove `statusTipVisible` state and the `<span className="status-tip">` block.
- Remove the timer ref (`statusTipTimerRef`) and its cleanup.
- Add `usageOpen` state.
- Dot button `onClick` toggles `usageOpen`. Opening it closes the other popovers, in keeping with the existing single-overlay rule.
- Render `<UsagePopover open={usageOpen} onClose={() => setUsageOpen(false)} anchorRef={dotRef} />` alongside the existing popovers.

`styles/status-pill.css` changes:

- Remove `.status-tip` rules.
- Add `.usage-popover` rules: positioning, monospace font, scrollable max-height, refresh button styling. Match the visual language of the session-list popover.

### Errors surfaced in the popover

| Cause | Message |
|---|---|
| `claude` not found on PATH | "Claude Code CLI not found." |
| 10-second timeout | "Couldn't reach Claude. Try again." |
| Pty spawn / IO failure | "Couldn't run claude /usage." (with truncated error detail) |

## Testing

- Unit test: `strip_ansi` round-trips known fixtures (color codes, cursor moves, OSC sequences).
- Unit test: cache returns the same value within 30s and refetches after; `force_refresh` bypasses cache.
- Manual: click dot → popover opens → fetch completes within ~5s; second click closes; refresh button refetches; ESC and outside-click dismiss; opening session list closes usage popover and vice versa; with `claude` renamed off PATH, error message renders.

## Out of scope for v1

- Periodic background polling or proactive "running low" warnings.
- A tray menu shortcut for the same info.
- Multi-account support.
- Parsing the output into structured fields (percentages, reset Unix timestamps). The raw-text approach is intentional for v1.
