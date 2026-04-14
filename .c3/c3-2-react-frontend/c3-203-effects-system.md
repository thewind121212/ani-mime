---
id: c3-203
c3-seal: 33241612484410de0d1985173ca8fd3922dcdee7e1df0c64c575df16e42a639f
title: effects-system
type: component
category: foundation
parent: c3-2
goal: Provide a plug-and-play registry of visual effects that trigger on status transitions, each with its own settings toggle, optional temporary window expansion, and automatic teardown after a fixed duration. Effects live in src/effects/<slug>/ and are registered in src/effects/index.ts.
---

## Goal

Provide a plug-and-play registry of visual effects that trigger on status transitions, each with its own settings toggle, optional temporary window expansion, and automatic teardown after a fixed duration. Effects live in src/effects/<slug>/ and are registered in src/effects/index.ts.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Current status transitions | c3-201 |
| IN | Per-effect enabled flags | c3-201 |
| OUT | Rendered overlay composed into the main window | c3-210 |
## Container Connection

EffectOverlay.tsx detects status transitions, looks up the matching effect in the registry, checks useEffectEnabled(id), expands the window via the Tauri window API if the effect declares expandWindow, renders the effect component, and restores the window when the effect ends. The shadow-clone effect is the first implementation and works for custom mimes as well as built-in pets.
