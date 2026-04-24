# Chat Coding Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat window to ani-mime that calls ChatGPT via chat2api for quick coding syntax help with short replies.

**Architecture:** New Tauri window (`chat`) with React frontend. Frontend reads auth token from `~/.ani-mime/auth.json` via Tauri FS plugin, calls `http://127.0.0.1:5005/v1/chat/completions` directly with streaming. Chat sessions persisted as JSON files in `~/.ani-mime/chat-history/`.

**Tech Stack:** React 19, Tauri 2 FS plugin, fetch + ReadableStream SSE, tauri-plugin-store for settings

---

### Task 1: Tauri Window Config + HTML Entry + React Mount

**Files:**
- Create: `chat.html`
- Create: `src/chat-main.tsx`
- Modify: `vite.config.ts:13-18` (add chat entry)
- Modify: `src-tauri/tauri.conf.json:14-68` (add chat window)
- Modify: `src-tauri/capabilities/default.json:4` (add chat to windows list)

- [ ] **Step 1: Create `chat.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chat</title>
    <style>html, body, #root { margin: 0; padding: 0; overflow: hidden; height: 100%; }</style>
  </head>

  <body>
    <div id="root"></div>
    <script type="module" src="/src/chat-main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/chat-main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Chat } from "./components/Chat";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Chat />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Add chat entry to `vite.config.ts`**

In the `rollupOptions.input` object, add the chat entry:

```ts
input: {
  main: resolve(__dirname, "index.html"),
  settings: resolve(__dirname, "settings.html"),
  superpower: resolve(__dirname, "superpower.html"),
  "peer-list": resolve(__dirname, "peer-list.html"),
  chat: resolve(__dirname, "chat.html"),
},
```

- [ ] **Step 4: Add chat window to `src-tauri/tauri.conf.json`**

Add after the `peer-list` window entry in the `app.windows` array:

```json
{
  "label": "chat",
  "title": "Coding Helper",
  "url": "chat.html",
  "width": 420,
  "height": 520,
  "minWidth": 320,
  "minHeight": 400,
  "resizable": true,
  "visible": false,
  "decorations": true,
  "transparent": false,
  "center": true
}
```

- [ ] **Step 5: Add chat to capabilities**

In `src-tauri/capabilities/default.json`, update the `windows` array:

```json
"windows": ["main", "settings", "superpower", "peer-list", "chat"],
```

- [ ] **Step 6: Commit**

```bash
git add chat.html src/chat-main.tsx vite.config.ts src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat(chat): add Tauri window config, HTML entry, and React mount"
```

---

### Task 2: Chat History Hook (`useChatHistory`)

**Files:**
- Create: `src/hooks/useChatHistory.ts`

This hook manages session CRUD — create, load, list, save, delete. Uses Tauri FS plugin to read/write JSON files under `~/.ani-mime/chat-history/`.

- [ ] **Step 1: Create `src/hooks/useChatHistory.ts`**

```ts
import { useState, useEffect, useCallback } from "react";
import {
  readTextFile,
  writeTextFile,
  readDir,
  mkdir,
  remove,
  exists,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: ChatMessage[];
}

const CHAT_DIR = ".ani-mime/chat-history";

function homePath(filename: string): string {
  return `${CHAT_DIR}/${filename}`;
}

function generateId(): string {
  return crypto.randomUUID();
}

function generateTitle(firstMessage: string): string {
  return firstMessage.slice(0, 30).trim() || "New Chat";
}

async function ensureDir(): Promise<void> {
  const dirExists = await exists(CHAT_DIR, { baseDir: BaseDirectory.Home });
  if (!dirExists) {
    await mkdir(CHAT_DIR, { baseDir: BaseDirectory.Home, recursive: true });
  }
}

async function loadSession(id: string): Promise<ChatSession | null> {
  try {
    const raw = await readTextFile(homePath(`${id}.json`), {
      baseDir: BaseDirectory.Home,
    });
    return JSON.parse(raw) as ChatSession;
  } catch {
    return null;
  }
}

