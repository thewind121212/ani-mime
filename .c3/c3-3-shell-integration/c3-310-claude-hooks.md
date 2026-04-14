---
id: c3-310
c3-version: 4
c3-seal: abc3ff659ff5c49becede61e3046f8c15f02eb7700e911aeea81fe44edac3309
title: Claude Hooks
type: component
category: feature
parent: c3-3
goal: Track Claude Code AI activity by configuring hook entries in ~/.claude/settings.json so each tool-use and session event curls the HTTP server with the reserved virtual PID 0, letting the backend treat Claude as a single always-alive session that never times out.
summary: Shell script configured in ~/.claude/settings.json hooks (PreToolUse, Stop, SessionEnd) that curls the HTTP server with pid=0 to indicate Claude is thinking vs idle
uses:
    - ref-http-api-contract
    - ref-setup-flow
    - rule-http-port-1234
    - rule-pid-zero-reserved
---

## Goal

Track Claude Code AI activity by configuring hook entries in ~/.claude/settings.json so each tool-use and session event curls the HTTP server with the reserved virtual PID 0, letting the backend treat Claude as a single always-alive session that never times out.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Initial hook installation | c3-112 |
| OUT | /status signals with pid=0 | c3-101 |
## Container Connection

Hook commands use curl -s --max-time 1 ... > /dev/null 2>&1 so a dead backend never blocks Claude Code. PreToolUse and UserPromptSubmit report busy, Stop and SessionEnd report idle, SessionStart reports idle on boot. The pid=0 contract is shared with c3-110 (watchdog never evicts pid=0) and c3-101 (routes the signal into a single virtual session).
