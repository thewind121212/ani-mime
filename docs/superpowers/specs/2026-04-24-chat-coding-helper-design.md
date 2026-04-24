# Chat Coding Helper — Design Spec

## Overview

Add a chat window to ani-mime that helps with coding syntax and leetcode patterns. Uses ChatGPT (GPT-4o) via chat2api proxy with Codex auth. Short replies only.

## Architecture

```
User types question → React Chat component
  → fetch("http://127.0.0.1:5005/v1/chat/completions")
  → auth token from ~/.ani-mime/auth.json (Tauri FS plugin)
  → GPT-4o streamed response
  → render with code blocks
  → persist session to ~/.ani-mime/chat-history/<uuid>.json
```

## Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Backend approach | Frontend direct fetch | Simplest — no Rust HTTP layer needed |
| Chat2API URL | Hardcoded `http://127.0.0.1:5005` | User runs Docker locally only |
| Auth location | `~/.ani-mime/auth.json` | Clean separation from repo-bot |
| History storage | JSON files per session | Easy to browse, UUID-based |
| Window style | Decorated (like Settings) | Good UX, resizable |
| Layout | Clean chat + dropdown session switcher | More space for code, cleaner |
| Open trigger | Button on StatusPill | Accessible, discoverable |

## Window Configuration

- **Label**: `chat`
- **Size**: 420×520 (min 320×400)
- **Decorated**: yes, resizable
- **Visible**: false (opened on demand)
- **Entry**: `chat.html` → `src/chat-main.tsx` → `Chat.tsx`

## UI Components

### Header
- Dog emoji + session title (truncated) + dropdown arrow
- Dropdown: session list sorted by last-used, title + relative date
- "+" button: create new chat session

### Message List
- Scrollable, auto-scroll on new message
- User messages: right-aligned, accent color background
- Bot messages: left-aligned, darker background
- Code blocks: monospace, dark background, copy-friendly
- Streaming: tokens append in real-time

### Input Bar
- Fixed at bottom
- Placeholder: "Ask about syntax..."
- Enter to send, Shift+Enter for newline
- Disabled while waiting for response

## Session Storage

```json
// ~/.ani-mime/chat-history/<uuid>.json
{
  "id": "a1b2c3d4-...",
  "title": "Go array syntax",
  "created": 1706000000,
  "updated": 1706000100,
  "messages": [
    { "role": "user", "content": "how declare array in go?" },
    { "role": "assistant", "content": "`var arr [5]int`\nFixed size. For dynamic use slice:\n`s := []int{1, 2, 3}`" }
  ]
}
```

- **Title**: auto-generated from first ~30 chars of first user message
- **Session list**: loaded by scanning `~/.ani-mime/chat-history/` directory on mount
- **Save**: after each assistant response completes

## Auth Format

```json
// ~/.ani-mime/auth.json
{
  "auth_mode": "chatgpt",
  "tokens": {
    "access_token": "eyJ..."
  }
}
```

- Read fresh on each API request (token may refresh externally)
- If file missing: show inline error "Place auth.json in ~/.ani-mime/"
- If request fails (401/403): show inline error "Token expired — update auth.json"

## System Prompt

```
You are a concise coding syntax helper. Rules:
- Reply SHORT: max 3-4 lines
- Show code first, explain briefly after
- No markdown headers, no bullet lists
- Use inline code for single expressions, code blocks for multi-line
- Languages: any (Go, Java, Python, Rust, JS, etc.)
- Focus: syntax, stdlib patterns, common idioms, leetcode patterns
- If asked non-coding question, redirect to coding
```

## API Call

```typescript
const response = await fetch("http://127.0.0.1:5005/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${accessToken}`,
  },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...sessionMessages,
    ],
    stream: true,
  }),
});
```

Stream parsed via `ReadableStream` + SSE text/event-stream protocol.

## New Files

| File | Purpose |
|------|---------|
| `chat.html` | Vite HTML entry point |
| `src/chat-main.tsx` | React mount for chat window |
| `src/components/Chat.tsx` | Main chat UI component |
| `src/hooks/useChat.ts` | Chat state, API calls, streaming logic |
| `src/hooks/useChatHistory.ts` | Session CRUD, JSON file persistence |
| `src/styles/chat.css` | Chat window styles (dark theme) |

## Modified Files

| File | Change |
|------|--------|
| `src-tauri/tauri.conf.json` | Add `chat` window definition |
| `vite.config.ts` | Add `chat.html` to Vite input entries |
| `src/components/StatusPill.tsx` | Add chat button icon |
| `src/styles/status-pill.css` | Style for chat button |
| `src-tauri/src/lib.rs` | Add "Chat" tray menu item |
| `src-tauri/capabilities/default.json` | FS read permission for `~/.ani-mime/` |

## Error States

- **chat2api not running**: fetch fails → show "Cannot connect to chat2api at 127.0.0.1:5005"
- **auth.json missing**: FS read fails → show "Place auth.json in ~/.ani-mime/"
- **token expired**: 401 response → show "Token expired — update auth.json"
- **network error during stream**: show partial response + error indicator

## Out of Scope

- Managing chat2api Docker container
- Token refresh flow (user manages auth.json manually)
- Markdown rendering beyond code blocks (keeping it simple)
- Search/filter sessions
- Export/share conversations
