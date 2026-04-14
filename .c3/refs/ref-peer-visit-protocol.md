---
id: ref-peer-visit-protocol
c3-seal: f5899e49a4e7cc224eb3a981cefca65726f7843f2064815aaeca309d81857fe2
title: peer-visit-protocol
type: ref
goal: Let multiple ani-mime instances on the same LAN discover each other and exchange time-boxed dog visits with zero configuration.
---

## Goal

Let multiple ani-mime instances on the same LAN discover each other and exchange time-boxed dog visits with zero configuration.

## Choice

mDNS/Bonjour advertising on service type _ani-mime._tcp.local., instance name nickname-pid, properties nickname and pet. Discovery uses mdns-sd. Visits are plain HTTP POSTs to the peer's /visit and /visit-end on port 1234 with a 15-second fixed duration. No authentication, no negotiation, no encryption.

## Why

Zeroconf is the only practical way to discover peers on a home LAN without a central server, and Bonjour is already first-class on macOS. Reusing the HTTP server for /visit and /visit-end avoids a second transport and gives both ends retry-free fire-and-forget semantics. A fixed 15 seconds removes the need for a visit-length negotiation and matches the "fun cameo" spirit of the feature. Going stateless (no auth, no ACK) keeps the protocol simple enough to debug with curl.

## How

- Advertise via mdns-sd ServiceDaemon in a dedicated thread; filter out the local instance by comparing instance_name
- Detect local IP via a UDP connect trick (socket to 8.8.8.8:80, read local_addr without sending) — falls back to non-loopback IPv4, then IPv6
- When initiating a visit, POST to the peer's /visit and spawn a thread that sleeps VISIT_DURATION_SECS (15) then POSTs /visit-end
- Receiving side adds the visitor to AppState.visitors, emits visitor-arrived, and relies on the watchdog to expire overdue visitors if /visit-end is lost
- macOS requires NSBonjourServices in Info.plist, the com.apple.security.network.server entitlement, and post-build re-signing for ad-hoc builds; peer discovery silently fails without these
