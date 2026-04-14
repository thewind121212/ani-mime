---
id: c3-311
c3-seal: 00daffd54f87c3c49dd247cdb3bef0fdba46db64d8f1ddf40a0fbafded273618
title: mcp-server
type: component
category: feature
parent: c3-3
goal: Bridge Claude Code to the Rust backend via a zero-dependency Node.js MCP server that exposes pet_say, pet_react, and pet_status tools and forwards each call to the HTTP server on 127.0.0.1:1234.
uses:
    - ref-http-api-contract
    - ref-setup-flow
    - rule-http-port-1234
    - rule-pid-zero-reserved
---

## Goal

Bridge Claude Code to the Rust backend via a zero-dependency Node.js MCP server that exposes pet_say, pet_react, and pet_status tools and forwards each call to the HTTP server on 127.0.0.1:1234.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Installed and registered during first-launch setup | c3-112 |
| OUT | POST /mcp/say, /mcp/react, GET /mcp/pet-status | c3-101 |
## Container Connection

server.mjs is a single Node file using only stdlib. It speaks JSON-RPC 2.0 over stdio as the MCP protocol (version 2024-11-05), exposes three tools, and translates each call to an HTTP request on 127.0.0.1:1234. The setup flow copies this file to ~/.ani-mime/mcp/server.mjs on every launch (so updates propagate) and registers it in ~/.claude.json under mcpServers.ani-mime.
