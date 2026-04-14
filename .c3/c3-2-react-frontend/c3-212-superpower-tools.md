---
id: c3-212
c3-seal: 4f6aff8196ec97a8ef37f48aa5dc10357d579f195ece13f2f2b506d64508a9e6
title: superpower-tools
type: component
category: feature
parent: c3-2
goal: Ship a developer-only window that surfaces live logs, lets QA exercise every status and dialog via scenarios, and is gated behind a dev-mode toggle unlocked by clicking the version string ten times in Settings.
uses:
    - ref-cross-window-sync
    - rule-data-testid
---

## Goal

Ship a developer-only window that surfaces live logs, lets QA exercise every status and dialog via scenarios, and is gated behind a dev-mode toggle unlocked by clicking the version string ten times in Settings.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Log buffer via get_logs command | c3-103 |
| IN | Dev mode flag | c3-201 |
| OUT | scenario_override command → status hook | c3-201 |
| OUT | preview_dialog command → setup flow | c3-112 |
## Container Connection

SuperpowerTool.tsx runs inside its own window (superpower.html, superpower-main.tsx). It polls get_logs on a 1s interval for the log viewer, and the scenarios directory holds one React component per scenario (PetStatusScenario, DialogPreviewScenario) registered in scenarios/registry.ts. DevTag.tsx is the small purple launcher button that opens this window. The scenario viewer uses scenario_override to force any Status without affecting real sessions.
