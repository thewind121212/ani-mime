# Claude Usage Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking the colored status dot in the StatusPill opens a popover that runs `claude /usage` in a pty, strips ANSI, and shows the raw output in a monospace block. Remove the existing brief status-tip flash.

**Architecture:** A new Rust module (`usage.rs`) spawns `claude` in a pty via `portable-pty`, captures `/usage` output, strips ANSI, caches for 30 seconds in `AppState`, and exposes a single Tauri command `get_claude_usage`. The frontend gets a `useClaudeUsage` hook (lazy, fetches only when the popover is open) and a `UsagePopover` component anchored under the dot. The popover joins the existing single-overlay coordination in `StatusPill.tsx`.

**Tech Stack:** Rust (`portable-pty` crate, `regex` crate for ANSI strip — or hand-rolled), Tauri 2 commands, React 19, TypeScript.

**Spec:** `docs/superpowers/specs/2026-05-15-claude-usage-popover-design.md`

---

## File Structure

**Backend:**
- Create: `src-tauri/src/usage.rs` — pty spawn, ANSI strip, 30s cache, dedup of in-flight requests
- Modify: `src-tauri/Cargo.toml` — add `portable-pty` dependency
- Modify: `src-tauri/src/lib.rs` — add `mod usage;`, register `get_claude_usage` command in the invoke handler
- Modify: `src-tauri/src/state.rs` — add `usage_cache: Option<UsageCache>` field to `AppState` and initialize in `Default`

**Frontend:**
- Create: `src/hooks/useClaudeUsage.ts` — exposes `{ data, loading, error, refresh }`, lazy on `enabled`
- Create: `src/components/UsagePopover.tsx` — anchored popover with loading / success / error states
- Modify: `src/components/StatusPill.tsx` — remove `statusTipVisible` + `<span className="status-tip">`, add `usageOpen` state, wire dot `onClick` and overlay coordination, render `<UsagePopover>`
- Modify: `src/styles/status-pill.css` — remove `.status-tip` rules, add `.usage-popover` rules

**Tests:**
- Create: `src-tauri/src/usage.rs` (inline `#[cfg(test)] mod tests`) — `strip_ansi` cases

---

## Task 1: Add `portable-pty` dependency and verify it compiles

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add the line just below `rand`:

```toml
portable-pty = "0.8"
```

- [ ] **Step 2: Verify compile**

Run from repo root:

```bash
cd src-tauri && cargo check
```

Expected: completes with no errors (warnings about unused crate are fine — we use it in Task 4). If the version `"0.8"` is rejected, try `"0.9"` or look up the latest on crates.io.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "deps(rust): add portable-pty for claude /usage scraping"
```

---

## Task 2: Create `usage.rs` skeleton with `strip_ansi` and unit tests

**Files:**
- Create: `src-tauri/src/usage.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod usage;` after the other module declarations)

- [ ] **Step 1: Create `usage.rs` with the pure helper and tests**

Create `src-tauri/src/usage.rs`:

```rust
//! Claude Code `/usage` scraper.
//!
//! `/usage` is a REPL-only slash command, so we spawn `claude` in a pty,
//! write `/usage\n`, capture stdout, strip ANSI, and return the cleaned text.
//! Results are cached in `AppState` for 30 seconds.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct UsageResult {
    pub text: String,
    pub fetched_at: u64,
}

#[derive(Debug, Clone)]
pub struct UsageCache {
    pub text: String,
    pub fetched_at: u64,
}

const CACHE_TTL_SECS: u64 = 30;

