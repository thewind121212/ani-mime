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
  const promises = entries
    .filter((e) => e.name?.endsWith(".json"))
    .map((e) => loadSession(e.name!.replace(".json", "")));
  const results = await Promise.all(promises);
  const sessions = results.filter((s): s is ChatSession => s !== null);
  sessions.sort((a, b) => b.updated - a.updated);
  return sessions;
}

export function useChatHistory() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);

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

  const switchSession = useCallback(async (id: string) => {
    const session = await loadSession(id);
    if (session) {
      setActiveSession(session);
      setActiveId(id);
    }
  }, []);

  // Fix I3: don't mutate argument — create a copy
  const updateSession = useCallback(async (session: ChatSession) => {
    const updated = { ...session, updated: Date.now() };
    if (updated.title === "New Chat" && updated.messages.length > 0) {
      const firstUser = updated.messages.find((m) => m.role === "user");
      if (firstUser) updated.title = generateTitle(firstUser.content);
    }
    await saveSession(updated);
    setActiveSession(updated);
    setSessions((prev) => [updated, ...prev.filter((s) => s.id !== updated.id)]);
  }, []);

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
