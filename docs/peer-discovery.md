# Peer Discovery & Visits

How Ani-Mime instances discover each other on the local network and exchange dog visits.

## Overview

Multiple Ani-Mime instances on the same LAN discover each other and send their dogs to visit other screens. Discovery runs across **three parallel channels** so that if one is blocked by the network, the others still work.

```
Machine A                                           Machine B
┌───────────────────┐                            ┌───────────────────┐
│   Ani-Mime        │   1. mDNS  (5353)          │   Ani-Mime        │
│                   │ ◄───────────────────────►  │                   │
│   discovery.rs    │   2. Multicast (1235)      │   discovery.rs    │
│   broadcast.rs    │ ◄───────────────────────►  │   broadcast.rs    │
│                   │   3. Unicast /24 (1235)    │                   │
│                   │ ◄───────────────────────►  │                   │
│                   │                            │                   │
│   HTTP :1234      │   POST /visit              │   HTTP :1234      │
│                   │ ─────────────────────────► │                   │
│                   │   POST /visit-end          │                   │
│                   │ ─────────────────────────► │                   │
└───────────────────┘                            └───────────────────┘
```

All three channels write into the same `AppState.peers` HashMap keyed by `instance_name`, so a peer found via multiple channels appears once in the UI.

### Channel summary

| # | Channel | Source | Cadence | Target | When it wins |
|---|---------|--------|---------|--------|--------------|
| 1 | **mDNS** | `discovery.rs` | TTL-driven | `_ani-mime._tcp.local.` via `224.0.0.251` | Home / small office networks |
| 2 | **Multicast announce** | `broadcast.rs::announce_loop` | every 5s | `224.0.0.200:1235` | Networks that allow arbitrary link-local multicast |
| 3 | **Unicast subnet scan** | `broadcast.rs::unicast_scan_loop` | every 30s | every host in local `/24` at `:1235` | Networks that block all multicast but allow unicast (managed WiFi / Bonjour Gateways) |

### Network compatibility matrix

| Network type | mDNS | Multicast 224.0.0.200 | Unicast /24 scan |
|--------------|:----:|:---------------------:|:----------------:|
| Home WiFi / small office | ✅ | ✅ | ✅ |
| Managed WiFi w/ Bonjour Gateway | ⚠️ partial | ❌ | ✅ |
| WiFi with full client isolation | ❌ | ❌ | ❌ |
| Guest WiFi / different VLAN | ❌ | ❌ | ❌ *(different subnet)* |

If unicast scan doesn't work either, the only path forward is a signaling server outside the LAN — not currently implemented.

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

## UDP Announce Protocol (`broadcast.rs`)

The broadcast module runs independently from mDNS and provides two channels: multicast announce (fast, when it works) and unicast subnet scan (slow but network-proof).

### Packet format

Every announce — multicast or unicast — carries the same JSON payload:

```json
{
  "magic": "ani-mime/1",
  "instance_name": "Alice-12345",
  "nickname": "Alice",
  "pet": "rottweiler",
  "ip": "192.168.20.42",
  "port": 1234
}
```

- `magic` — protocol tag. Foreign traffic on `:1235` that doesn't match is silently dropped.
- `instance_name` — `{nickname}-{pid}`. Unique per running process. Used as the HashMap key for dedup across channels.
- `ip` / `port` — where the sender's HTTP visit endpoint is reachable.

Payload is JSON-encoded plaintext and kept under ~200 bytes to stay well inside one UDP datagram.

### Threads

`broadcast.rs::start_broadcast` spawns four threads:

| Thread | Purpose |
|--------|---------|
| `announce_loop` | Every `ANNOUNCE_INTERVAL_SECS` (5s), sends the payload to `224.0.0.200:1235` multicast. |
| `unicast_scan_loop` | Every `UNICAST_SCAN_INTERVAL_SECS` (30s), sends the payload to every IP `.1`–`.254` in the local `/24` at `:1235`. Spaced at `UNICAST_SEND_SPACING_MS` (10ms) between sends to stay under ~100 pps. |
| `listen_loop` | Binds `0.0.0.0:1235`, joins multicast group `224.0.0.200`. Receives both multicast (via group join) and unicast (by virtue of the bind) on the same socket. Calls `handle_announce` for each valid packet. |
| `expiry_loop` | Every 5s, removes peers from `AppState.peers` whose `AppState.broadcast_seen` entry is older than `PEER_EXPIRY_SECS` (30s). Emits `peers-changed`. |