async function saveSession(session: ChatSession): Promise<void> {
  await ensureDir();
  const data = JSON.stringify(session, null, 2);
  await writeTextFile(homePath(`${session.id}.json`), data, {
    baseDir: BaseDirectory.Home,
  });
}

async function deleteSessionFile(id: string): Promise<void> {
  try {
    await remove(homePath(`${id}.json`), { baseDir: BaseDirectory.Home });
  } catch {
    // file may not exist
  }
}

async function listSessions(): Promise<ChatSession[]> {
  await ensureDir();
  const entries = await readDir(CHAT_DIR, { baseDir: BaseDirectory.Home });
  const sessions: ChatSession[] = [];
  for (const entry of entries) {
    if (!entry.name?.endsWith(".json")) continue;
    const id = entry.name.replace(".json", "");
    const session = await loadSession(id);
    if (session) sessions.push(session);
  }
  sessions.sort((a, b) => b.updated - a.updated);
  return sessions;
}

export function useChatHistory() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);

  // Load session list on mount
  useEffect(() => {
    listSessions().then((list) => {
      setSessions(list);
      if (list.length > 0) {
        setActiveId(list[0].id);
        setActiveSession(list[0]);
      }
    });
  }, []);

  const createSession = useCallback((): ChatSession => {
    const session: ChatSession = {
      id: generateId(),
      title: "New Chat",
      created: Date.now(),
      updated: Date.now(),
      messages: [],
    };
    setActiveSession(session);
    setActiveId(session.id);
    setSessions((prev) => [session, ...prev]);
    return session;
  }, []);

  const switchSession = useCallback(
    async (id: string) => {
      const session = await loadSession(id);
      if (session) {
        setActiveSession(session);
        setActiveId(id);
      }
    },
    [],
  );

  const updateSession = useCallback(
    async (session: ChatSession) => {
      // Auto-title from first user message if still default
      if (session.title === "New Chat" && session.messages.length > 0) {
        const firstUser = session.messages.find((m) => m.role === "user");
        if (firstUser) session.title = generateTitle(firstUser.content);
      }
      session.updated = Date.now();
      await saveSession(session);
      setActiveSession({ ...session });
      setSessions((prev) =>
        [session, ...prev.filter((s) => s.id !== session.id)],
      );
    },
    [],
  );

  const removeSession = useCallback(
    async (id: string) => {
      await deleteSessionFile(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeId === id) {
        setActiveSession(null);
        setActiveId(null);
      }
    },
    [activeId],
  );

  return {
    sessions,
    activeSession,
    activeId,
    createSession,
    switchSession,
    updateSession,
    removeSession,
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors related to `useChatHistory.ts`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useChatHistory.ts
git commit -m "feat(chat): add useChatHistory hook for session CRUD and persistence"
```

---

### Task 3: Chat API Hook (`useChat`)

**Files:**
- Create: `src/hooks/useChat.ts`

Handles sending messages to chat2api, streaming response, and managing loading state.

- [ ] **Step 1: Create `src/hooks/useChat.ts`**

```ts
import { useState, useRef, useCallback } from "react";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import type { ChatMessage, ChatSession } from "./useChatHistory";

const CHAT2API_URL = "http://127.0.0.1:5005/v1/chat/completions";
const AUTH_PATH = ".ani-mime/auth.json";

const SYSTEM_PROMPT = `You are a concise coding syntax helper. Rules:
- Reply SHORT: max 3-4 lines
- Show code first, explain briefly after
- No markdown headers, no bullet lists
- Use inline code for single expressions, code blocks for multi-line
- Languages: any (Go, Java, Python, Rust, JS, etc.)
- Focus: syntax, stdlib patterns, common idioms, leetcode patterns
- If asked non-coding question, redirect to coding`;

interface AuthData {
  tokens: {
    access_token: string;
  };
}

async function loadToken(): Promise<string> {
  const raw = await readTextFile(AUTH_PATH, { baseDir: BaseDirectory.Home });
  const auth: AuthData = JSON.parse(raw);
  return auth.tokens.access_token;
}

export function useChat(
  activeSession: ChatSession | null,
  onUpdate: (session: ChatSession) => Promise<void>,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (userMessage: string) => {
      if (!activeSession || !userMessage.trim()) return;
      setError(null);

      const userMsg: ChatMessage = { role: "user", content: userMessage.trim() };
      const updatedMessages = [...activeSession.messages, userMsg];
      const sessionWithUser = { ...activeSession, messages: updatedMessages };
      await onUpdate(sessionWithUser);

      setLoading(true);
      setStreamingContent("");

      let token: string;
      try {
        token = await loadToken();
      } catch {
        setError("Auth missing — place auth.json in ~/.ani-mime/");
        setLoading(false);
        return;
      }

      const abortController = new AbortController();
      abortRef.current = abortController;

      try {
        const apiMessages = [
          { role: "system" as const, content: SYSTEM_PROMPT },
          ...updatedMessages.map((m) => ({ role: m.role, content: m.content })),
        ];

        const response = await fetch(CHAT2API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: apiMessages,
            stream: true,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const status = response.status;
          if (status === 401 || status === 403) {
            setError("Token expired — update auth.json");
          } else {
            setError(`API error: ${status}`);
          }
          setLoading(false);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          setError("No response stream");
          setLoading(false);
          return;
        }

        const decoder = new TextDecoder();
        let assistantContent = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") break;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                assistantContent += delta;
                setStreamingContent(assistantContent);
              }
            } catch {
              // skip malformed SSE chunks
            }
          }
        }

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: assistantContent,
        };
        const finalSession = {
          ...activeSession,
          messages: [...updatedMessages, assistantMsg],
        };
        await onUpdate(finalSession);
        setStreamingContent("");
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // user cancelled
        } else if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("network"))) {
          setError("Cannot connect to chat2api at 127.0.0.1:5005");
        } else {
          setError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [activeSession, onUpdate],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, cancel, loading, error, streamingContent };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors related to `useChat.ts`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useChat.ts
