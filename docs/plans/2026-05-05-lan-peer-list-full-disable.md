# LAN Peer List Full Disable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user disables "LAN Peer List" in Settings, fully stop all LAN-related machinery — mDNS discovery, UDP multicast/unicast announces, and the "Check Privacy → Local Network" speech bubble — instead of only hiding the status-pill icon.

**Architecture:** The persisted `lanListEnabled` setting (default `false`, stored in `settings.json` via tauri-plugin-store) becomes the single gate for all LAN activity. The Rust backend reads the value once at startup and skips spawning `start_discovery` and `start_broadcast` when disabled — toggling at runtime requires a restart, mirroring how `nickname`/`pet` are loaded today. The frontend gates the `discovery-hint` bubble listener on the live setting so toggling off immediately silences the "Check Privacy → Local Network" nudge without a restart. A short hint under the Settings toggle informs the user the LAN runtime change is restart-gated.

**Tech Stack:** Rust (Tauri 2 backend, serde_json for parsing), React 19, Vitest + React Testing Library, tauri-plugin-store.

---

## File Structure

**Modify:**
- `src-tauri/src/helpers.rs` — add a pure parser `parse_lan_list_enabled(&str) -> bool` and a thin wrapper `read_lan_list_enabled(&Path) -> bool` that reads `settings.json` and defers to the parser. Default is `false` (matches `useLanList`'s default and its `lanListDefaultFalseMigrated` migration).
- `src-tauri/src/lib.rs` — wrap the discovery+broadcast spawn block (lines 619-669) in the gate. Log a single line stating whether LAN is enabled or disabled at startup so users can grep the log if they expect peers but see none.
- `src/hooks/useBubble.ts` — read `useLanList().enabled` and skip the `discovery-hint` "no_peers" bubble when LAN is disabled.
- `src/components/Settings.tsx` — append " Restart required for the change to take effect." to the existing LAN Peer List hint.
- `src/__tests__/hooks/useBubble.test.ts` — add a test that the discovery-hint bubble is suppressed when `lanListEnabled` is `false`.

**No new files.** The backend gate is composition-root code; the existing `lib.rs::run` setup logic is untested and a manual smoke test on macOS is the established pattern. Pure-fn parsing is unit-tested in `helpers.rs` per the existing `#[cfg(test)] mod tests` pattern in `src-tauri/src/deeplink.rs`.

---

## Task 1: Add the pure parser `parse_lan_list_enabled` in helpers.rs

**Files:**
- Modify: `src-tauri/src/helpers.rs`

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/helpers.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lan_list_enabled_returns_true_when_set_true() {
        let json = r#"{"lanListEnabled": true}"#;
        assert!(parse_lan_list_enabled(json));
    }

    #[test]
    fn parse_lan_list_enabled_returns_false_when_set_false() {
        let json = r#"{"lanListEnabled": false}"#;
        assert!(!parse_lan_list_enabled(json));
    }

    #[test]
    fn parse_lan_list_enabled_defaults_false_when_key_missing() {
        let json = r#"{"nickname": "Anonymous"}"#;
        assert!(!parse_lan_list_enabled(json));
    }

    #[test]
    fn parse_lan_list_enabled_defaults_false_for_invalid_json() {
        let json = "not json at all {{";
        assert!(!parse_lan_list_enabled(json));
    }

    #[test]
    fn parse_lan_list_enabled_defaults_false_for_non_bool_value() {
        let json = r#"{"lanListEnabled": "yes"}"#;
        assert!(!parse_lan_list_enabled(json));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib helpers::tests`
Expected: FAIL — `cannot find function 'parse_lan_list_enabled' in this scope`.

- [ ] **Step 3: Implement the parser**

Add to `src-tauri/src/helpers.rs`, above the `#[cfg(test)]` block:

```rust
/// Parse the `lanListEnabled` boolean out of a settings.json document.
/// Returns `false` for missing key, non-bool value, or invalid JSON —
/// matches the frontend default in `useLanList` (off by default).
pub fn parse_lan_list_enabled(json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(json)
        .ok()
        .and_then(|v| v.get("lanListEnabled").and_then(|x| x.as_bool()))
        .unwrap_or(false)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib helpers::tests`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/helpers.rs
git commit -m "feat(helpers): parse lanListEnabled from settings.json"
```

---

## Task 2: Add the `read_lan_list_enabled` file wrapper in helpers.rs

**Files:**
- Modify: `src-tauri/src/helpers.rs`

- [ ] **Step 1: Write the failing test**

Add inside the existing `#[cfg(test)] mod tests` block in `src-tauri/src/helpers.rs`:

```rust
    #[test]
    fn read_lan_list_enabled_returns_false_for_missing_file() {
        let path = std::path::PathBuf::from("/tmp/ani-mime-nonexistent-settings-xyz.json");
        let _ = std::fs::remove_file(&path);
        assert!(!read_lan_list_enabled(&path));
    }

    #[test]
    fn read_lan_list_enabled_reads_true_from_real_file() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("ani-mime-test-settings-{}.json", std::process::id()));
        std::fs::write(&path, r#"{"lanListEnabled": true}"#).unwrap();
        let result = read_lan_list_enabled(&path);
        let _ = std::fs::remove_file(&path);
        assert!(result);
    }

    #[test]
    fn read_lan_list_enabled_reads_false_from_real_file() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("ani-mime-test-settings-false-{}.json", std::process::id()));
        std::fs::write(&path, r#"{"lanListEnabled": false}"#).unwrap();
        let result = read_lan_list_enabled(&path);
        let _ = std::fs::remove_file(&path);
        assert!(!result);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test --lib helpers::tests::read_lan_list_enabled`
Expected: FAIL — `cannot find function 'read_lan_list_enabled' in this scope`.

- [ ] **Step 3: Implement the wrapper**

Add to `src-tauri/src/helpers.rs`, just below `parse_lan_list_enabled`:

```rust
/// Read `lanListEnabled` from a `settings.json` file on disk. Returns
/// `false` if the file is missing, unreadable, or malformed — same default
/// as `parse_lan_list_enabled`.
pub fn read_lan_list_enabled(path: &std::path::Path) -> bool {
    match std::fs::read_to_string(path) {
        Ok(s) => parse_lan_list_enabled(&s),
        Err(_) => false,
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd src-tauri && cargo test --lib helpers::tests`
Expected: PASS — 8 tests pass total (5 from Task 1 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/helpers.rs
git commit -m "feat(helpers): read lanListEnabled from settings.json on disk"
```

---

## Task 3: Gate `start_discovery` and `start_broadcast` on `lanListEnabled` in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs:619-669` (the discovery+broadcast spawn block inside `setup`)

- [ ] **Step 1: Read the current spawn block to confirm line numbers**

Run: `grep -n "start_discovery\|start_broadcast\|loading settings from" src-tauri/src/lib.rs`
Expected: lines 628 (`loading settings from`), 662 (`discovery::start_discovery(`), 668 (`broadcast::start_broadcast(`). If the line numbers have drifted, find the equivalent block by content rather than line number.

- [ ] **Step 2: Wrap the discovery+broadcast spawn in the gate**

In `src-tauri/src/lib.rs`, find the block:

```rust
                discovery::start_discovery(
                    discovery_handle.clone(),
                    discovery_state.clone(),
                    nickname.clone(),
                    pet.clone(),
                );
                broadcast::start_broadcast(discovery_handle, discovery_state, nickname, pet);
```

Replace it with:

```rust
                let lan_enabled = crate::helpers::read_lan_list_enabled(&store_path);
                if lan_enabled {
                    crate::app_log!("[app] LAN Peer List enabled — starting mDNS discovery + UDP broadcast");
                    discovery::start_discovery(
                        discovery_handle.clone(),
                        discovery_state.clone(),
                        nickname.clone(),
                        pet.clone(),
                    );
                    broadcast::start_broadcast(discovery_handle, discovery_state, nickname, pet);
                } else {
                    crate::app_log!(
                        "[app] LAN Peer List disabled — skipping mDNS discovery + UDP broadcast (toggle in Settings + restart to enable)"
                    );
                }
```

- [ ] **Step 3: Verify the backend still compiles**

Run: `cd src-tauri && cargo check`
Expected: clean compile (warnings only from unused imports if any — fix those if introduced).

- [ ] **Step 4: Manual smoke test — disabled path**

Run: `bun run tauri dev`

Verify in the app log (Superpower Tool → Logs, or `~/Library/Logs/com.vietnguyen.ani-mime/ani-mime.log` on macOS):
- A line `[app] LAN Peer List disabled — skipping mDNS discovery + UDP broadcast` appears at startup (since `lanListEnabled` defaults to `false`).
- No `[discovery]` or `[broadcast]` log lines appear.
- The status pill renders without the LAN icon button.

Stop the dev server (Ctrl+C in the terminal running `bun run tauri dev`).

- [ ] **Step 5: Manual smoke test — enabled path**

Open Settings, toggle "LAN Peer List" to on. The toggle persists immediately to `settings.json`. Quit the app fully (tray → Quit Ani-Mime) and relaunch with `bun run tauri dev`.

Verify in the log:
- A line `[app] LAN Peer List enabled — starting mDNS discovery + UDP broadcast` appears at startup.
- `[discovery] starting mDNS discovery (nickname=..., pet=...)` appears.
- `[broadcast] starting (instance=..., ...)` appears.
- The status pill shows the LAN icon button.

Toggle "LAN Peer List" back to off in Settings (so the default state for the next dev iteration is off) and stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(lan): skip mDNS + broadcast spawn when LAN Peer List is off"
```

---

## Task 4: Suppress `discovery-hint` bubble when `lanListEnabled` is false

**Files:**
- Modify: `src/hooks/useBubble.ts:117-134`
- Test: `src/__tests__/hooks/useBubble.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/hooks/useBubble.test.ts`, inside the existing top-level `describe("useBubble", () => { ... })` block, after the `enabled gate` describe block:

```ts
  describe("LAN gate", () => {
    it("suppresses discovery-hint bubble when lanListEnabled is false", async () => {
      mockStoreValue("settings.json", "lanListEnabled", false);
      mockStoreValue("settings.json", "lanListDefaultFalseMigrated", true);

      const { result } = renderHook(() => useBubble());
      await act(async () => {});

      await act(async () => {
        emitMockEvent("discovery-hint", "no_peers");
      });

      expect(result.current.visible).toBe(false);
    });

    it("shows discovery-hint bubble when lanListEnabled is true", async () => {
      mockStoreValue("settings.json", "lanListEnabled", true);
      mockStoreValue("settings.json", "lanListDefaultFalseMigrated", true);

      const { result } = renderHook(() => useBubble());
      await act(async () => {});

      await act(async () => {
        emitMockEvent("discovery-hint", "no_peers");
      });

      expect(result.current.visible).toBe(true);
      expect(result.current.message).toContain("Local Network");
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run src/__tests__/hooks/useBubble.test.ts`
Expected: FAIL — the first new test fails because `discovery-hint` is currently always visible regardless of `lanListEnabled`.

- [ ] **Step 3: Gate the listener on `lanListEnabled`**

In `src/hooks/useBubble.ts`, at the top of the file, add the import next to the other imports:

```ts
import { useLanList } from "./useLanList";
```

Inside the `useBubble()` function, add this line just below `const [enabled, setEnabledState] = useState(true);`:

```ts
  const { enabled: lanEnabled } = useLanList();
```

Find this block (currently around lines 117-134):

```ts
  // Listen for discovery-hint: no peers found after timeout
  useEffect(() => {
    const unlisten = listen<string>("discovery-hint", (e) => {
      if (e.payload !== "no_peers") return;

      clearTimeout(timerRef.current);
      setMessage("No friends nearby! Check Privacy → Local Network");
      setVisible(true);

      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, 10000);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
```

Replace with:

```ts
  // Listen for discovery-hint: no peers found after timeout. Gated on the
  // LAN Peer List setting — if the user has opted out, don't nag them about
  // Local Network privacy.
  useEffect(() => {
    const unlisten = listen<string>("discovery-hint", (e) => {
      if (e.payload !== "no_peers") return;
      if (!lanEnabled) return;

      clearTimeout(timerRef.current);
      setMessage("No friends nearby! Check Privacy → Local Network");
      setVisible(true);

      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, 10000);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [lanEnabled]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/__tests__/hooks/useBubble.test.ts`
Expected: PASS — all useBubble tests pass, including the two new LAN-gate tests.

- [ ] **Step 5: Run the type-check to make sure nothing else regressed**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useBubble.ts src/__tests__/hooks/useBubble.test.ts
git commit -m "fix(bubble): suppress discovery-hint when LAN Peer List is disabled"
```

---

## Task 5: Add the "Restart required" hint under the LAN Peer List toggle

**Files:**
- Modify: `src/components/Settings.tsx:541-542` (the hint span)

- [ ] **Step 1: Read the current hint to confirm exact text**

Run: `grep -n "Show the nearby-peers icon" src/components/Settings.tsx`
Expected: one match around line 542. If the line number drifted, find by content.

- [ ] **Step 2: Update the hint text**

In `src/components/Settings.tsx`, find:

```tsx
                  <span className="settings-row-hint">Show the nearby-peers icon on the status pill. Turn off to hide it entirely.</span>
```

Replace with:

```tsx
                  <span className="settings-row-hint">Show the nearby-peers icon on the status pill, and run the LAN scanner that finds them. Restart Ani-Mime after toggling for the scanner to start or stop.</span>
```

- [ ] **Step 3: Run the type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify Settings tests still pass**

Run: `bunx vitest run src/__tests__/components/Settings.test.tsx`
Expected: PASS — no test asserts on the exact hint string (verify by inspection if any test fails on a string mismatch and update accordingly; otherwise no changes needed).

- [ ] **Step 5: Manual smoke check**

Run: `bun run tauri dev`

Open Settings → Status Bar section. Verify the hint under "LAN Peer List" reads the new copy. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "docs(settings): note that LAN Peer List toggle is restart-gated"
```

---

## Task 6: Final verification

**Files:** none — this is the integration check.

- [ ] **Step 1: Run the full frontend test suite**

Run: `bunx vitest run`
Expected: all tests pass.

- [ ] **Step 2: Run the Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: all tests pass (including the 8 new helpers tests).

- [ ] **Step 3: Run frontend type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run backend type-check**

Run: `cd src-tauri && cargo check`
Expected: clean compile.

- [ ] **Step 5: End-to-end smoke test on macOS**

Run: `bun run tauri dev`

With `lanListEnabled = false` (the default) verify in the log:
- `[app] LAN Peer List disabled — skipping mDNS discovery + UDP broadcast`
- No `[discovery]`, `[broadcast]`, or `discovery-hint` lines.
- Status pill has no LAN icon.
- Wait at least 35 seconds — no "No friends nearby! Check Privacy → Local Network" bubble appears (would have fired at the 30-second discovery heartbeat if discovery were running).

Toggle "LAN Peer List" to on, quit the app, relaunch. Verify:
- `[app] LAN Peer List enabled — starting mDNS discovery + UDP broadcast`
- `[discovery]` and `[broadcast]` lines appear.
- Status pill shows the LAN icon.
- If you have no peers on the network, the "Check Privacy → Local Network" bubble appears within ~30 seconds.

Toggle off again, quit, restart. Confirm the disabled-path log line returns.

- [ ] **Step 6: No commit — this task is verification only.**

---

## Out of Scope (explicit non-goals)

- **Live start/stop of LAN threads on toggle.** That requires cancellation tokens in `discovery.rs` and `broadcast.rs` plus a graceful `mDNS daemon shutdown()` path. The "restart to apply" hint in Settings (Task 5) sets the user expectation. File this as a follow-up if the UX hint is not enough.
- **Rejecting `/visit` and `/visit-end` on the HTTP server when LAN is off.** When discovery+broadcast don't start, no peer learns about us in the first place, so incoming `/visit` traffic is only possible from a peer that knew us in a previous session. Defensive rejection is a small follow-up; not required for this plan.
- **Hiding the "Local Network Access — Request Permission" button in Settings when LAN is off.** It lives in the macOS-only "System & Permissions" section and the user may need it precisely so they can flip the OS toggle before re-enabling LAN. Leaving it visible is correct.
