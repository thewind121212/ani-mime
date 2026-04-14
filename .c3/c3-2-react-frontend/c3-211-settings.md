---
id: c3-211
c3-version: 4
c3-seal: ac6901cc1da016db306f389f61f4dbdcb9126b7b6f7e49e45a1caa5ae516cb93
title: Settings
type: component
category: feature
parent: c3-2
goal: Host the standalone settings window (General, Mime, About tabs) where users pick theme, pet/character, nickname, glow mode, bubble toggle, effect toggles, dock visibility, custom mime imports, and see version + update info — persisting each change through the Tauri store and broadcasting so other windows update live.
summary: Separate Tauri window (620×440) with tabbed UI for General (theme, glow), Mime (pet grid), and About sections, backed by Tauri Store for persistence
uses:
    - ref-cross-window-sync
    - ref-theming
    - rule-data-testid
---

## Goal

Host the standalone settings window (General, Mime, About tabs) where users pick theme, pet/character, nickname, glow mode, bubble toggle, effect toggles, dock visibility, custom mime imports, and see version + update info — persisting each change through the Tauri store and broadcasting so other windows update live.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Current settings values and broadcast subscriptions | c3-201 |
| IN | Custom mime list | c3-213 |
| IN | Effect registry | c3-203 |
| OUT | 10-click gesture unlocks Superpower Tool | c3-212 |
## Container Connection

Runs in its own window via settings.html and settings-main.tsx. The 10-click gesture on the version string toggles dev mode, which adds a "Superpower" entry to the sidebar and unlocks c3-212. All persistence and cross-window sync goes through the hooks in c3-201 — Settings never touches the Tauri store plugin directly.
