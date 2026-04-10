# Peer Discovery & Visits

How Ani-Mime instances discover each other on the local network and exchange dog visits.

## Overview

Multiple Ani-Mime instances on the same LAN can discover each other via mDNS (Bonjour) and send their dogs to visit other screens.

```
Machine A                              Machine B
┌──────────────┐                      ┌──────────────┐
│  Ani-Mime    │  mDNS broadcast      │  Ani-Mime    │
│  discovery   │ ◄──────────────────► │  discovery   │
│              │                      │              │
│  HTTP :1234  │  POST /visit         │  HTTP :1234  │
│              │ ──────────────────►  │              │
│              │  POST /visit-end     │              │
│              │ ──────────────────►  │              │
└──────────────┘                      └──────────────┘
```

## mDNS Discovery

### Service Registration

On startup, each instance registers an mDNS service:

- **Service type**: `_ani-mime._tcp.local.`
- **Instance name**: `{nickname}-{process_id}` (e.g., `Alice-12345`)
- **Properties**: `nickname`, `pet` (advertised to peers)
- **Port**: HTTP server port (default 1234)

### Address Detection

The discovery module detects the local IP via UDP socket trick (connect to 8.8.8.8:80, read local addr - no traffic sent). Falls back through:

1. Non-loopback IPv4
2. Any IPv4
3. Non-loopback IPv6
4. Any available address

### Peer Resolution

When a peer is discovered (`ServiceResolved` event):
- Extract IP, port, nickname, pet from mDNS properties
- Filter out own instance (by instance name comparison)
- Store in `AppState.peers` HashMap
- Emit `peers-changed` event to frontend

### Peer Removal

When a peer disappears (`ServiceRemoved` event):
- Remove from `AppState.peers`
- Emit `peers-changed` to update UI

### No-Peers Hint

A background thread checks every 30 seconds. If no peers are found after the first check, emits `discovery-hint: "no_peers"` once (shown as speech bubble).

## Visit Protocol

### Initiating a Visit

1. User right-clicks mascot → context menu shows discovered peers
2. User selects a peer → `start_visit(peer_id, nickname, pet)` command
3. Backend:
   - Looks up peer in `AppState.peers`
   - Sets `AppState.visiting = Some(peer_id)`
   - Sends `POST /visit` to peer's HTTP server with JSON body:
     ```json
     { "pet": "rottweiler", "nickname": "Alice", "duration_secs": 15 }
     ```
   - Emits `dog-away: true` (hides local mascot)
   - Spawns thread: sleeps for `VISIT_DURATION_SECS` (15s)

### Receiving a Visit

1. `/visit` route receives POST with visitor info
2. Creates `VisitingDog { pet, nickname, arrived_at, duration_secs }`
3. Adds to `AppState.visitors`
4. Emits `visitor-arrived` event → frontend shows visitor sprite

### Ending a Visit

After the visit duration:
1. Spawned thread wakes up
2. Sends `POST /visit-end` to peer with `{ "nickname": "Alice" }`
3. Clears `AppState.visiting`
4. Emits `dog-away: false` (shows local mascot again)

Peer side:
1. `/visit-end` removes visitor by nickname
2. Emits `visitor-left` event → frontend removes visitor sprite

### Visit Expiration

The watchdog also monitors visitors:
- If `now - arrived_at >= duration_secs`, automatically removes the visitor
- This handles cases where the `/visit-end` call fails (network issues)

## Frontend UI

### Peer List (Context Menu)

Right-click on mascot shows available peers:
```typescript
// In App.tsx
const peers = usePeers();
// Rendered as context menu items with peer nickname + pet icon
```

### Visitor Dogs (`VisitorDog.tsx`)

- 96x96 sprites (smaller than main 128x128)
- Horizontally mirrored (`scaleX(-1)`) to face the main mascot
- Positioned on the right side with staggered offsets
- Slide-in animation (0.5s ease-out from right)
- Always display `idle` sprite

### Visiting State

When the local dog is visiting someone:
- Status overridden to `"visiting"` via `dog-away` event
- Main mascot hidden (replaced with placeholder or hidden entirely)
- Status pill shows purple "visiting" dot

## macOS Permissions

Peer discovery requires Bonjour entitlements for release builds:

```xml
<!-- In entitlements -->
<key>com.apple.security.network.client</key>
<true/>
<key>com.apple.security.network.server</key>
<true/>
```

Without these, mDNS registration silently fails in sandboxed builds.

## Limitations

- **LAN only** - mDNS doesn't cross subnet boundaries (no WAN discovery)
- **No authentication** - any Ani-Mime instance on the network can visit
- **No rejection** - visits are automatically accepted
- **No encryption** - HTTP traffic is plaintext
- **Single visit** - can only visit one peer at a time
- **Fixed duration** - visits last exactly 15 seconds, not configurable by user
