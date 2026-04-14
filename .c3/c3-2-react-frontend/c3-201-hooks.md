---
id: c3-201
c3-version: 4
c3-seal: 0348d992c223506fcda74f661410fc497d40d7e12fd8f4eb88765d8e5fb9154e
title: Hooks Layer
type: component
category: foundation
parent: c3-2
goal: Bridge the Tauri backend (events + invoked commands) and the Tauri persistent store into React state through one hook per concern, so components can compose useStatus, usePeers, useVisitors, useBubble, useTheme, usePet, useNickname, useGlow, useDrag, useDevMode, and friends without touching the plugin layer directly.
summary: Custom React hooks (useStatus, usePeers, useVisitors, useBubble, useTheme, usePet, useNickname, useGlow, useDrag, useDevMode) that listen to Tauri events and manage frontend state
uses:
    - ref-cross-window-sync
    - ref-status-priority
    - ref-tauri-events
    - ref-theming
---

## Goal

Bridge the Tauri backend (events + invoked commands) and the Tauri persistent store into React state through one hook per concern, so components can compose useStatus, usePeers, useVisitors, useBubble, useTheme, usePet, useNickname, useGlow, useDrag, useDevMode, and friends without touching the plugin layer directly.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | status-changed, task-completed events | c3-101 |
| IN | Resolved UI state | c3-102 |
| IN | Watchdog status transitions | c3-110 |
| IN | peers-changed, visitor-arrived, visitor-left, dog-away, discovery-hint events | c3-111 |
| OUT | React state consumed by Mascot UI | c3-210 |
| OUT | React state consumed by Settings | c3-211 |
| OUT | React state consumed by Superpower Tool | c3-212 |
| OUT | React state consumed by Smart Import | c3-213 |
| OUT | React state consumed by Visitor Dogs | c3-214 |
| OUT | Status transitions driving Effects System | c3-203 |
## Container Connection

Every hook cleans up its Tauri listener in a useEffect return, uses the shared Store("settings.json") for persistence, and follows the useSetting pattern — load on mount, subscribe to the broadcast event, persist + broadcast on change. Persisted values (theme, pet, nickname, glowMode, bubbleEnabled, hideDock, effect enabled flags, skipped updater version) all flow through this layer. Cross-window broadcasts like theme-changed, pet-changed, bubble-changed, glow-changed, nickname-changed, dev-mode-changed keep the main, settings, and superpower windows in sync.
