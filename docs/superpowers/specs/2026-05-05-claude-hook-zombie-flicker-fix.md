# Claude-hook busy/idle flicker — root cause and fix

**Date:** 2026-05-05
**Severity:** User-visible regression (mascot pill flips between "Working" and "Free" mid-task during every Claude Code turn)
**Related:** `2026-05-05-claude-hook-mirror-fix-design.md` (the c01b6a0 fix that masked the second root cause)

## Summary

Two independent bugs combined to make the status pill unusable while Claude Code was running:

1. **ani-mime regression (commit c01b6a0):** the new Node hook posted `process.ppid`, which is the throwaway `sh -c "..."` wrapper that Claude Code spawns to run the hook command — not Claude's long-lived PID like the legacy curl hook used.
2. **Claude Code change (recent release):** the `claude.exe` binary now spoofs its `p_comm` (BSD process name) to its version string, e.g. `"2.1.128"`. `proc_scan` only reads argv0 for `name == "node" || is_shell(name)`, so claude no longer matched `is_claude()` and was missing from the `claude_pids` set used to shield hook-registered sessions from zombie cleanup.

Either bug alone would cause flicker; together they look exactly the same in the log, which is why the c01b6a0 fix didn't resolve it.

## Symptom

Every PreToolUse fires busy → proc_scan drops the session as a zombie 1–2 seconds later → state flips back to idle. Repeats for the entire Claude turn.

```
[http] new session registered: pid=97230
[http] pid=97230 -> busy (type=task)
[state] ui transition: idle -> busy
[proc_scan] dropping zombie session pid=97230   ← within ~1s
[state] ui transition: busy -> idle
```

The user reported "it seems this issue has only appeared in recent claude code updates" — they were correct. The Claude Code release that shipped the version-spoofed `p_comm` is what flipped the second bug from latent to fatal.

## Investigation

### Round 1 — wrong PID

Compared the legacy curl hook (`setup/claude.rs:140-141` pre-c01b6a0):

```sh
curl -s "http://127.0.0.1:1234/status?pid=$PPID&state=busy&type=task" || true
```

`$PPID` inside the `sh -c` wrapper resolves to the parent of the wrapper = `claude` itself (long-lived). proc_scan exempts live `claude_pids` from zombie cleanup, so the session stayed busy for the whole turn.

The c01b6a0 Node hook used `process.ppid`, which inside `node` resolves to the wrapper shell — an ephemeral process that exits in milliseconds.

**Fix:** walk one level up from `process.ppid` via `ps -o ppid= -p $ppid` to recover claude's PID. Fall back to pid=0 (virtual session, also shielded) if the walk fails.

### Round 2 — proc_scan blind to version-spoofed claude

After deploying the hook fix, the log still showed `dropping zombie session pid=97230` for PIDs that `ps` confirmed were `claude`:

```
$ ps -p 97230 -o pid=,ppid=,comm=,command=
97230 96415 claude claude --ide --dangerously-skip-permissions --verbose
```

But `ps -p 97230 -o ucomm=` revealed:

```
2.1.128
```

`ucomm` is BSD `p_comm`, which is exactly what `proc_pid::name()` returns from libproc on macOS. Claude Code (recent release) is calling `setproctitle`-style argv-rewriting and writes its **version string** into `p_comm`. So:

- `proc.name` from `proc_pid::name(claude_pid)` → `"2.1.128"`
- `is_claude_name("2.1.128")` → false
- argv0 not read because `name` is neither `"node"` nor a shell (`scan_processes` line 457 gate)
- `is_claude(proc)` → false → claude missing from `claude_pids` → zombie cleanup wins

**Fix:** add a `looks_like_version_string()` heuristic; widen the argv0-read gate to include numeric-dotted names. Then `is_claude` picks claude up via the existing argv0 fallback.

## Changes

### `src-tauri/script/ani-mime-hook.mjs`

```js
import { execSync } from "node:child_process";

function resolveSessionPid() {
  try {
    const out = execSync(`ps -o ppid= -p ${process.ppid}`, {
      encoding: "utf8",
      timeout: 200,
    }).trim();
    const pppid = parseInt(out, 10);
    if (Number.isFinite(pppid) && pppid > 1) return pppid;
  } catch {}
  return 0;
}

// in post():
const params = new URLSearchParams({ pid: String(resolveSessionPid()), state });
```

### `src-tauri/src/proc_scan.rs`

```rust
fn looks_like_version_string(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.is_empty() || !bytes[0].is_ascii_digit() {
        return false;
    }
    let mut has_dot = false;
    for &b in bytes {
        if b == b'.' { has_dot = true; }
        else if !b.is_ascii_digit() && b != b'-' { return false; }
    }
    has_dot
}

// in scan_processes:
let argv0 = if name == "node" || is_shell(&name) || looks_like_version_string(&name) {
    read_argv0(pid as i32).unwrap_or_default()
} else {
    String::new()
};
```

`is_claude()` itself is unchanged — it already does `is_claude_name(argv0_basename(&proc.argv0))`; we just had to make sure argv0 was actually populated for version-spoofed processes.

## Verification

After restarting ani-mime (so `install_hook_script` redeploys the new script and the new Rust binary loads):

- Tail `~/Library/Logs/com.vietnguyenwsilentium.ani-mime/ani-mime.log` during a Claude Code task.
- Expect: a single `new session registered: pid=<claude-pid>` followed by `pid=<claude-pid> -> busy (type=task)` that **stays busy** until the turn finishes (`pid=<claude-pid> task completed (Ns)` and one transition to idle).
- Do **not** expect any `dropping zombie session pid=<claude-pid>` lines for the duration of the turn.

## Future-proofing notes

- **If Claude Code changes the spoofing format** (e.g. `"v2.1.128"`, `"build-123"`) the heuristic will miss again. The fallback at that point is to broaden `looks_like_version_string`, or to unconditionally read argv0 for all processes (one extra `sysctl` per PID per scan — measurable but acceptable on macOS).
- **Detection signal worth adding:** consider logging `claude_pids` size on each scan. If it ever drops to zero while a session is registered, that's a near-certain "claude detection broke again" signal that we can alert on instead of silently dropping sessions.
- The pid=0 virtual-session fallback (`proc_scan.rs:484`, `:610`) is a useful escape hatch and the hook now defaults to it on `ps` failure. If hook PID resolution becomes flaky for any reason, sessions will collapse onto pid=0 instead of disappearing.

## Why the c01b6a0 fix missed this

The c01b6a0 commit was scoped to "read stdin and route by hook event name" and reused `process.ppid` from the inline-curl mental model, where the curl ran inside the `sh -c` and `$PPID` of the curl-running shell was claude. The Node script runs *inside* that shell, so `process.ppid` is one level shallower. The unit-level fix was correct; the system-level invariant ("the PID we report must be in `claude_pids` or a live terminal") wasn't re-checked end-to-end.

Tightening: any future change to how hooks identify their session PID should be verified against the `proc_scan` zombie filter, not just against the `/status` registration log.