git commit -m "feat(chat): add useChat hook for chat2api streaming and auth"
```

---

### Task 4: Chat CSS

**Files:**
- Create: `src/styles/chat.css`

Dark-themed chat window styles. Uses existing CSS custom properties from `theme.css` where applicable, plus chat-specific colors.

- [ ] **Step 1: Create `src/styles/chat.css`**

```css
.chat {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1a1a2e;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
}

/* --- Header --- */
.chat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid #0f3460;
  flex-shrink: 0;
  position: relative;
}

.chat-header-title {
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.chat-header-caret {
  font-size: 10px;
  color: #8899aa;
  cursor: pointer;
  padding: 2px 4px;
}

.chat-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #8899aa;
  font-size: 18px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}

.chat-header-btn:hover {
  background: #0f3460;
  color: #fff;
}

/* --- Session dropdown --- */
.chat-session-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 260px;
  overflow-y: auto;
  background: #16213e;
  border: 1px solid #0f3460;
  border-top: none;
  z-index: 10;
  scrollbar-width: thin;
  scrollbar-color: #0f3460 transparent;
}

.chat-session-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.chat-session-item:hover {
  background: #0f3460;
}

.chat-session-item.active {
  background: #0f3460;
  font-weight: 600;
}

.chat-session-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-session-date {
  font-size: 10px;
  color: #667788;
  flex-shrink: 0;
}

.chat-session-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #667788;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s, color 0.12s;
}

.chat-session-item:hover .chat-session-delete {
  opacity: 1;
}

.chat-session-delete:hover {
  color: #ff3b30;
  background: rgba(255, 59, 48, 0.15);
}

/* --- Messages --- */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scrollbar-width: thin;
  scrollbar-color: #0f3460 transparent;
}

