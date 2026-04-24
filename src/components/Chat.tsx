import { useState, useRef, useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
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

  // Fix B2: useChat no longer takes activeSession — send accepts session explicitly
  const { send, cancel, loading, error, streamingContent } = useChat(updateSession);

  const [input, setInput] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeSession?.messages.length, streamingContent]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [activeId]);

  // Escape key hides window (like peer-list)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void getCurrentWindow().hide();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fix B2: resolve session before calling send, pass explicitly
  const handleSend = useCallback(() => {
    if (!input.trim() || loading) return;
    const session = activeSession ?? createSession();
    send(session, input.trim());
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [input, loading, activeSession, createSession, send]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
          className="chat-header-caret"
          data-testid="chat-dropdown-toggle"
          onClick={() => setDropdownOpen((o) => !o)}
          aria-expanded={dropdownOpen}
          aria-label="Toggle session list"
        >
          {dropdownOpen ? "▲" : "▼"}
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
      </div>

      {/* Session dropdown */}
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