### Peer upsert

`handle_announce` for any received announce:
1. Verifies `magic == "ani-mime/1"`.
2. Filters out our own instance (one-shot `self-loop confirmed` log the first time — used as a health check for local multicast).
3. Inserts/updates `AppState.peers[instance_name]` with fresh `PeerInfo`.
4. Updates `AppState.broadcast_seen[instance_name]` with the current timestamp.
5. If this is a new peer, logs `NEW peer:` and emits `peers-changed`.
6. If already known, only logs `refresh peer:` at most once per minute per peer to avoid log spam.

### Multicast vs Unicast receive

The listen socket is bound to `0.0.0.0:1235`. It receives:
- **Multicast** packets sent to `224.0.0.200:1235` — because we joined the group via `join_multicast_v4` on the detected local IPv4 interface.
- **Unicast** packets sent to `<our-ip>:1235` — because our bind accepts unicast on that port by default.

Both go through the same `handle_announce` code path — the sender's channel is invisible to the receiver. The `from` address in the log is the sender's IP, not `224.0.0.200`, in both cases.

### Subnet derivation

`unicast_scan_loop` derives the scan range from our detected local IPv4 by taking the first three octets (a `/24` assumption). This covers the vast majority of home and office networks (`192.168.*.*`, `10.0.*.*`). Networks using `/16` or non-standard masks will only have the first 256 hosts scanned — a known limitation, acceptable for current usage.

## Visit Protocol

### Initiating a Visit

1. User right-clicks mascot → context menu shows discovered peers
2. User selects a peer → `start_visit(peer_id, nickname, pet)` command
3. Backend:
   - Looks up peer in `AppState.peers`
   - Sets `AppState.visiting = Some(peer_id)`
   - Sends `POST /visit` to peer's HTTP server with JSON body:
     ```json
     { "instance_name": "Alice-12345", "pet": "rottweiler", "nickname": "Alice", "duration_secs": 15 }
     ```
   - Emits `dog-away: true` (hides local mascot)
   - Spawns thread: sleeps for `VISIT_DURATION_SECS` (15s)

### Receiving a Visit

1. `/visit` route receives POST with visitor info
2. Creates `VisitingDog { instance_name, pet, nickname, arrived_at, duration_secs }`
3. Adds to `AppState.visitors`
4. Emits `visitor-arrived` event → frontend shows visitor sprite

### Ending a Visit

After the visit duration:
1. Spawned thread wakes up
2. Sends `POST /visit-end` to peer with `{ "instance_name": "Alice-12345", "nickname": "Alice" }`
3. Clears `AppState.visiting`
4. Emits `dog-away: false` (shows local mascot again)

Peer side:
1. `/visit-end` removes visitor by `instance_name` (falls back to `nickname` for older peers)
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

Peer discovery requires entitlements for release builds. These are defined in `src-tauri/Entitlements.plist`:

| Entitlement | Purpose |
|-------------|---------|
| `com.apple.security.cs.allow-jit` | WebView JIT under Hardened Runtime |
| `com.apple.security.cs.disable-library-validation` | Required by `macOSPrivateApi` (window transparency) |
| `com.apple.security.network.server` | mDNS multicast sockets + HTTP server on :1234 |
| `com.apple.security.network.client` | Outgoing HTTP (visit requests) + UDP (IP detection) |

Additionally, `src-tauri/Info.plist` declares:
- `NSBonjourServices`: `_ani-mime._tcp` — triggers the macOS Local Network permission dialog
- `NSLocalNetworkUsageDescription` — explains why the app needs network access

