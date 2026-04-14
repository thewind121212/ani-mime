---
id: ref-cross-window-sync
c3-seal: 6c06e20b1f2c0f57d587b486a7ea2def62367c94e7e9ffcaf7c689164629b019
title: cross-window-sync
type: ref
goal: Keep the main, settings, and superpower windows in sync on shared preferences (theme, pet, nickname, glow, bubble enabled, dev mode) without a global state store.
---

## Goal

Keep the main, settings, and superpower windows in sync on shared preferences (theme, pet, nickname, glow, bubble enabled, dev mode) without a global state store.

## Choice

Per-setting hook that follows the useSetting pattern:

1. Read from Store("settings.json") on mount
2. listen<T>("setting-changed", cb) and update local state
3. On set: setState, store.set + store.save, emit("setting-changed", value)
Every window runs the same hooks, so every window receives every broadcast. The store is the persistence layer; Tauri events are the cross-window bus.

## Why

A global state library (Zustand, Jotai, Redux) would be overkill for half a dozen preferences and would force us to pull in a provider and a DevTools dependency. Per-hook persistence keeps each concern self-contained: deleting a setting means deleting one file, not editing a shared reducer. Tauri's global events are already instant across windows, so piggy-backing on them is zero-cost. The result is also trivially testable — mock one plugin, assert one emit + one listen per hook.

## How

- Hook file lives in src/hooks/useThing.ts and never talks to the store from outside that file
- Default value is hard-coded inside the hook so the UI renders before the store finishes loading
- Use a loaded boolean to hide UI or pass through defaults until the store returns
- Cleanup: the useEffect return calls the unlisten function (await the listen promise and call the returned fn)
- Event name matches the setting name with -changed suffix (theme -> theme-changed, pet -> pet-changed)
- Never persist without broadcasting and never broadcast without persisting