/// Strip ANSI escape sequences (CSI / OSC / cursor moves) and drop bare
/// carriage returns. Preserves printable text including multi-byte UTF-8.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1B}' {
            match chars.next() {
                Some('[') => {
                    // CSI: consume until a final byte in 0x40..=0x7E.
                    while let Some(&nc) = chars.peek() {
                        chars.next();
                        let code = nc as u32;
                        if (0x40..=0x7E).contains(&code) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    // OSC: terminated by BEL (0x07) or ST (ESC \).
                    while let Some(&nc) = chars.peek() {
                        if nc == '\u{07}' {
                            chars.next();
                            break;
                        }
                        if nc == '\u{1B}' {
                            chars.next();
                            if let Some(&'\\') = chars.peek() {
                                chars.next();
                            }
                            break;
                        }
                        chars.next();
                    }
                }
                Some(_) => {
                    // Two-byte escape (e.g. ESC =, ESC >, ESC c) — already consumed.
                }
                None => break,
            }
            continue;
        }
        if c == '\r' {
            continue;
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_csi_color_codes() {
        let input = "\x1b[31mRED\x1b[0m plain";
        assert_eq!(strip_ansi(input), "RED plain");
    }

    #[test]
    fn strips_cursor_moves() {
        let input = "before\x1b[2Aafter";
        assert_eq!(strip_ansi(input), "beforeafter");
    }

    #[test]
    fn strips_osc_with_bel_terminator() {
        let input = "x\x1b]0;window title\x07y";
        assert_eq!(strip_ansi(input), "xy");
    }

    #[test]
    fn strips_osc_with_st_terminator() {
        let input = "x\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\y";
        assert_eq!(strip_ansi(input), "xlinky");
    }

    #[test]
    fn drops_carriage_returns() {
        let input = "line1\r\nline2\r\n";
        assert_eq!(strip_ansi(input), "line1\nline2\n");
    }

    #[test]
    fn keeps_plain_text_untouched() {
        let input = "5h session: 42% — resets in 2h 18m\n";
        assert_eq!(strip_ansi(input), "5h session: 42% — resets in 2h 18m\n");
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/lib.rs`, find the existing module declarations (look for `mod state;` near the top). Add right after them:

```rust
mod usage;
```

- [ ] **Step 3: Run the tests**

```bash
cd src-tauri && cargo test usage::tests
```

Expected: 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/usage.rs src-tauri/src/lib.rs
git commit -m "feat(usage): add strip_ansi helper and module skeleton"
```

---

## Task 3: Add `usage_cache` field to `AppState`

**Files:**
- Modify: `src-tauri/src/state.rs`

- [ ] **Step 1: Add field**

In `src-tauri/src/state.rs`, find the `pub struct AppState {` block (around line 144). Add this field at the end of the struct, right before the closing `}`:

```rust
    /// Cached output of `claude /usage`. `None` until first fetch; refreshed
    /// after 30 seconds. See `usage.rs`.
    pub usage_cache: Option<crate::usage::UsageCache>,
```

- [ ] **Step 2: Update Default / new()**

Search for where `AppState` is constructed (look for `AppState {` near the bottom of `state.rs` or in `lib.rs`). Add `usage_cache: None,` to every literal construction.

```bash
grep -n "AppState {" src-tauri/src/*.rs
```

For each match, ensure the literal includes `usage_cache: None,`.

- [ ] **Step 3: Verify compile**

```bash
cd src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/state.rs src-tauri/src/lib.rs
git commit -m "feat(usage): add usage_cache field to AppState"
```

---

## Task 4: Implement `fetch_usage_via_pty` in `usage.rs`

**Files:**
- Modify: `src-tauri/src/usage.rs`

- [ ] **Step 1: Add the fetch implementation**

Append to `src-tauri/src/usage.rs` (above the `#[cfg(test)] mod tests` block):

```rust
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::{Read, Write};
use std::time::{Duration, Instant};

#[derive(Debug)]
pub enum UsageError {
    CliNotFound,
    Timeout,
    Spawn(String),
    Io(String),
}

impl std::fmt::Display for UsageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UsageError::CliNotFound => write!(f, "Claude Code CLI not found."),
            UsageError::Timeout => write!(f, "Couldn't reach Claude. Try again."),
            UsageError::Spawn(e) => write!(f, "Couldn't run claude /usage. ({e})"),
            UsageError::Io(e) => write!(f, "Couldn't run claude /usage. ({e})"),
        }
    }
}

const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const QUIESCENT_WINDOW: Duration = Duration::from_millis(700);

/// Spawn `claude` in a pty, send `/usage`, capture and ANSI-strip the output.
///
/// Heuristic: read bytes until no new data arrives for `QUIESCENT_WINDOW`,
/// or the overall `FETCH_TIMEOUT` elapses. Then kill the child and return.
pub fn fetch_usage_via_pty() -> Result<String, UsageError> {
    // Confirm the binary exists on PATH before spawning a pty.
    if which::which("claude").is_err() {
        // Fall through to a manual PATH walk so we don't add `which` as a
        // dependency. Look for `claude` in each PATH entry.
        let found = std::env::var_os("PATH")
            .map(|paths| {
                std::env::split_paths(&paths)
                    .any(|p| p.join("claude").is_file() || p.join("claude").exists())
            })
            .unwrap_or(false);
        if !found {
            return Err(UsageError::CliNotFound);
        }
    }

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| UsageError::Spawn(e.to_string()))?;

    let mut cmd = CommandBuilder::new("claude");
    // No args: starts the REPL. We send `/usage` via stdin.
    if let Some(home) = dirs::home_dir() {
        cmd.cwd(home);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| UsageError::Spawn(e.to_string()))?;
    drop(pair.slave);

    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| UsageError::Io(e.to_string()))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| UsageError::Io(e.to_string()))?;

    // Give the REPL ~1s to draw its prompt before we send the slash command —
    // otherwise the input may be swallowed by the splash screen.
    std::thread::sleep(Duration::from_millis(1000));
    writer
        .write_all(b"/usage\r")
        .map_err(|e| UsageError::Io(e.to_string()))?;
    writer.flush().ok();

    let started = Instant::now();
    let mut last_read = Instant::now();
    let mut buf = [0u8; 4096];
    let mut acc = Vec::<u8>::new();

    // Run the reader on a background thread so we can poll for quiescence.
    let (tx, rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    loop {
        if started.elapsed() >= FETCH_TIMEOUT {
            let _ = child.kill();
            return Err(UsageError::Timeout);
        }
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => {
                acc.extend_from_slice(&chunk);
                last_read = Instant::now();
            }
            Err(_) => {
                // No bytes this tick. If we already saw some bytes and the
                // quiescent window has passed, we're done.
                if !acc.is_empty() && last_read.elapsed() >= QUIESCENT_WINDOW {
                    break;
                }
            }
        }
    }

    let _ = child.kill();
    let _ = child.wait();

    let text = String::from_utf8_lossy(&acc).to_string();
    let stripped = strip_ansi(&text);
    Ok(extract_usage_section(&stripped))
}

/// Trim the REPL noise so users only see the `/usage` output itself.
/// We keep lines from the first line that mentions "usage" (case-insensitive)
/// onward, dropping the prompt-banner above it. If we can't find such a line,
/// return the input as-is — better to show too much than nothing.
fn extract_usage_section(stripped: &str) -> String {
    let lower = stripped.to_lowercase();
    if let Some(idx) = lower.find("usage") {
        // Back up to the start of that line.
        let line_start = stripped[..idx].rfind('\n').map(|i| i + 1).unwrap_or(0);
        return stripped[line_start..].trim_end().to_string();
    }
    stripped.trim_end().to_string()
}
```

- [ ] **Step 2: Add `dirs` import test**

`dirs` is already a workspace dependency (confirmed in `Cargo.toml`). No change needed.

- [ ] **Step 3: Verify compile**

```bash
cd src-tauri && cargo check
```

Expected: no errors. If `which` is referenced but not present, the inline PATH fallback above doesn't need the crate — just delete the `if which::which(...)` block and keep only the manual PATH walk:

```rust
let found = std::env::var_os("PATH")
    .map(|paths| std::env::split_paths(&paths).any(|p| p.join("claude").is_file()))
    .unwrap_or(false);
if !found {
    return Err(UsageError::CliNotFound);
}
```

Remove the `which::which` reference entirely.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/usage.rs
git commit -m "feat(usage): spawn claude in pty and scrape /usage output"
```

---

## Task 5: Add `get_or_fetch_usage` with cache + in-flight dedup

**Files:**
- Modify: `src-tauri/src/usage.rs`

- [ ] **Step 1: Add helper functions**

Append to `src-tauri/src/usage.rs` (above the `#[cfg(test)]` block):

```rust
use std::sync::{Arc, Mutex};

fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Returns the cached usage if fresh (≤30s) and `force_refresh` is false;
/// otherwise spawns `claude /usage`, caches the result, returns it.
///
/// Concurrent callers are coalesced via a global mutex around the spawn —
/// the second caller blocks until the first finishes and then reads the
/// cache instead of re-spawning.
pub fn get_or_fetch_usage(
    state: &Arc<Mutex<crate::state::AppState>>,
    force_refresh: bool,
) -> Result<UsageResult, String> {
    if !force_refresh {
        if let Some(cache) = state.lock().ok().and_then(|s| s.usage_cache.clone()) {
            if now_secs().saturating_sub(cache.fetched_at) <= CACHE_TTL_SECS {
                return Ok(UsageResult {
                    text: cache.text,
                    fetched_at: cache.fetched_at,
                });
            }
        }
    }

    // Serialize fetches so concurrent clicks don't spawn N processes.
    static FETCH_LOCK: Mutex<()> = Mutex::new(());
    let _guard = FETCH_LOCK
        .lock()
        .map_err(|e| format!("usage fetch lock poisoned: {e}"))?;

    // Re-check the cache after acquiring the lock: another caller may have
    // refreshed it while we were waiting.
    if !force_refresh {
        if let Some(cache) = state.lock().ok().and_then(|s| s.usage_cache.clone()) {
            if now_secs().saturating_sub(cache.fetched_at) <= CACHE_TTL_SECS {
                return Ok(UsageResult {
                    text: cache.text,
                    fetched_at: cache.fetched_at,
                });
            }
        }
    }

    let text = fetch_usage_via_pty().map_err(|e| e.to_string())?;
    let fetched_at = now_secs();
    if let Ok(mut s) = state.lock() {
        s.usage_cache = Some(UsageCache {
            text: text.clone(),
            fetched_at,
        });
    }
    Ok(UsageResult { text, fetched_at })
}
```

- [ ] **Step 2: Verify compile**

```bash
cd src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/usage.rs
git commit -m "feat(usage): add 30s cache and in-flight dedup"
```

---

## Task 6: Register the `get_claude_usage` Tauri command

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command function**

Find a spot near the other `#[tauri::command]` definitions in `src-tauri/src/lib.rs` (e.g. just before the `run()` function or near `get_status`). Add:

`AppState` is managed as `Arc<Mutex<AppState>>` (verified — see existing commands like `get_status` and `get_sessions`). Match that pattern:

```rust
#[tauri::command]
async fn get_claude_usage(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    force_refresh: bool,
) -> Result<usage::UsageResult, String> {
    let state_clone = state.inner().clone();
    // Spawn-blocking because the pty fetch can take a few seconds and we
    // don't want to stall the Tauri event loop.
    tauri::async_runtime::spawn_blocking(move || {
        usage::get_or_fetch_usage(&state_clone, force_refresh)
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}
```

- [ ] **Step 2: Register in `invoke_handler!`**

Find `tauri::generate_handler![...]` in `lib.rs` (around line 613 — the long single-line list). Append `, get_claude_usage` to the end of that list, before the closing `]`.

- [ ] **Step 3: Verify compile**

```bash
cd src-tauri && cargo check
```

Expected: no errors.

- [ ] **Step 4: Smoke test from the dev console**

Run `bun run tauri dev`. Once the app loads, open devtools (right-click the dog → Inspect, or via the Settings → Diagnostics path if available). In the console:

```js
await window.__TAURI__.core.invoke("get_claude_usage", { forceRefresh: false })
```

Expected: returns `{ text: "...", fetched_at: <timestamp> }` within ~5 seconds. The `text` field contains the cleaned `/usage` output. If it errors with `"Claude Code CLI not found."`, verify `which claude` from the same shell that launched `bun run tauri dev`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(usage): expose get_claude_usage Tauri command"
```

---

## Task 7: Create `useClaudeUsage` hook

**Files:**
- Create: `src/hooks/useClaudeUsage.ts`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useClaudeUsage.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface UsageResult {
  text: string;
  fetched_at: number;
}

interface UseClaudeUsageOptions {
  /** When false, the hook does nothing. Flip to true to trigger a fetch. */
  enabled: boolean;
}

interface UseClaudeUsageReturn {
  data: UsageResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useClaudeUsage({ enabled }: UseClaudeUsageOptions): UseClaudeUsageReturn {
  const [data, setData] = useState<UsageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the latest in-flight request so a stale resolve doesn't overwrite
  // a fresher one when the user clicks Refresh rapidly.
  const requestIdRef = useRef(0);

  const fetchUsage = useCallback((forceRefresh: boolean) => {
    const id = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    invoke<UsageResult>("get_claude_usage", { forceRefresh })
      .then((result) => {
        if (requestIdRef.current !== id) return;
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (requestIdRef.current !== id) return;
        setError(typeof err === "string" ? err : String(err));
        setLoading(false);
      });
  }, []);

  // First fetch when the consumer enables us.
  useEffect(() => {
    if (!enabled) return;
    if (data || loading) return;
    fetchUsage(false);
  }, [enabled, data, loading, fetchUsage]);

  const refresh = useCallback(() => {
    fetchUsage(true);
  }, [fetchUsage]);

  return { data, loading, error, refresh };
}
```

- [ ] **Step 2: Type-check the frontend**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useClaudeUsage.ts
git commit -m "feat(usage): add useClaudeUsage hook"
```

---

## Task 8: Create `UsagePopover` component

**Files:**
- Create: `src/components/UsagePopover.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/UsagePopover.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { useClaudeUsage } from "../hooks/useClaudeUsage";

interface UsagePopoverProps {
  open: boolean;
  onClose: () => void;
  /** Pixel offset from the wrapper's top edge to position under the dot. */
  top: number;
}

export function UsagePopover({ open, onClose, top }: UsagePopoverProps) {
  const { data, loading, error, refresh } = useClaudeUsage({ enabled: open });
  const popoverRef = useRef<HTMLDivElement>(null);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Click-outside closes. The handler is mounted after a tick so the same
  // click that opened the popover isn't immediately treated as outside.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      const handler = (e: MouseEvent) => {
        const el = popoverRef.current;
        if (!el) return;
        if (e.target instanceof Node && !el.contains(e.target)) {
          onClose();
        }
      };
      window.addEventListener("mousedown", handler);
      window.addEventListener("__cleanup_usage", () => {
        window.removeEventListener("mousedown", handler);
      }, { once: true });
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.dispatchEvent(new Event("__cleanup_usage"));
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      className="usage-popover"
      data-testid="usage-popover"
      style={{ top }}
      role="dialog"
      aria-label="Claude Code usage"
    >
      <div className="usage-popover-header">
        <span className="usage-popover-title">Claude usage</span>
        <button
          type="button"
          data-testid="usage-popover-refresh"
          className="usage-popover-refresh"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh usage"
          title="Refresh"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.45 10.5h-2.09A6 6 0 1 1 12 6a5.94 5.94 0 0 1 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
        </button>
      </div>
      <div className="usage-popover-body">
        {loading && !data && (
          <div className="usage-popover-loading" data-testid="usage-popover-loading">
            Checking usage…
          </div>
        )}
        {error && (
          <div className="usage-popover-error" data-testid="usage-popover-error">
            {error}
          </div>
        )}
        {data && (
          <pre className="usage-popover-text" data-testid="usage-popover-text">
            {data.text}
          </pre>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/UsagePopover.tsx
git commit -m "feat(usage): add UsagePopover component"
```

---

## Task 9: Wire `UsagePopover` into `StatusPill` and remove the status-tip

**Files:**
- Modify: `src/components/StatusPill.tsx`

- [ ] **Step 1: Import the new component**

Add to the top of `src/components/StatusPill.tsx`, alongside the other component imports:

```typescript
import { UsagePopover } from "./UsagePopover";
```

- [ ] **Step 2: Remove the status-tip state**

Find and delete these lines in `StatusPill.tsx` (around lines 306–307):

```typescript
const [statusTipVisible, setStatusTipVisible] = useState(false);
const statusTipTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
```

Then search for and delete any cleanup useEffect that clears `statusTipTimerRef`. (Use `grep -n "statusTipTimerRef" src/components/StatusPill.tsx` first — if there's a cleanup effect, delete it; if not, skip this sub-step.)

- [ ] **Step 3: Add `usageOpen` state**

Just below the `spotifyButtonRef` declaration (around line 323), add:

```typescript
// --- Usage popover state ---
const [usageOpen, setUsageOpen] = useState(false);
const [usageTop, setUsageTop] = useState(0);
```

- [ ] **Step 4: Replace the dot button onClick**

Find the dot button (around line 743). Replace the entire `onClick` handler:

```typescript
<button
  type="button"
  data-testid="status-dot"
  className={`dot-button ${dotClassMap[status] ?? "dot searching"}`}
  onClick={async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!guardPillClick()) return;
    playClickTap();
    if (usageOpen) {
      setUsageOpen(false);
      return;
    }
    // Close all other overlays — single-overlay rule.
    if (sessionOpen) setSessionOpen(false);
    if (peerOpen) {
      const popover = await WebviewWindow.getByLabel("peer-list");
      await popover?.hide().catch(() => {});
      setPeerOpen(false);
    }
    if (chatOpen) setChatOpen(false);
    if (spotifyOpen) setSpotifyOpen(false);
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setUsageTop(rect.bottom + 6);
    setUsageOpen(true);
  }}
  aria-label={`Status: ${labelMap[status] ?? "Searching..."}`}
  title={labelMap[status] ?? "Searching..."}
/>
```

- [ ] **Step 5: Delete the `<span className="status-tip">` block**

Find these lines right after the dot button (around lines 758–762) and delete them entirely:

```typescript
{statusTipVisible && (
  <span data-testid="status-tip" className="status-tip" role="status">
    {labelMap[status] ?? "Searching..."}
  </span>
)}
```

- [ ] **Step 6: Render `<UsagePopover>`**

Find where the session-list dropdown is rendered (search for the `sessionOpen &&` block). Right after it, add:

```tsx
<UsagePopover
  open={usageOpen}
  onClose={() => setUsageOpen(false)}
  top={usageTop}
/>
```

- [ ] **Step 7: Coordinate with other overlays**

The other toggle functions (`toggleSession`, `toggleChat`, `toggleSpotify`, `togglePeer`) must also close `usageOpen` when they open. For each one, add `if (usageOpen) setUsageOpen(false);` in the block that closes other overlays (near the existing `if (chatOpen) setChatOpen(false);` calls). Use `grep -n "setChatOpen(false)" src/components/StatusPill.tsx` to find every site.

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. Specifically check that the `dragging` / `effectActive` props don't reference `statusTipVisible` anywhere — if they do, drop those references.

- [ ] **Step 9: Commit**

```bash
git add src/components/StatusPill.tsx
git commit -m "feat(usage): wire UsagePopover into status dot click"
```

---

## Task 10: Update `status-pill.css`

**Files:**
- Modify: `src/styles/status-pill.css`

- [ ] **Step 1: Remove `.status-tip` rules**

```bash
grep -n "status-tip" src/styles/status-pill.css
```

For each match, delete the rule block (the selector + everything inside `{...}`).

- [ ] **Step 2: Add `.usage-popover` rules**

Append to the bottom of `src/styles/status-pill.css`:

```css
.usage-popover {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  width: 320px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  background: var(--pill-bg, rgba(20, 20, 22, 0.92));
  color: var(--pill-text, #e8e8ea);
  border: 1px solid var(--pill-border, rgba(255, 255, 255, 0.08));
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.usage-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.85;
}

.usage-popover-title {
  pointer-events: none;
}

.usage-popover-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  opacity: 0.7;
}

.usage-popover-refresh:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  opacity: 1;
}

.usage-popover-refresh:disabled {
  opacity: 0.35;
  cursor: default;
}

.usage-popover-body {
  padding: 10px;
  overflow: auto;
}

.usage-popover-loading,
.usage-popover-error {
  font-size: 12px;
  opacity: 0.85;
}

.usage-popover-error {
  color: #ff8a8a;
}

.usage-popover-text {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/styles/status-pill.css
git commit -m "feat(usage): style UsagePopover, remove .status-tip"
```

---

## Task 11: Manual end-to-end verification

**Files:** (no edits)

- [ ] **Step 1: Run dev build**

```bash
bun run tauri dev
```

- [ ] **Step 2: Verify the popover opens**

Click the colored dot on the dog. Expected: "Checking usage…" appears for up to ~5 seconds, then a monospace block fills with the `/usage` output. Reset times and percentages should be visible.

- [ ] **Step 3: Verify dismissal**

- Click the dot again → popover closes.
- Open it, press ESC → popover closes.
- Open it, click somewhere outside the popover (the desktop or a different region of the dog) → popover closes.

- [ ] **Step 4: Verify single-overlay coordination**

- Open the usage popover, then click the session-list icon → usage popover closes and session list opens.
- Open the session list, then click the dot → session list closes and usage popover opens.
- Repeat for chat and spotify (if connected).

- [ ] **Step 5: Verify cache**

Open the popover, close it, reopen it within 30 seconds. Expected: text appears instantly (no "Checking usage…"). Reopen after 35+ seconds. Expected: "Checking usage…" appears again briefly.

- [ ] **Step 6: Verify refresh button**

With the popover open and showing data, click the refresh icon. Expected: "Checking usage…" reappears briefly, then refreshed data. The `fetched_at` timestamp (visible if you log it) increases.

- [ ] **Step 7: Verify error state**

In a separate terminal:

```bash
sudo mv /opt/homebrew/bin/claude /opt/homebrew/bin/claude.bak
```

(Substitute the actual path from `which claude`.) Click the dot. Expected: "Claude Code CLI not found." appears.

Restore:

```bash
sudo mv /opt/homebrew/bin/claude.bak /opt/homebrew/bin/claude
```

- [ ] **Step 8: Verify the old status-tip is gone**

Confirm: clicking the dot no longer briefly flashes "Idle" / "Busy" / etc. as text. The only thing that opens is the popover.

- [ ] **Step 9: Run all tests once more**

```bash
cd src-tauri && cargo test
cd .. && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 10: Final commit if anything was tweaked during verification**

If you fixed anything during manual testing, commit it. Otherwise skip.

---

## Notes for the implementer

- **`portable-pty` version:** If `0.8` doesn't resolve, check [crates.io/crates/portable-pty](https://crates.io/crates/portable-pty) for the latest minor. The API used here (`NativePtySystem`, `CommandBuilder`, `openpty`) has been stable since 0.7.
- **`AppState` wrapper:** Confirm whether `AppState` is managed as `Arc<Mutex<AppState>>` (most likely, given `state.rs` and the existing commands) or some other type. Match the exact wrapper in Task 6.
- **Slash command timing:** The 1-second pre-write sleep in `fetch_usage_via_pty` is the most likely source of flakes. If `/usage` sometimes returns empty, increase to 1500ms first, then investigate the splash-screen output.
- **`/exit` not sent:** We kill the child rather than send `/exit` because waiting for a clean shutdown adds latency. If this leaves orphaned background processes (unlikely with a pty), revisit.
- **Quiescent window 700ms:** Long enough for the model's animated rendering to finish drawing percentages, short enough that the user doesn't feel a delay. Tune if the output looks truncated.
