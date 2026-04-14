---
id: c3-3
c3-version: 4
c3-seal: 48d4dd7cf8b15d108082b88569d02c4e8ac39e6aeb69ea690af110fa962b67bc
title: Shell Integration
type: container
boundary: library
parent: c3-0
goal: Bridge developer terminal and Claude Code activity to the Rust backend via HTTP and MCP so the mascot can react to commands, dev servers, AI tool usage, and sessions without requiring any native IPC or daemon.
summary: Shell hook scripts for zsh, bash, and fish that classify commands, report state transitions, and send heartbeats to port 1234, plus Claude Code hook scripts for AI activity tracking
---

## Goal

Bridge developer terminal and Claude Code activity to the Rust backend via HTTP and MCP so the mascot can react to commands, dev servers, AI tool usage, and sessions without requiring any native IPC or daemon.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-301 | Terminal Mirror | feature | active | Shell hook scripts for zsh, bash, fish |
| c3-310 | Claude Hooks | feature | active | Claude Code settings.json hook entries |
| c3-311 | MCP Server | feature | active | Node.js MCP sidecar translating tools to HTTP |
## Responsibilities

- Classify shell commands as task or service, report state transitions via curl, and heartbeat every 20 seconds to prove liveness
- Keep Claude Code's activity visible through hook entries that use the reserved virtual PID 0
- Expose Claude Code's pet_say, pet_react, and pet_status tools via an MCP sidecar that translates each JSON-RPC call into an HTTP request on 127.0.0.1:1234
- Stay non-intrusive: every curl call uses --max-time 1, discards output, and tolerates a dead backend so user shells and Claude Code are never blocked
- Remain installable from scratch by the Rust setup flow (c3-112) and stay update-safe by copying fresh script and MCP files on every launch
## Complexity Assessment

All three components depend on the hardcoded port 1234 and the hardcoded Host 127.0.0.1 — changing either requires editing shell scripts, Claude Code hook commands, and the MCP server together. The pid=0 contract must stay reserved in the Rust backend for Claude Code to work. Hook commands must fail open (|| true, /dev/null, --max-time 1) or a backend crash could hang the user's shell.
