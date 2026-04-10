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

**Examples:**

```bash
# Command started (regular task)
curl "http://127.0.0.1:1234/status?pid=12345&state=busy&type=task"

# Dev server started
curl "http://127.0.0.1:1234/status?pid=12345&state=busy&type=service"

# Command finished
curl "http://127.0.0.1:1234/status?pid=12345&state=idle"
```

**Behavior:**
- Creates session if PID doesn't exist
- Updates `ui_state`, `busy_type`, `last_seen`, `service_since`
- On busy→idle transition: emits `task-completed` with duration
- Triggers state resolution and `status-changed` event emission

---

### GET `/heartbeat`

Keep a shell session alive. Sent periodically (every 20s) by shell hooks.

**Query Parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `pid` | Yes | Shell process ID |

**Behavior:**
- Creates session if PID doesn't exist
- Refreshes `last_seen` timestamp (only for non-busy sessions)
- Busy sessions intentionally skip refresh — they should timeout if the shell dies mid-command

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