.chat-messages::-webkit-scrollbar {
  width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
  background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb {
  background: #0f3460;
  border-radius: 3px;
}

.chat-msg {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-msg.user {
  align-self: flex-end;
  background: #0f3460;
  color: #c8d6e5;
}

.chat-msg.assistant {
  align-self: flex-start;
  background: #16213e;
  color: #e0e0e0;
}

.chat-msg.error {
  align-self: center;
  background: rgba(255, 59, 48, 0.15);
  color: #ff6b6b;
  font-size: 12px;
  text-align: center;
  max-width: 100%;
}

.chat-msg.streaming {
  border: 1px solid #0f3460;
}

/* Code blocks inside messages */
.chat-msg code {
  background: #0d1117;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: "SF Mono", "Menlo", "Monaco", monospace;
  font-size: 12px;
  color: #79c0ff;
}

.chat-msg pre {
  background: #0d1117;
  padding: 8px 10px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 4px 0;
}

.chat-msg pre code {
  background: none;
  padding: 0;
  font-size: 12px;
  color: #c9d1d9;
}

/* Empty state */
.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #667788;
  font-size: 13px;
  padding: 20px;
  text-align: center;
}

/* --- Input --- */
.chat-input-wrap {
  padding: 8px 12px;
  border-top: 1px solid #0f3460;
  flex-shrink: 0;
}

.chat-input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: #16213e;
  border-radius: 10px;
  padding: 4px 4px 4px 12px;
}

.chat-input {
  flex: 1;
  border: none;
  background: transparent;
  color: #e0e0e0;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  resize: none;
  outline: none;
  padding: 6px 0;
  max-height: 120px;
  min-height: 20px;
}

.chat-input::placeholder {
  color: #667788;
}

.chat-send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: #e94560;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, opacity 0.12s;
}

.chat-send-btn:hover {
  background: #c73e54;
}

.chat-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Loading dots */
.chat-loading {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  align-self: flex-start;
}

.chat-loading-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #667788;
  animation: chat-bounce 1.2s ease-in-out infinite;
}

.chat-loading-dot:nth-child(2) { animation-delay: 0.15s; }
.chat-loading-dot:nth-child(3) { animation-delay: 0.3s; }

@keyframes chat-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/chat.css
git commit -m "feat(chat): add chat window CSS styles"
```

---

### Task 5: Chat Component

**Files:**
- Create: `src/components/Chat.tsx`

Main chat UI component — header with session dropdown, message list with code rendering, input bar.

- [ ] **Step 1: Create `src/components/Chat.tsx`**

```tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { useChatHistory } from "../hooks/useChatHistory";
import { useChat } from "../hooks/useChat";
import type { ChatMessage } from "../hooks/useChatHistory";
import "../styles/chat.css";

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

/** Render message content with basic code block support. */
function renderContent(content: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      parts.push(renderInlineCode(content.slice(lastIndex, match.index), parts.length));
    }
    // Code block
    parts.push(
      <pre key={`code-${parts.length}`}>
        <code>{match[2]}</code>
      </pre>,
    );
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < content.length) {
    parts.push(renderInlineCode(content.slice(lastIndex), parts.length));
  }

  return parts;
}

