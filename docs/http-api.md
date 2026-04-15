# HTTP API Reference

The backend runs an HTTP server on `0.0.0.0:1234` (configurable via `ANI_MIME_PORT` env var). All responses return `200 OK` with `Access-Control-Allow-Origin: *`.

## Status Endpoints

### POST/GET `/status`

Report a shell or tool state change.

**Query Parameters:**

| Param | Required | Values | Description |
|-------|----------|--------|-------------|
| `pid` | Yes | Integer | Shell process ID (use `0` for Claude Code) |
| `state` | Yes | `busy`, `idle` | Current shell state |
| `type` | When state=busy | `task`, `service` | Command classification |
| `title` | No | String | Directory basename — `${PWD##*/}` |
| `pwd` | No | String (URL-encoded) | Full working directory — powers the Session List grouping |
| `tty` | No | String (URL-encoded) | Controlling TTY device, e.g. `/dev/ttys001` |

**Examples:**

```bash
# Command started (regular task)
curl "http://127.0.0.1:1234/status?pid=12345&state=busy&type=task"

# Dev server started with full context
curl -G --max-time 1 "http://127.0.0.1:1234/status" \
  --data-urlencode "pid=12345" \
  --data-urlencode "state=busy" \
  --data-urlencode "type=service" \
  --data-urlencode "pwd=$PWD" \
  --data-urlencode "tty=$TTY"

# Command finished
curl "http://127.0.0.1:1234/status?pid=12345&state=idle"
```

**Behavior:**
- Creates session if PID doesn't exist (unless `pid` doesn't map to a live process — see zombie guard below)
- Updates `ui_state`, `busy_type`, `last_seen`, `service_since`, `title`, `pwd`, `tty`
- On busy→idle transition: emits `task-completed` with duration
- Triggers state resolution and `status-changed` event emission

**Zombie guard:** If `pid` isn't a running process (checked via libproc), responds with `410 Gone` and does not create/update a session. This prevents orphaned shell-hook heartbeats from re-registering dead sessions after the parent shell was force-killed.

---

### GET `/heartbeat`

Keep a shell session alive. Sent periodically (every 20s) by shell hooks.

**Query Parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `pid` | Yes | Shell process ID |
| `title` | No | Directory basename |
| `pwd` | No | Full working directory (URL-encoded) |
| `tty` | No | Controlling TTY device (URL-encoded) |

**Behavior:**
- Creates session if PID doesn't exist (subject to the same zombie guard as `/status`)
- Refreshes `last_seen` timestamp (only for non-busy sessions)
- Updates `title`, `pwd`, `tty` when provided
- Busy sessions intentionally skip the last-seen refresh — they should timeout if the shell dies mid-command
- Returns `410 Gone` if `pid` no longer exists in the OS process table

---

## Peer Visit Endpoints

### POST `/visit`

Incoming dog visit from a peer. Sent by the visiting machine's backend.

**Request Body (JSON):**

```json
{
  "pet": "rottweiler",
  "nickname": "Alice",
  "duration_secs": 15
}
```

**Behavior:**
- Adds visitor to `AppState.visitors`
- Emits `visitor-arrived` event to frontend

---

### POST `/visit-end`

Signal that a visiting dog is leaving.

**Request Body (JSON):**

```json
{
  "nickname": "Alice"
}
```

**Behavior:**
- Removes visitor by nickname from `AppState.visitors`
- Emits `visitor-left` event to frontend

---

## MCP Endpoints

These endpoints are called by the MCP server sidecar (`~/.ani-mime/mcp/server.mjs`) on behalf of Claude Code.

### POST `/mcp/say`

Make the pet say something via a speech bubble.

**Request Body (JSON):**

```json
{
  "message": "Great job fixing that bug!",
  "duration_secs": 7
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `message` | Yes | — | Text to show in speech bubble |
| `duration_secs` | No | 7 | How long to show the bubble |

**Behavior:**
- Emits `mcp-say` event to frontend with `{ message, duration_ms }`
- Frontend shows speech bubble (respects bubble enabled setting)

---

### POST `/mcp/react`

Trigger a temporary reaction animation on the pet.

**Request Body (JSON):**

```json
{
  "reaction": "celebrate",
  "duration_secs": 3
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `reaction` | Yes | — | One of: `celebrate`, `nervous`, `confused`, `excited`, `sleep` |
| `duration_secs` | No | 3 | How long to play the reaction |

**Reaction → Animation Mapping:**

| Reaction | Mapped Status | Animation |
|----------|---------------|-----------|
| `celebrate` | `service` | Barking/jumping |
| `excited` | `service` | Barking/happy |
| `nervous` | `busy` | Sniffing/alert |
| `confused` | `searching` | Looking around |
| `sleep` | `disconnected` | Sleeping |

**Behavior:**
- Emits `mcp-react` event to frontend with `{ status, duration_ms }`
- Frontend temporarily overrides displayed animation, reverts after duration
- Priority: scenario override (dev tools) > reaction (MCP) > real status

---

### GET `/mcp/pet-status`

Get the pet's current status as JSON.

**Response (JSON):**

```json
{
  "pet_type": "rottweiler",
  "nickname": "Buddy",
  "current_status": "idle",
  "sleeping": false,
  "sessions_active": 2,
  "peers_nearby": 3,
  "visitors": [
    { "nickname": "Alice", "pet": "dalmatian" }
  ],
  "is_visiting": false,
  "uptime_secs": 3600
}
```

---

## Debug Endpoints

### GET `/debug`

Dump current session state. For development only.

**Response (text):**

```
current_ui: idle
sessions: 2
  pid=12345 ui=idle type= last_seen=3s_ago
  pid=0 ui=idle type= last_seen=5s_ago
```

---

## Integration Points

| Client | Endpoint | Frequency |
|--------|----------|-----------|
| Shell preexec hook | `/status?state=busy` | Per command |
| Shell precmd hook | `/status?state=idle` | Per command |
| Shell heartbeat loop | `/heartbeat` | Every 20s |
| Claude Code PreToolUse hook | `/status?pid=0&state=busy` | Per tool use |
| Claude Code Stop hook | `/status?pid=0&state=idle` | Per stop |
| Peer visit (outgoing) | Peer's `/visit` | Per visit initiation |
| Peer visit end (outgoing) | Peer's `/visit-end` | Per visit completion |
| MCP `pet_say` tool | `/mcp/say` | Per Claude Code tool call |
| MCP `pet_react` tool | `/mcp/react` | Per Claude Code tool call |
| MCP `pet_status` tool | `/mcp/pet-status` | Per Claude Code tool call |
