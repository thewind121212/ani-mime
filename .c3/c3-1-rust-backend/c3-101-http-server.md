---
id: c3-101
c3-version: 4
c3-seal: a72f7503dda409e3d4ae863b46914bc4617ca1a1158bb9e9f6fe1b8d3d300d5c
title: HTTP Server
type: component
category: foundation
parent: c3-1
goal: Accept activity signals from shell hooks, Claude Code hooks, peer instances, and the MCP server via REST endpoints on 127.0.0.1:1234, translate each into a state mutation, and trigger frontend emission through the shared AppState. Built on tiny_http; every response is 200 OK with permissive CORS.
summary: tiny_http-based HTTP server running in a dedicated thread, handling /status, /heartbeat, /visit, and /visit-end endpoints with CORS support
uses:
    - ref-http-api-contract
    - ref-peer-visit-protocol
    - ref-tauri-events
    - rule-app-log-macros
    - rule-http-port-1234
    - rule-pid-zero-reserved
---

## Goal

Accept activity signals from shell hooks, Claude Code hooks, peer instances, and the MCP server via REST endpoints on 127.0.0.1:1234, translate each into a state mutation, and trigger frontend emission through the shared AppState. Built on tiny_http; every response is 200 OK with permissive CORS.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | /status and /heartbeat signals | c3-301 |
| IN | /status signals with pid=0 | c3-310 |
| IN | /mcp/say, /mcp/react, /mcp/pet-status requests | c3-311 |
| IN | /visit and /visit-end from discovery thread | c3-111 |
| OUT | Session mutations and UI resolution | c3-102 |
| OUT | Tauri events emitted to the frontend | c3-201 |
| OUT | Log lines | c3-103 |
## Container Connection

server.rs owns the single tiny_http::Server thread. It never mutates state directly — every request locks AppState briefly, updates the relevant session or visitor, then calls emit_if_changed(). Remote peers reach this endpoint from another ani-mime instance's c3-111 over the LAN.
