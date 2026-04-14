---
id: ref-tauri-events
c3-seal: 0f36fad540b3406a0b5c87a032697ff4e068ca8fa73bbefedffb95230af45bd5
title: tauri-events
type: ref
goal: Define how backend state changes reach the frontend and how settings windows stay in sync across the main, settings, and superpower windows.
---

## Goal

Define how backend state changes reach the frontend and how settings windows stay in sync across the main, settings, and superpower windows.

## Choice

Two channels, both using Tauri's global event system:

1. Backend → Frontend: app.emit("kebab-case-event", payload) from Rust, listen<T>("kebab-case-event", cb) from a dedicated hook on the React side. Payloads are JSON-serializable only.
2. Cross-window broadcast (frontend-only): the originating hook calls emit(name, value) after persisting, and all windows listen via the same hook — theme, pet, nickname, glowMode, bubbleEnabled, dev-mode follow this pattern.
## Why

Tauri events are already global (every window receives every event), so splitting status into a new plugin or a new IPC mechanism would duplicate functionality. Using the same listen+emit pair for backend events and cross-window broadcasts keeps the hook layer uniform — every hook looks the same, every test can mock one plugin. JSON-only payloads keep the serialization boundary simple and prevent leaking Rust types into TypeScript.

## How

- Backend always goes through emit_if_changed() for status — deduplicates before calling app.emit("status-changed", ...)
- Other events (task-completed, visitor-arrived, peers-changed, mcp-say, mcp-react, dog-away, discovery-hint, discovery-error) are emitted directly once per state change
- Each hook registers exactly one listener per event, returns the unlisten function from useEffect, and calls it on unmount
- Cross-window settings hooks follow the useSetting pattern: load from Store on mount, listen for the broadcast event, persist + broadcast on set
- Never emit status-changed directly from Rust — always go through emit_if_changed()
