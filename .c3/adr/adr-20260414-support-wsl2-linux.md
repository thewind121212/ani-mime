---
id: adr-20260414-support-wsl2-linux
c3-seal: d4a24bb288da5f272b24cd4e52d03d1b99418dd910e0453efc6926d1cc062f75
title: support-wsl2-linux
type: adr
goal: 'Extend Ani-Mime beyond its macOS-only origin so the floating pet mascot renders and reacts on WSL2 (Linux running under Windows Subsystem for Linux 2, displayed via WSLg). Target: full feature parity — mascot window + shell hooks + Claude Code hooks + MCP server + mDNS peer discovery + updater all working on Linux.'
status: implemented
date: "2026-04-14"
---

## Goal

Extend Ani-Mime beyond its macOS-only origin so the floating pet mascot renders and reacts on WSL2 (Linux running under Windows Subsystem for Linux 2, displayed via WSLg). Target: full feature parity — mascot window + shell hooks + Claude Code hooks + MCP server + mDNS peer discovery + updater all working on Linux.

## Context

The Rust crate already declares `cocoa`/`objc` under `[target.'cfg(target_os = "macos")'.dependencies]`, the main window already has `transparent: true`, and Cargo.toml bundles target `"all"` (includes AppImage/deb). However, the codebase contains several macOS-only assumptions that break compile or runtime on Linux:

**Compile-breakers on Linux:**

- `platform/macos.rs` exposes `set_dock_visibility` which calls `tauri::ActivationPolicy::Regular`/`Accessory` — these APIs are macOS-only and violate `rule-macos-cfg-gate` because the wrapper is not gated. lib.rs calls this unconditionally at lines 195, 366, 471.
**Runtime-only on Linux (compiles, but fails when called):**

- `lib.rs`: `open_log_dir` uses `Command::new("open")` (macOS-only; Linux uses `xdg-open`)
- `lib.rs`: `request_local_network` opens `x-apple.systempreferences:` URL scheme
- `lib.rs`: `preview_dialog` calls `osascript` directly and via `macos_dialog` helper
- `setup/shell.rs`: `macos_dialog`, `macos_choose_list` shell out to `osascript`
- `setup/mod.rs`: all dialogs route through `macos_dialog`; restart uses `open -a <exe>`
- `updater.rs`: every dialog uses `osascript`; `update_now` runs `brew update && brew upgrade --cask ani-mime` via AppleScript into Terminal.app
**What already works on Linux out of the box:**

- Tauri 2 with webkit2gtk (WSLg compositor renders this fine)
- mdns-sd crate (mDNS works on Linux; WSL2 multicast subject to NAT — risk noted)
- Shell scripts (zsh/bash/fish) — already POSIX
- HTTP server (tiny_http)
- MCP server (Node.js)
- State, watchdog, helpers, logger, discovery, server, state modules
- Window config (`transparent: true`, `decorations: false`, `alwaysOnTop`, `skipTaskbar`)
## Approach

Create a **cross-platform platform facade** under `platform/mod.rs` that exposes every OS-sensitive operation the rest of the backend needs. macos.rs keeps its existing implementation gated on `#[cfg(target_os = "macos")]`; a new `linux.rs` sibling provides Linux implementations. No feature-gated callers — the facade is always available, selection happens in `platform/mod.rs`.

Facade surface:

```rust
// platform/mod.rs
pub fn setup_main_window(app: &tauri::App);
pub fn set_dock_visibility(app: &tauri::AppHandle, visible: bool);
pub fn open_path(path: &std::path::Path);
pub fn open_url(url: &str);
pub fn show_dialog(title: &str, message: &str, buttons: &[&str]) -> String;
pub fn show_choose_list(title: &str, message: &str, items: &[&str]) -> Vec<String>;
pub fn open_local_network_settings();
pub fn restart_app(exe: &std::path::Path);
pub fn run_update_command();
```
Each delegates to `macos::fn_name` under `#[cfg(target_os = "macos")]` or `linux::fn_name` under `#[cfg(target_os = "linux")]`.

**Linux dialog strategy:** use `tauri-plugin-dialog` (already in Cargo.toml) via a blocking wait on `app.dialog().message()` with custom buttons. The plugin ships cross-platform implementations (GTK MessageDialog on Linux).

**Linux open strategy:** `xdg-open` via `std::process::Command`. No new dependencies.

**Linux update strategy:** open GitHub release URL in default browser. No auto-install — user downloads AppImage/deb manually.

**Linux dock strategy:** no-op. Linux has no global dock concept; taskbar presence is already governed by `skipTaskbar: true` in `tauri.conf.json`.

## Work Breakdown
### Phase 3A — Platform facade (c3-104)

