---
id: c3-2
c3-version: 4
c3-seal: 255f29cc325d647d0eeb8dceb291a1c271d1893f7619ca4f5c69c9c45760a152
title: React Frontend
type: container
boundary: app
parent: c3-0
goal: Visualize the mascot and its state as animated pixel art with status indicators, a settings window, a developer superpower window, custom mime imports, peer visit rendering, and plug-and-play visual effects — all as a React 19 + TypeScript frontend driven by Tauri events and the persistent store.
summary: React 19 + TypeScript frontend using CSS sprite animation, Tauri event listeners, persistent store for settings, and multiple windows (main, settings, superpower)
---

## Goal

Visualize the mascot and its state as animated pixel art with status indicators, a settings window, a developer superpower window, custom mime imports, peer visit rendering, and plug-and-play visual effects — all as a React 19 + TypeScript frontend driven by Tauri events and the persistent store.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-201 | Hooks Layer | foundation | active | Bridges Tauri events and store into React state |
| c3-202 | Sprite Engine | foundation | active | CSS sprite animation registry with auto-freeze |
| c3-203 | Effects System | foundation | active | Plug-and-play visual effects on status transitions |
| c3-210 | Mascot UI | feature | active | Main window: sprite, status pill, speech bubble, drag |
| c3-211 | Settings | feature | active | Settings window persisted through the Tauri store |
| c3-212 | Superpower Tools | feature | active | Dev-only log viewer and scenario runner |
| c3-213 | Smart Import | feature | active | Custom mime sprite sheet importer |
| c3-214 | Visitor Dogs | feature | active | Peer visit rendering and outgoing visit initiation |
## Responsibilities

- Own the three windows (main, settings, superpower) with their own entry points and HTML shells
- Subscribe to every relevant Tauri event via hooks and fan the state out to components
- Persist user preferences through the Tauri store and broadcast changes cross-window so all windows stay in sync
- Render the mascot and its status pill with pixel-perfect CSS sprite animation and theme-aware styling
- Expose developer tools behind a 10-click gesture on the version string and never display them in normal mode
- Let users import custom mime sprite sheets and surface them next to built-in pets
- Render visiting peer dogs with mirrored 96x96 sprites and a slide-in animation
## Complexity Assessment

Hooks are the single point of contact with the plugin layer — introducing a bypass would fragment state and break cross-window sync. Every status must be registered across Status type, sprite registry, pill color, label, and backend priority (five files in lockstep). CSS sprite animations must use image-rendering: pixelated and steps() to stay crisp and GPU-friendly.
