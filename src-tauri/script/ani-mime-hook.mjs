#!/usr/bin/env node
// ani-mime hook — invoked by Claude Code on every hook event.
// Reads a JSON payload from stdin, decides whether the mirror should be
// busy/idle, and POSTs to the local ani-mime HTTP server. Silent on success.

const PORT = 1234;
const HOST = "127.0.0.1";
const TIMEOUT_MS = 1000;

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

function decide(payload) {
  const event = payload.hook_event_name;
  switch (event) {
    case "PreToolUse":
    case "UserPromptSubmit":
      return { state: "busy", type: "task" };

    case "Stop":
    case "StopFailure":
    case "SessionEnd":
      return { state: "idle" };

    case "SessionStart": {
      const src = payload.source;
      if (src === "compact") return null;
      return { state: "idle" };
    }

    case "Notification": {
      const t = payload.notification_type;
      if (t === "permission_prompt" || t === "idle_prompt") {
        return { state: "idle" };
      }
      return null;
    }

    default:
      return null;
  }
}

async function post({ state, type }) {
  const params = new URLSearchParams({ pid: String(process.ppid), state });
  if (type) params.set("type", type);
  const url = `http://${HOST}:${PORT}/status?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  try {
    const raw = (await readStdin()).trim();
    if (!raw) return;
    const payload = JSON.parse(raw);
    const action = decide(payload);
    if (!action) return;
    await post(action);
  } catch (err) {
    console.error(`[ani-mime-hook] ${err && err.message ? err.message : err}`);
  } finally {
    process.exit(0);
  }
})();
