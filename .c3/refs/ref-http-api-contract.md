---
id: ref-http-api-contract
c3-seal: 35241a77ce7db67a0133361e2068d88174073570266d4de5807374cc93f3eb3c
title: http-api-contract
type: ref
goal: Define the HTTP surface that shell hooks, Claude Code hooks, peers, and the MCP sidecar use to talk to the backend. Any integration outside the app binary goes through this contract.
---

## Goal

Define the HTTP surface that shell hooks, Claude Code hooks, peers, and the MCP sidecar use to talk to the backend. Any integration outside the app binary goes through this contract.

## Choice

One tiny_http server on 127.0.0.1:1234 (overridable via ANI_MIME_PORT env var), all responses 200 OK with CORS wildcard. Endpoints are flat paths with query-string or JSON body:

- GET /status?pid=N&state=busy|idle&type=task|service
- GET /heartbeat?pid=N
- POST /visit (JSON: instance_name, pet, nickname, duration_secs)
- POST /visit-end (JSON: instance_name, nickname)
- POST /mcp/say (JSON: message, duration_secs)
- POST /mcp/react (JSON: reaction, duration_secs)
- GET /mcp/pet-status
- GET /debug
## Why

Shells cannot speak Unix domain sockets portably and cannot reach the Tauri WebView directly. HTTP on a loopback port is trivial to hit from any language with curl, works across zsh/bash/fish/Claude Code/Node.js without special libraries, and naturally handles peer-to-peer visits over the LAN when bound to 0.0.0.0. tiny_http keeps the dependency footprint small.

## How

- Bind address is 0.0.0.0 so peers on the LAN can reach /visit and /visit-end; the port stays 1234 unless ANI_MIME_PORT is set
- Every route locks AppState briefly, mutates, drops the lock, then calls emit_if_changed() outside the critical section
- Routes never block on I/O while holding the mutex
- Hook commands (shell, Claude) always pipe `|| true` or redirect errors to /dev/null so an offline backend never breaks the caller
- curl calls from shell hooks use --max-time 1 so a dead server costs at most one second per signal
