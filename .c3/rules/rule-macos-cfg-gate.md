---
id: rule-macos-cfg-gate
c3-seal: 4ee299883dcc4c667f5999a92761bec1191ee1ae6e1d68ca44668d4254839db8
title: macos-cfg-gate
type: rule
goal: Keep every OS-specific API call behind a cfg gate so the Rust crate builds on both macOS and Linux. Cross-platform callers go through the platform facade and never see target_os checks directly.
---

## Goal

Keep every OS-specific API call behind a cfg gate so the Rust crate builds on both macOS and Linux. Cross-platform callers go through the platform facade and never see target_os checks directly.

## Rule

Any Rust code that touches `cocoa`, `objc`, AppKit/Foundation APIs, `tauri::ActivationPolicy`, `osascript`, macOS `open` URL schemes, GTK, `zenity`, `xdg-open`, or other OS-only surfaces MUST live inside a module gated with `#[cfg(target_os = "...")]`. The cross-platform facade in `platform/mod.rs` MUST re-export the same function names from `macos` and `linux` submodules so that callers only write `platform::fn_name(...)` and never see a `cfg` themselves. New OS-specific behaviour MUST be added as a pair of functions with identical signatures in both `platform/macos.rs` and `platform/linux.rs`.

## Golden Example

```rust
// src-tauri/src/platform/mod.rs
#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "macos")]
pub use macos::{show_dialog, open_url};

#[cfg(target_os = "linux")]
pub use linux::{show_dialog, open_url};
```
```rust
// src-tauri/src/platform/macos.rs
pub fn show_dialog(title: &str, message: &str, buttons: &[&str]) -> String {
    let script = format!(r#"display dialog "{}" with title "{}" buttons {{ ... }}"#, message, title);
    let out = std::process::Command::new("osascript").arg("-e").arg(&script).output().ok()?;
    // parse osascript output...
    String::from_utf8_lossy(&out.stdout).to_string()
}

pub fn open_url(url: &str) {
    let _ = std::process::Command::new("open").arg(url).spawn();
}
```
```rust
// src-tauri/src/platform/linux.rs
pub fn show_dialog(title: &str, message: &str, buttons: &[&str]) -> String {
    let mut cmd = std::process::Command::new("zenity");
    cmd.arg("--question").arg(format!("--title={}", title)).arg(format!("--text={}", message));
    // zenity handling...
    let out = cmd.output().unwrap();
    if out.status.success() { buttons[0].to_string() } else { buttons[1].to_string() }
}

pub fn open_url(url: &str) {
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}
```
```rust
// caller — no cfg gates at call site
crate::platform::show_dialog("Title", "Message", &["Yes", "No"]);
crate::platform::open_url("https://example.com");
```
## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| use cocoa::appkit::NSWindow; at module top with no cfg | Place use cocoa::... inside platform/macos.rs which is itself declared under #[cfg(target_os = "macos")] in mod.rs | The crate won't compile on Linux — cocoa is only in the macos target dep table |
| Calling platform::macos::set_dock_visibility(...) directly from lib.rs | Call platform::set_dock_visibility(...) and let the facade pick the OS impl | Direct access to a cfg-gated submodule forces every caller to know which OS they're on, defeating the facade |
| Inline #[cfg(target_os = "macos")] inside a cross-platform function body | Split into two sibling functions — one in macos.rs, one in linux.rs — with identical signatures | Scattered cfg attributes are harder to review and leave silent fall-through cases on new platforms |
| Adding a function to platform/macos.rs without a counterpart in platform/linux.rs | Add a stub (no-op, log line, or sensible fallback) to linux.rs at the same time | mod.rs re-exports both symbol sets; a missing symbol breaks the non-gated pub use on one of the platforms |
| std::process::Command::new("osascript") directly in setup/mod.rs or updater.rs | Route through platform::show_dialog(...) and platform::run_update_command(...) | Direct shell-outs hide the OS dependency from the facade and break on Linux |
## Scope

Applies to `src-tauri/src/platform/mod.rs`, `src-tauri/src/platform/macos.rs`, `src-tauri/src/platform/linux.rs`, and any new `platform/<target>.rs` module. Callers in `lib.rs`, `setup/mod.rs`, `setup/shell.rs`, and `updater.rs` MUST use the `platform::` facade exclusively — no `#[cfg]` attributes at call sites, no direct shell-outs to `osascript` / `open` / `xdg-open` / `zenity`, no imports from `cocoa` / `objc` / `gtk` outside the matching `platform/<target>.rs` module.
