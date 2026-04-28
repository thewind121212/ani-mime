import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const STORE_FILE = "settings.json";
const STORE_KEY = "bubbleEnabled";
const BUBBLE_DURATION_MS = 7000;

const genericMessages = [
  "Done! Check it out",
  "All finished!",
  "Hey, take a look!",
  "Task complete!",
  "Ready for you!",
];

// Templates use {folder} as the project leaf folder name.
const claudeMessages = [
  "Boss! Claude wrapped {folder}!",
  "{folder} cooked by Claude — woof!",
  "Tail wag! Claude shipped {folder}, boss!",
  "Boss, Claude is done with {folder}!",
  "{folder} all clear — Claude out!",
];

const codexMessages = [
  "Boss! Codex nailed {folder}!",
  "Codex shipped {folder} — woof boss!",
  "{folder} cooked by Codex, boss!",
  "Boss! Codex wrapped {folder}!",
  "Codex done in {folder} — tail wag!",
];

const shellMessages = [
  "Boss! {folder} command done!",
  "{folder} task wrapped, boss!",
  "Done in {folder} — woof!",
  "Boss, {folder} is all clear!",
  "Tail wag! {folder} finished!",
];

const welcomeMessages = [
  "Hey! Ready to work",
  "Let's get started!",
  "Hello there!",
  "Woof! Hi!",
];

function leafFolder(pwd: string): string {
  if (!pwd) return "";
  // Strip trailing slashes, take last path component, fall back to ~ for $HOME.
  const trimmed = pwd.replace(/\/+$/, "");
  const leaf = trimmed.split("/").filter(Boolean).pop();
  return leaf ?? "";
}

function pickMessage(source: string, pwd: string): string {
  const folder = leafFolder(pwd);
  // Without a folder, source-specific lines lose their punch — fall back to
  // the original generic pool so the bubble still reads naturally.
  if (!folder) {
    return genericMessages[Math.floor(Math.random() * genericMessages.length)];
  }
  const pool =
    source === "claude" ? claudeMessages
    : source === "codex" ? codexMessages
    : shellMessages;
  const tpl = pool[Math.floor(Math.random() * pool.length)];
  return tpl.replace("{folder}", folder);
}

interface TaskCompleted {
  duration_secs: number;
  pwd?: string;
  source?: string;
}

export function useBubble() {
  const [enabled, setEnabledState] = useState(true);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasGreeted = useRef(false);

  // Load saved preference
  useLayoutEffect(() => {
    load(STORE_FILE).then((store) => {
      store.get<boolean>(STORE_KEY).then((saved) => {
        setEnabledState(saved ?? true);
      });
    });
  }, []);

  // Listen for setting changes from Settings window
  useEffect(() => {
    const unlisten = listen<boolean>("bubble-changed", (event) => {
      setEnabledState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Welcome bubble on first "idle" after app launch
  useEffect(() => {
    const unlisten = listen<string>("status-changed", (e) => {
      if (hasGreeted.current || !enabled) return;
      if (e.payload === "idle") {
        hasGreeted.current = true;
        clearTimeout(timerRef.current);
        setMessage(welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]);
        setVisible(true);
        timerRef.current = setTimeout(() => {
          setVisible(false);
        }, BUBBLE_DURATION_MS);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [enabled]);

  // Hide bubble when status changes to busy. Don't hide on "service" — that
  // state is also entered as the post-task celebration flash on AI Stop, and
  // we want the "boss done" bubble to stay visible across the 2s blue pulse
  // until it's either dismissed or its own timer expires.
  useEffect(() => {
    const unlisten = listen<string>("status-changed", (e) => {
      if (e.payload === "busy") {
        clearTimeout(timerRef.current);
        setVisible(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for task-completed events
  useEffect(() => {
    const unlisten = listen<TaskCompleted>("task-completed", (e) => {
      if (!enabled) return;

      clearTimeout(timerRef.current);
      setMessage(pickMessage(e.payload.source ?? "", e.payload.pwd ?? ""));
      setVisible(true);

      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, BUBBLE_DURATION_MS);
    });

    return () => {
      clearTimeout(timerRef.current);
      unlisten.then((fn) => fn());
    };
  }, [enabled]);

  // Listen for discovery-hint: no peers found after timeout
  useEffect(() => {
    const unlisten = listen<string>("discovery-hint", (e) => {
      if (e.payload !== "no_peers") return;

      clearTimeout(timerRef.current);
      setMessage("No friends nearby! Check Privacy \u2192 Local Network");
      setVisible(true);

      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, 10000);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for mcp-say: speech bubble triggered by MCP server / AI agent
  useEffect(() => {
    const unlisten = listen<{ message: string; duration_ms: number }>("mcp-say", (e) => {
      if (!enabled) return;

      clearTimeout(timerRef.current);
      setMessage(e.payload.message);
      setVisible(true);

      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, e.payload.duration_ms || BUBBLE_DURATION_MS);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [enabled]);

  // Listen for bubble-preview: persistent bubble from scenario (no auto-hide, dismiss manually)
  useEffect(() => {
    const unlisten = listen<string>("bubble-preview", (e) => {
      clearTimeout(timerRef.current);
      setMessage(e.payload);
      setVisible(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const dismiss = useCallback(() => {
    clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const setEnabled = async (next: boolean) => {
    setEnabledState(next);
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, next);
    await store.save();
    await emit("bubble-changed", next);
  };

  return { visible, message, dismiss, enabled, setEnabled };
}
