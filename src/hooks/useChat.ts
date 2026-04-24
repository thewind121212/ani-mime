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

/**
 * Chat hook that sends messages to chat2api and streams responses.
 * Fix B2: accepts session explicitly via parameter to avoid stale closure.
 * Fix I5: uses ref for latest session during streaming.
 */
export function useChat(
  onUpdate: (session: ChatSession) => Promise<void>,
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (session: ChatSession, userMessage: string) => {
      if (!userMessage.trim()) return;
      setError(null);

      const userMsg: ChatMessage = { role: "user", content: userMessage.trim() };
      const updatedMessages = [...session.messages, userMsg];
      const sessionWithUser = { ...session, messages: updatedMessages };
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

      let assistantContent = "";

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
        let buffer = "";
        // Fix B3: use flag to break outer loop on [DONE]
        let streamDone = false;

        while (!streamDone) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              streamDone = true;
              break;
            }

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
          ...session,
          messages: [...updatedMessages, assistantMsg],
        };
        await onUpdate(finalSession);
        setStreamingContent("");
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Fix I2: save partial content on cancel
          if (assistantContent) {
            const partialMsg: ChatMessage = {
              role: "assistant",
              content: assistantContent,
            };
            const partialSession = {
              ...session,
              messages: [...updatedMessages, partialMsg],
            };
            await onUpdate(partialSession);
          }
        } else if (
          err instanceof TypeError &&
          (err.message.includes("fetch") || err.message.includes("network"))
        ) {
          // Fix I2: save partial content on network error
          if (assistantContent) {
            const partialMsg: ChatMessage = {
              role: "assistant",
              content: assistantContent,
            };
            const partialSession = {
              ...session,
              messages: [...updatedMessages, partialMsg],
            };
            await onUpdate(partialSession);
          }
          setError("Cannot connect to chat2api at 127.0.0.1:5005");
        } else {
          if (assistantContent) {
            const partialMsg: ChatMessage = {
              role: "assistant",
              content: assistantContent,
            };
            const partialSession = {
              ...session,
              messages: [...updatedMessages, partialMsg],
            };
            await onUpdate(partialSession);
          }
          setError(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        setLoading(false);
        setStreamingContent("");
        abortRef.current = null;
      }
    },
    [onUpdate],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, cancel, loading, error, streamingContent };
}