1. Create `src-tauri/src/platform/linux.rs` with stubs for every facade fn.
2. Rewrite `src-tauri/src/platform/mod.rs` to export the facade and route by `#[cfg(...)]` to macos/linux modules.
3. Fix `platform/macos.rs`: gate `set_dock_visibility` body with `#[cfg(target_os = "macos")]` (moves the cross-platform `set_shadow`/`set_visible_on_all_workspaces` calls into the facade's shared path).
4. Add the `#[cfg(not(target_os = "macos"))]` stub for `set_dock_visibility` in macos.rs (trivial no-op) so the file compiles on Linux — or move all `ActivationPolicy` code into a macos-only block.
### Phase 3B — Dialog migration (c3-112, c3-113)

1. Move `macos_dialog` and `macos_choose_list` from `setup/shell.rs` into `platform/macos.rs` (gated).
2. Implement `linux::show_dialog` and `linux::show_choose_list` using `tauri-plugin-dialog` with blocking message boxes. For choose-list with multi-select, fall back to sequential yes/no prompts per item — the list is never more than 3 entries (zsh/bash/fish).
3. Update all 8 call sites in `setup/mod.rs` and `lib.rs::preview_dialog` to use `platform::show_dialog` / `platform::show_choose_list`.
4. Update `updater.rs`: replace every `osascript` with `platform::show_dialog`, replace Terminal.app brew script with `platform::run_update_command` (macOS: existing brew flow; Linux: `platform::open_url(&release_url)`).
### Phase 3C — Misc cross-platform fixes

1. `lib.rs::open_log_dir`: replace `Command::new("open")` with `platform::open_path(&log_dir)`.
2. `lib.rs::request_local_network`: on Linux, skip the settings URL fallback — mDNS permission prompts don't exist there. Gate with `#[cfg(target_os = "macos")]` for the settings URL branch.
3. `lib.rs::preview_dialog`: route all `osascript` calls through the new facade.
4. `setup/mod.rs::auto_setup`: replace `Command::new("open").arg("-a").arg(&exe)` with `platform::restart_app(&exe)` which on Linux uses `Command::new(&exe)`.
### Phase 3D — Docs + rule update

1. `c3-0` (system): broaden goal from "macOS desktop mascot" to "macOS and Linux desktop mascot".
2. `c3-1` (Rust Backend): update Responsibilities to note Linux support; expand platform adapter row.
3. `c3-104` (platform-adapter): rewrite Goal to describe the cross-platform facade, add `## Dependencies` row for Linux, update Container Connection prose.
4. `rule-macos-cfg-gate`: retitle or rephrase to `platform-cfg-gate`; extend Golden Example with a Linux counterpart block; update Not This table.
5. Root `CLAUDE.md`: under "Architecture" section add a Linux row; remove "macOS-only" claims in the Important Details section.
6. Code-map: add `src-tauri/src/platform/linux.rs` → c3-104 via `c3x codemap` or manual ref.
### Phase 4 — Audit

1. `c3x check` — zero issues.
2. `cd src-tauri && cargo check` on Linux host (this WSL2 machine).
3. Runtime smoke test: `bun run tauri dev` from WSL2, confirm mascot window appears with transparent background on WSLg.
4. Mark ADR `implemented`.
## Out of Scope

- CI: Linux build pipeline / AppImage release workflow. Post-ADR item.
- Windows native (non-WSL2): requires entirely different `platform/windows.rs`; different ADR.
- Homebrew cask replacement with Flatpak/Snap. Post-ADR item.
- mDNS functionality under WSL2 NAT: risk-tracked, not blocked on by this ADR. If multicast fails on WSLg, peer discovery silently shows no peers — acceptable degraded behaviour.
- Tray icon on Linux: Tauri 2 supports it via libayatana-appindicator but WSLg may not render system tray. If broken, hide tray on Linux for now — tracked but not blocking.
- Auto-updater install path on Linux: defer until a release channel exists.
## Risks / Open Questions

- **WSLg transparency fidelity:** WSLg's GPU compositor may ignore the `transparent: true` flag and render an opaque window frame. Mitigation: visual validation before sign-off. Fallback: custom GTK window adapter (out of scope for this ADR; spin new ADR if needed).
- **tauri-plugin-dialog blocking API:** the plugin is primarily async; blocking wait from a non-Tokio thread may deadlock. Mitigation: use `tauri::async_runtime::block_on` or refactor call sites to spawn tasks. Prototype before full migration.
- **mDNS multicast on WSL2:** WSL2 uses NAT networking by default; multicast may not traverse to host. If peer discovery is empty, document the `wsl --set-version 2` + mirrored networking mode (Windows 11 22H2+) workaround, don't attempt a code fix.
- **GTK file picker vs osascript choose-list:** current `macos_choose_list` allows multi-select; GTK MessageDialog does not. Fallback: sequential yes/no per shell. UX regression acknowledged for Linux.
- **System tray on WSLg:** unverified. If `TrayIconBuilder::build` panics on Linux, wrap in `if let Err(...)` and log a warning.
- **Setup restart via `exec`:** `std::process::Command::new(exe).spawn()` then `exit(0)` may not fully detach on Linux; leftover zombie possible. Acceptable for a first-launch flow.