function renderInlineCode(text: string, keyBase: number): React.ReactNode {
  const inlineRegex = /`([^`]+)`/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;

  while ((m = inlineRegex.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push(text.slice(lastIdx, m.index));
    }
    parts.push(<code key={`ic-${keyBase}-${parts.length}`}>{m[1]}</code>);
    lastIdx = m.index + m[0].length;
  }

  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }

  return <span key={`txt-${keyBase}`}>{parts}</span>;
}

export function Chat() {
  const {
    sessions,
    activeSession,
    activeId,
    createSession,
    switchSession,
    updateSession,
    removeSession,
  } = useChatHistory();

  const { send, cancel, loading, error, streamingContent } = useChat(
    activeSession,
    updateSession,
  );

  const [input, setInput] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages or streaming
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeSession?.messages.length, streamingContent]);

  // Focus input on session switch
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeId]);

  const handleSend = useCallback(() => {
    if (!input.trim() || loading) return;
    // Create session on first message if none active
    if (!activeSession) {
      const session = createSession();
      // Send will pick up the new session on next render
      send(input.trim());
    } else {
      send(input.trim());
    }
    setInput("");
    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [input, loading, activeSession, createSession, send]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Auto-resize textarea
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleNewChat = () => {
    createSession();
    setDropdownOpen(false);
  };

  const messages: ChatMessage[] = activeSession?.messages ?? [];

  return (
    <div className="chat" data-testid="chat-window">
      {/* Header */}
      <div className="chat-header" data-testid="chat-header">
        <span style={{ fontSize: 16 }}>🐕</span>
        <span
          className="chat-header-title"
          data-testid="chat-session-title"
        >
          {activeSession?.title ?? "Coding Helper"}
        </span>
        <span
          className="chat-header-caret"
          data-testid="chat-dropdown-toggle"
          onClick={() => setDropdownOpen((o) => !o)}
          role="button"
          aria-expanded={dropdownOpen}
          aria-label="Toggle session list"
        >
          {dropdownOpen ? "▲" : "▼"}
        </span>
        <button
          type="button"
          className="chat-header-btn"
          data-testid="chat-new-btn"
          onClick={handleNewChat}
          aria-label="New chat"
          title="New chat"
        >
          +
        </button>
      </div>

      {/* Session dropdown */}
      {dropdownOpen && (
        <div className="chat-session-dropdown" data-testid="chat-session-dropdown" role="menu">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`chat-session-item ${s.id === activeId ? "active" : ""}`}
              data-testid={`chat-session-${s.id}`}
              role="menuitem"
              onClick={() => {
                switchSession(s.id);
                setDropdownOpen(false);
              }}
            >
              <span className="chat-session-title">{s.title}</span>
              <span className="chat-session-date">{formatDate(s.updated)}</span>
              <button
                type="button"
                className="chat-session-delete"
                data-testid={`chat-session-delete-${s.id}`}
                aria-label={`Delete ${s.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeSession(s.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="chat-session-item" style={{ color: "#667788", cursor: "default" }}>
              No sessions yet
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      {messages.length === 0 && !loading ? (
        <div className="chat-empty" data-testid="chat-empty">
          Ask about syntax, patterns, or idioms in any language
        </div>
      ) : (
        <div className="chat-messages" ref={messagesRef} data-testid="chat-messages">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`chat-msg ${m.role}`}
              data-testid={`chat-msg-${i}`}
            >
              {m.role === "assistant" ? renderContent(m.content) : m.content}
            </div>
          ))}
          {loading && streamingContent && (
            <div className="chat-msg assistant streaming" data-testid="chat-msg-streaming">
              {renderContent(streamingContent)}
            </div>
          )}
          {loading && !streamingContent && (
            <div className="chat-loading" data-testid="chat-loading">
              <div className="chat-loading-dot" />
              <div className="chat-loading-dot" />
              <div className="chat-loading-dot" />
            </div>
          )}
          {error && (
            <div className="chat-msg error" data-testid="chat-error">{error}</div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="chat-input-wrap" data-testid="chat-input-wrap">
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className="chat-input"
            data-testid="chat-input"
            placeholder="Ask about syntax..."
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={loading}
          />
          {loading ? (
            <button
              type="button"
              className="chat-send-btn"
              data-testid="chat-cancel-btn"
              onClick={cancel}
              aria-label="Cancel"
              title="Cancel"
              style={{ background: "#636366" }}
            >
              ■
            </button>
          ) : (
            <button
              type="button"
              className="chat-send-btn"
              data-testid="chat-send-btn"
              onClick={handleSend}
              disabled={!input.trim()}
              aria-label="Send"
              title="Send"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chat): add Chat component with message list, streaming, and session dropdown"
```

---

### Task 6: StatusPill Chat Button

**Files:**
- Modify: `src/components/StatusPill.tsx:483-541` (add chat button in pill-actions)
- Modify: `src/styles/status-pill.css` (add chat button accent style)

- [ ] **Step 1: Add chat button to StatusPill**

In `src/components/StatusPill.tsx`, add the chat button inside the `pill-actions` div, after the session list button and before the LAN button. Add the import at the top:

Add at top of file (with existing imports):
```tsx
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
```

(This import already exists via existing usage.)

Inside the `<div className="pill-actions">` section, add the chat button between the session list button and the LAN button (after line 509, before the `{lanListEnabled && (` block):

```tsx
          <button
            type="button"
            data-testid="pill-action-chat"
            className="pill-action-btn pill-action-chat"
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              playClickTap();
              const win = await WebviewWindow.getByLabel("chat");
              if (win) {
                const visible = await win.isVisible();
                if (visible) {
                  await win.setFocus();
                } else {
                  await win.show();
                  await win.setFocus();
                }
              }
            }}
            aria-label="Coding helper chat"
            title="Chat"
          >
            <svg
              className="pill-action-icon"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
            </svg>
          </button>
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify the pill renders with the chat icon**

Run: `bun run tauri dev`
Look at the dog — the pill should show a chat bubble icon between the session list and LAN icons.

- [ ] **Step 4: Commit**

```bash
git add src/components/StatusPill.tsx
git commit -m "feat(chat): add chat button to StatusPill"
```

---

### Task 7: Tray Menu + Window Hide-on-Close

**Files:**
- Modify: `src-tauri/src/lib.rs:484-493` (add tray menu item)
- Modify: `src-tauri/src/lib.rs:566-578` (add chat to hide-on-close list)

- [ ] **Step 1: Add "Chat" tray menu item**

In `lib.rs`, after the `tray_settings` line (line 485), add:

```rust
let tray_chat = MenuItemBuilder::with_id("tray-chat", "Coding Helper").build(app)?;
```

Add it to the tray menu builder after `tray_settings`:

```rust
let tray_menu = MenuBuilder::new(app)
    .item(&tray_show)
    .item(&tray_settings)
    .item(&tray_chat)
    .separator()
    .item(&tray_quit)
    .build()?;
```

Add the handler inside the `on_menu_event` match block (after the `"tray-settings"` arm):

```rust
"tray-chat" => {
    crate::app_log!("[app] tray: chat clicked");
    if let Some(win) = app.get_webview_window("chat") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}
```

- [ ] **Step 2: Add chat to hide-on-close list**

Change the for loop at line 566 from:

```rust
for label in &["settings", "superpower"] {
```

to:

```rust
for label in &["settings", "superpower", "chat"] {
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd src-tauri && cargo check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(chat): add tray menu item and hide-on-close for chat window"
```

---

### Task 8: Integration Test — Full Flow

**Files:** No new files — manual testing

- [ ] **Step 1: Verify full dev build works**

Run: `bun run tauri dev`
Expected: App launches without errors

- [ ] **Step 2: Test chat window opens from pill**

Click the chat bubble icon on the status pill. Expected: Chat window opens, centered, decorated, 420×520.

- [ ] **Step 3: Test chat window opens from tray**

Right-click tray icon → "Coding Helper". Expected: Chat window opens/focuses.

- [ ] **Step 4: Test sending a message (requires chat2api running)**

Type "how declare map in go?" and press Enter. Expected:
- User message appears right-aligned
- Loading dots show
- Streamed response appears with code formatting
- Session auto-titled "how declare map in go?"

- [ ] **Step 5: Test session persistence**

Close and reopen the chat window. Expected: Previous session appears in dropdown.

- [ ] **Step 6: Test new session**

Click "+" button. Expected: New empty chat, old session in dropdown.

- [ ] **Step 7: Test error states**

With chat2api stopped, send a message. Expected: "Cannot connect to chat2api at 127.0.0.1:5005" error.

- [ ] **Step 8: Commit final state**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix(chat): integration test fixes"
```
