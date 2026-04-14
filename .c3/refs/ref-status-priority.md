---
id: ref-status-priority
c3-seal: 5ae3c2d054b73a6588153af58b0e6d305e60a06ad288279fe72c0f2bd23a818b
title: status-priority
type: ref
goal: Collapse multiple concurrent terminal sessions into a single UI status so the mascot shows one clear state even when several shells and Claude Code are active at the same time.
---

## Goal

Collapse multiple concurrent terminal sessions into a single UI status so the mascot shows one clear state even when several shells and Claude Code are active at the same time.

## Choice

Fixed priority: busy > service > idle > disconnected. resolve_ui_state() scans every session and returns the highest-priority state. searching, initializing, and visiting are orthogonal and set outside this function (searching when no session exists, initializing at boot, visiting while the dog is out).

## Why

Users think in "what is my computer doing right now?", not "which shell is the busiest?". A running command dominates a dev server (busy > service) because the user is actively waiting for it; a dev server dominates idleness because it represents ongoing work (service > idle). Disconnected is the fallback when no shells are connected at all. Any other order — such as latest-session-wins or service > busy — produces surprising UI (e.g. a yarn test hidden behind a yarn dev). A frozen priority is also cheap to reason about in tests and debug output.

## How

- resolve_ui_state() in state.rs is the single source of truth and must stay a pure function of sessions + peers
- emit_if_changed() calls resolve_ui_state() and only emits status-changed when the result differs from current_ui — never emit directly
- New statuses must be placed explicitly in the priority order inside resolve_ui_state() and also updated in the Status type, StatusPill styling, sprite registry, and status-pill.css (five files in lockstep)
- The priority order is also documented in docs/state-management.md; changing the order requires an ADR
