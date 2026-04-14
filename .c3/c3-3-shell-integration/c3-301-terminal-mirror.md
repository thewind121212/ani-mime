---
id: c3-301
c3-version: 4
c3-seal: 84300a6339786d920c624397a27f8194956bfa34596a40eb8148853ec6588039
title: Terminal Mirror
type: component
category: foundation
parent: c3-3
goal: 'Detect terminal activity in zsh, bash, and fish: classify each command as task or service, curl the HTTP server on preexec and precmd, send a heartbeat every 20 seconds to prove the shell is alive, and clean up the background loop on shell exit.'
summary: Three shell scripts (terminal-mirror.zsh/.bash/.fish) implementing preexec/precmd hooks, command classification (task vs service), heartbeat background loops, and curl-based HTTP reporting
uses:
    - ref-http-api-contract
    - ref-setup-flow
    - rule-http-port-1234
    - rule-pid-zero-reserved
---

## Goal

Detect terminal activity in zsh, bash, and fish: classify each command as task or service, curl the HTTP server on preexec and precmd, send a heartbeat every 20 seconds to prove the shell is alive, and clean up the background loop on shell exit.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| OUT | /status signals per command | c3-101 |
| OUT | /heartbeat signals every 20 seconds | c3-101 |
## Container Connection

Three sibling scripts live in src-tauri/script/terminal-mirror.{zsh,bash,fish} and share the same classification regex (start|dev|serve|watch|metro|docker-compose|up|run dev|run start|run serve) and the same URL format. Every curl call uses --max-time 1 and redirects output to /dev/null so a dead backend never blocks the shell. A /tmp/tauri-heartbeat-{pid} guard file prevents duplicate heartbeat loops inside a single shell process. Commands starting with claude are skipped — Claude Code reports directly via c3-310.
