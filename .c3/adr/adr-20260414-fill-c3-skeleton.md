---
id: adr-20260414-fill-c3-skeleton
c3-seal: 8c5c6196fdda072aa2703a28f3fe0b36d28526ebc88d9ed6e71d30e34963f77d
title: fill-c3-skeleton
type: adr
goal: 'The C3 skeleton in this repo is frontmatter-only: 15 entities have titles and one-line goals but no body content, no code-map, no refs, no rules, no CLAUDE.md propagation. Coverage is 0% against 305 files; `c3x check` reports 31 missing-section warnings; docs/ parallel documentation (30+ files) is entirely outside C3. This ADR is the work order to turn the skeleton into a complete, validated C3 baseline.'
status: implemented
date: "2026-04-14"
---

## Goal

The C3 skeleton in this repo is frontmatter-only: 15 entities have titles and one-line goals but no body content, no code-map, no refs, no rules, no CLAUDE.md propagation. Coverage is 0% against 305 files; `c3x check` reports 31 missing-section warnings; docs/ parallel documentation (30+ files) is entirely outside C3. This ADR is the work order to turn the skeleton into a complete, validated C3 baseline.

## Scope

1. Fill required schema sections on all 15 existing entities (Goal, Dependencies/Components/Responsibilities per type).
2. Scaffold `code-map.yaml`, assign every production source file to a component, and add `_exclude` patterns for icons, mocks, tests, assets, build artifacts.
3. Add components for code areas not represented today: updater, logger, MCP server, effects system, scenarios, smart-import, visitors.
4. Extract cross-cutting refs from `docs/`: architecture overview, HTTP API contract, Tauri events contract, state priority, peer discovery, setup flow, theming, sprite animation.
5. Add rules for conventions in root CLAUDE.md: HTTP port 1234 hardcoding, `app_log!`/`app_warn!`/`app_error!` macros, `data-testid` conventions, macOS `#[cfg]` gating, reserved session pid=0.
6. Propagate `<!-- c3-generated -->` blocks into root CLAUDE.md (nested CLAUDE.md in source directories is out of scope for this ADR — will follow as a separate pass once structure settles).
7. `c3x check` must return zero errors and zero warnings at the end.
## Out of scope

- Changing any source code in `src/`, `src-tauri/src/`, or shell scripts.
- Deleting anything under `docs/` (refs cite them as sources, but the files stay).
- Per-directory nested CLAUDE.md files (follow-up).
