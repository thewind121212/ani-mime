import { useState, useRef, useEffect, useCallback } from "react";
import { useChatHistory } from "../hooks/useChatHistory";
import { useChat } from "../hooks/useChat";
import type { ChatMessage } from "../hooks/useChatHistory";
import "../styles/chat.css";

interface ChatProps {
  /** Optional close handler — called when the user hits Escape inside
   *  the chat. When unset, Escape is a no-op (used for the standalone
   *  chat WebviewWindow rendering, where the host owns dismissal). */
  onClose?: () => void;
}

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

/**
 * Strip model-internal annotations that occasionally leak into responses
 * and render as raw text in the bubble. Two known offenders:
 *   - `citeturn0searchN` / `citeturn0newsN` / `citeturn0refN` — citation
 *     anchors emitted by some web-search tooling. Stripped entirely.
 *   - `entity["type","name","desc"]` — entity tags. Replaced with the
 *     second positional arg (the display name) so the prose still reads.
 */
function sanitizeAssistantContent(content: string): string {
  let out = content;

  // entity["type","Display Name", ...]  ->  "Display Name"
  out = out.replace(
    /entity\[\s*"[^"]*"\s*,\s*"([^"]*)"(?:\s*,\s*"[^"]*")*\s*\]/g,
    "$1",
  );

  // Citation tokens. cite-prefix + variant (turn/news/ref/etc.) + digits +
  // optional alpha-suffix. Match conservatively so prose words aren't eaten.
  out = out.replace(/\bcite(?:turn|news|ref|cmt)[A-Za-z0-9]+\b/g, "");

  // Collapse whitespace runs left behind by the above (but keep newlines).
  out = out.replace(/[ \t]{2,}/g, " ");

  return out;
}

/** Render message content with basic code block support. */
function renderContent(content: string): React.ReactNode[] {
  content = sanitizeAssistantContent(content);
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderInlineCode(content.slice(lastIndex, match.index), parts.length));
    }
    parts.push(
      <pre key={`code-${parts.length}`}>
        <code>{match[2]}</code>
      </pre>,
    );
    lastIndex = match.index + match[0].length;
  }

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

export function Chat({ onClose }: ChatProps = {}) {
  const {
    sessions,
    activeSession,
    activeId,
    createSession,
    switchSession,
    updateSession,
    removeSession,
  } = useChatHistory();

  // Fix B2: useChat no longer takes activeSession — send accepts session explicitly
  const { send, cancel, loading, error, streamingContent } = useChat(updateSession);

  const [input, setInput] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const draftRef = useRef("");
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeSession?.messages.length, streamingContent]);

  useEffect(() => {
    inputRef.current?.focus();
    setHistoryIndex(-1);
    draftRef.current = "";
  }, [activeId]);

  const userMessages = (activeSession?.messages ?? []).filter((m) => m.role === "user");

  const applyRecall = useCallback((value: string) => {
    setInput(value);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
      const len = el.value.length;
      el.setSelectionRange(len, len);
      el.focus();
    });
  }, []);

  // Escape closes the chat. When mounted inline (StatusPill), `onClose`
  // is provided and dismisses the panel via state. The standalone chat
  // WebviewWindow renders Chat without `onClose`, so its Escape is a
  // no-op here — the host installs its own listener if needed.
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fix B2: resolve session before calling send, pass explicitly
  const handleSend = useCallback(() => {
    if (!input.trim() || loading) return;
    const session = activeSession ?? createSession();
    send(session, input.trim());
    setInput("");
    setHistoryIndex(-1);
    draftRef.current = "";
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [input, loading, activeSession, createSession, send]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    if (e.key === "ArrowUp") {
      const el = e.currentTarget;
      const before = el.value.slice(0, el.selectionStart);
      if (before.includes("\n")) return;
      if (userMessages.length === 0) return;
      if (historyIndex >= userMessages.length - 1) return;
      e.preventDefault();
      if (historyIndex === -1) draftRef.current = input;
      const next = historyIndex + 1;
      setHistoryIndex(next);
      applyRecall(userMessages[userMessages.length - 1 - next].content);
      return;
    }

    if (e.key === "ArrowDown") {
      if (historyIndex === -1) return;
      const el = e.currentTarget;
      const after = el.value.slice(el.selectionEnd);
      if (after.includes("\n")) return;
      e.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      if (next === -1) {
        applyRecall(draftRef.current);
      } else {
        applyRecall(userMessages[userMessages.length - 1 - next].content);
      }
      return;
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (historyIndex !== -1) {
      setHistoryIndex(-1);
      draftRef.current = e.target.value;
    }
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
    <div className="chat-shell">
    <div className="chat" data-testid="chat-window">
      {/* Header */}
      <div className="chat-header" data-testid="chat-header">
        <span style={{ fontSize: 16 }}>🐕</span>
        <span className="chat-header-title" data-testid="chat-session-title">
          {activeSession?.title ?? "Coding Helper"}
        </span>
        <button
          type="button"
          className="chat-header-btn"
          data-testid="chat-dropdown-toggle"
          onClick={() => setDropdownOpen((o) => !o)}
          aria-expanded={dropdownOpen}
          aria-label="Toggle session list"
          title="History"
        >
          ☰
        </button>
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

      {/* Session dropdown — must live inside .chat-header so its
          position:absolute resolves against the header (the nearest
          positioned ancestor). Otherwise top:100% snaps to the viewport
          and the dropdown renders below the window, invisible. */}
      {dropdownOpen && (
        <div className="chat-session-dropdown" data-testid="chat-session-dropdown" role="menu">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
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
            </button>
          ))}
          {sessions.length === 0 && (
            <div className="chat-session-item" style={{ color: "#667788", cursor: "default" }}>
              No sessions yet
            </div>
          )}
        </div>
      )}
      </div>

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
    </div>
  );
}