**Important**: Tauri does not embed entitlements for ad-hoc (no Developer ID) builds. The post-build script `src-tauri/script/post-build-sign.sh` re-signs the app with entitlements and re-creates the DMG. See the release build section in the README.

## Troubleshooting

### Peers not finding each other

Walk through these in order — each rules out a layer:

1. **Both machines must be on the same WiFi/LAN subnet** — none of our channels cross subnets.
2. **macOS Local Network permission** — on first launch, macOS asks to allow local network access. If denied, go to **System Settings > Privacy & Security > Local Network** and enable ani-mime.
3. **Check `/debug` endpoint** — `curl http://127.0.0.1:1234/debug` should show your `instance_name`, `registered_addrs`, and the current peers list.
4. **Read the log**, filter for `[broadcast]` and `[discovery]`:
   ```bash
   grep -E '\[broadcast\]|\[discovery\]' ~/Library/Logs/com.vietnguyenwsilentium.ani-mime/ani-mime.log | tail -40
   ```
   Key lines to look for:
   - `[broadcast] listen socket bound on 0.0.0.0:1235, joined multicast group 224.0.0.200` — socket OK
   - `[broadcast] self-loop confirmed` — local multicast end-to-end OK
   - `[broadcast] unicast scan #N done: ... sent_ok=253` — unicast scan completed
   - `[broadcast] NEW peer: ...` — 🎉 a peer was found
5. **Verify mDNS registration** — `dns-sd -B _ani-mime._tcp local.` should show your instance.
6. **Verify unicast works between machines** — `curl --max-time 3 http://<peer-ip>:1234/debug` from your machine should return the peer's state. If this fails, your network has client-to-client isolation and none of our channels will work.
7. **Entitlements missing** — if shared via DMG without the post-build sign step, mDNS silently fails. Re-build with `bun run tauri build && bash src-tauri/script/post-build-sign.sh`
8. **Quarantine attribute** — apps transferred between Macs get quarantined. Run `xattr -cr /Applications/ani-mime.app` on the receiving machine.

### Interpreting broadcast logs

| Log pattern | Meaning |
|-------------|---------|
| `FAILED to bind/join multicast ...` | Port conflict, permission denied, or interface has no IPv4. Socket never came up. |
| `self-loop confirmed` present, no `NEW peer` on either side | Network blocks multicast between clients but local pipeline works. Unicast scan should still find the peer within 30s. |
| `self-loop confirmed` absent after 30s | Local multicast is broken — usually interface-level issue. Unicast scan is your only remaining channel. |
| `unicast scan #N done: ... send_err=X` with large X | Most sends are hitting EHOSTUNREACH — could mean ARP is failing, or the subnet is sparsely populated (harmless). |

### Verify each channel independently

```bash
# 1. mDNS — see all ani-mime instances via Bonjour
dns-sd -B _ani-mime._tcp local.

# 2. Multicast — listen on the broadcast group
# (kill with Ctrl+C; use tcpdump if available)
sudo tcpdump -i any -n 'host 224.0.0.200 and port 1235'

# 3. Unicast — direct debug request to a peer
curl --max-time 3 http://192.168.20.29:1234/debug
```

### Test with a fake peer

```bash
# Make a fake mDNS peer appear in your context menu
dns-sd -R "TestBuddy-9999" "_ani-mime._tcp" "local." 1234 nickname=Buddy pet=dalmatian
```

## Limitations

- **LAN only** — no channel crosses subnet boundaries or reaches over WAN.
- **`/24` assumption in unicast scan** — only the first 256 hosts of larger subnets are reached.
- **Multicast-hostile networks degrade to 30s discovery** — the unicast scan cadence is the floor.
- **No authentication** — any Ani-Mime instance on the network can visit; any announce that matches the magic string is trusted.
- **No rejection** — visits are automatically accepted.
- **No encryption** — HTTP traffic and UDP announces are plaintext.
- **Single visit** — can only visit one peer at a time.
- **Fixed visit duration** — 15 seconds, not configurable by user.
