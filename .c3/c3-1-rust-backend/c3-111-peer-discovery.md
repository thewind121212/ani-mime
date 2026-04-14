---
id: c3-111
c3-version: 4
c3-seal: fb0009e166108d6f213642a81ea9cbb8ff3a8828b810da0650d422b5d3fbb4e6
title: Peer Discovery
type: component
category: feature
parent: c3-1
goal: Advertise this instance on _ani-mime._tcp.local. and browse for peers via mDNS, then drive the visit protocol — outgoing POST /visit to initiate, incoming POST /visit to render visitors, scheduled POST /visit-end to clean up after 15 seconds. Filters out its own instance so the local machine is never a visitable target.
summary: mdns-sd based service registration and browsing for _ani-mime._tcp.local, with HTTP-based visit protocol for sending dogs to peers
uses:
    - ref-http-api-contract
    - ref-peer-visit-protocol
    - ref-tauri-events
    - rule-app-log-macros
    - rule-http-port-1234
---

## Goal

Advertise this instance on _ani-mime._tcp.local. and browse for peers via mDNS, then drive the visit protocol — outgoing POST /visit to initiate, incoming POST /visit to render visitors, scheduled POST /visit-end to clean up after 15 seconds. Filters out its own instance so the local machine is never a visitable target.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | start_visit Tauri command | c3-214 |
| OUT | peers-changed, discovery-hint, discovery-error, dog-away events | c3-201 |
| OUT | POST /visit and POST /visit-end to remote peers | c3-101 |
| OUT | Peer map and visiting field mutations | c3-102 |
| OUT | Log lines | c3-103 |
## Container Connection

discovery.rs runs a mdns-sd ServiceDaemon in a dedicated thread. It resolves IPv4 first (falling back through IPv6) via a UDP connect trick to 8.8.8.8:80 and advertises nickname + pet properties. The visit thread sleeps VISIT_DURATION_SECS (15) then POSTs /visit-end to the peer.
