import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import { playAudio } from "../utils/audio";
import { useSoundSettings } from "./useSoundSettings";

const STORE_FILE = "settings.json";
const STORE_KEY = "bubbleEnabled";
const BUBBLE_DURATION_MS = 7000;
const PERMISSION_BUBBLE_STEP_MS = 1300;
const PERMISSION_BUBBLE_TAIL_MS = 800;
// Debounce window for the "cooking ${folder}" start bubble. Short tasks that
// finish before this delay never get a visible bubble, so a flurry of
// idle→busy→idle blips doesn't spam the dog.
const TASK_STARTED_DELAY_MS = 1500;
const TASK_STARTED_DURATION_MS = 4000;

const permissionLines = [
  "Permission unlocked, boss!",
  "On it — woof!",
  "Tail wag! Back to work!",
];

function permissionLinesFor(folder: string): string[] {
  if (!folder) return permissionLines;
  return [
    "Permission unlocked, boss!",
    `Cooking ${folder} now!`,
    "On it — woof!",
  ];
}

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

const claudeStartMessages = [
  "Cooking {folder} now, boss!",
  "Claude on {folder} — woof!",
  "Boss! Diving into {folder}!",
  "{folder} time — Claude rolling!",
];

const codexStartMessages = [
  "Codex cooking {folder}, boss!",
  "On {folder} — Codex rolling!",
  "Boss! Codex digging into {folder}!",
  "{folder} time — woof from Codex!",
];

const genericStartMessages = [
  "On it, boss!",
  "Tail wag — getting to work!",
  "Cooking now!",
  "Woof! Working!",
];

const waitingMessages = [
  "Waiting for boss permission, woof!",
  "Need your call, boss — woof!",
  "Paw on hold — permission please?",
  "Standing by, boss! Woof!",
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

function pickStartMessage(source: string, pwd: string): string {
  const folder = leafFolder(pwd);
  if (!folder) {
    return genericStartMessages[
      Math.floor(Math.random() * genericStartMessages.length)
    ];
  }
  const pool =
    source === "claude" ? claudeStartMessages
    : source === "codex" ? codexStartMessages
    : genericStartMessages;
  const tpl = pool[Math.floor(Math.random() * pool.length)];
  return tpl.replace("{folder}", folder);
}

interface TaskCompleted {
  duration_secs: number;
  pwd?: string;
  source?: string;
}

interface TaskStarted {
  pid: number;
  pwd?: string;
  source?: string;
}

export function useBubble() {
  const [enabled, setEnabledState] = useState(true);
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Pending "cooking ${folder}" reveal. Cleared on task-completed or any
  // status-changed away from busy so a quick task never reaches the bubble.
  const startTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // True while the persistent "waiting for permission" bubble is showing.
  // Used to clear it when status transitions away from waiting.
  const waitingShowingRef = useRef(false);
  const hasGreeted = useRef(false);
  // True while the 3-bubble permission-allowed sequence is running. The
  // status-changed=busy listener checks this to avoid hiding the bubble
  // when claude transitions waiting -> busy mid-sequence.
  const permissionShowingRef = useRef(false);
  const sound = useSoundSettings();
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

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
      // Any transition away from busy means the pending start-bubble is
      // no longer relevant — drop the debounce so a quick idle→busy→idle
      // never lands a bubble.
      if (e.payload !== "busy") {
        clearTimeout(startTimerRef.current);
      }
      // Show the persistent "waiting for boss permission" bubble while
      // the dot is pink. Sticks around with no auto-hide timer until the
      // status leaves waiting — the permission-allowed listener overrides
      // it on approval, the cleanup branch below clears it on denial.
      if (e.payload === "waiting" && enabled) {
        clearTimeout(timerRef.current);
        const line =
          waitingMessages[Math.floor(Math.random() * waitingMessages.length)];
        setMessage(line);
        setVisible(true);
        waitingShowingRef.current = true;
        return;
      }
      if (waitingShowingRef.current && e.payload !== "waiting") {
        waitingShowingRef.current = false;
        // On waiting → busy the permission-allowed sequence takes over
        // the bubble. Any other exit (idle/service/disconnected) clears it.
        if (e.payload !== "busy") {
          clearTimeout(timerRef.current);
          setVisible(false);
        }
      }
      // Skip the hide while the permission-allowed sequence owns the bubble:
      // that sequence is started by the same waiting->busy transition that
      // emits this event, and clearing it would kill the first bubble.
      if (e.payload === "busy" && !permissionShowingRef.current) {
        clearTimeout(timerRef.current);
        setVisible(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [enabled]);

  // Listen for task-completed events
  useEffect(() => {
    const unlisten = listen<TaskCompleted>("task-completed", (e) => {
      // Always cancel any pending start-bubble — the task ended before
      // the debounce fired, so the "cooking" message is no longer
      // relevant. Done independently of `enabled` so a disabled-bubble
      // user still drops the timer cleanly.
      clearTimeout(startTimerRef.current);

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
      clearTimeout(startTimerRef.current);
      unlisten.then((fn) => fn());
    };
  }, [enabled]);

  // Listen for task-started: schedules a delayed "cooking ${folder}"
  // bubble. Quick busy bursts that resolve before the delay never reach
  // the user — short tasks are noise, long tasks earn the announcement.
  useEffect(() => {
    const unlisten = listen<TaskStarted>("task-started", (e) => {
      if (!enabled) return;

      clearTimeout(startTimerRef.current);
      const source = e.payload.source ?? "";
      const pwd = e.payload.pwd ?? "";
      startTimerRef.current = setTimeout(() => {
        // Don't override the permission-allowed sequence mid-flight.
        if (permissionShowingRef.current) return;
        clearTimeout(timerRef.current);
        setMessage(pickStartMessage(source, pwd));
        setVisible(true);
        timerRef.current = setTimeout(() => {
          setVisible(false);
        }, TASK_STARTED_DURATION_MS);
      }, TASK_STARTED_DELAY_MS);
    });

    return () => {
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

  // Listen for permission-allowed: claude waiting -> busy transition (user
  // approved the permission prompt). Plays a 3-bubble sequence with a sound
  // on each step. Sequencing uses timerRef so we share cleanup with the
  // other bubble triggers.
  useEffect(() => {
    const unlisten = listen<{ pid?: number; pwd?: string }>("permission-allowed", (e) => {
      if (!enabled) return;

      const folder = leafFolder(e.payload?.pwd ?? "");
      const lines = permissionLinesFor(folder);

      clearTimeout(timerRef.current);
      permissionShowingRef.current = true;

      let i = 0;
      const step = () => {
        if (i >= lines.length) {
          timerRef.current = setTimeout(() => {
            permissionShowingRef.current = false;
            setVisible(false);
          }, PERMISSION_BUBBLE_TAIL_MS);
          return;
        }
        setMessage(lines[i++]);
        setVisible(true);
        const s = soundRef.current;
        if (s.master && s.status) {
          try { playAudio("done", { volume: 0.6 }); } catch { /* noop */ }
        }
        timerRef.current = setTimeout(step, PERMISSION_BUBBLE_STEP_MS);
      };
      step();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [enabled]);

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
