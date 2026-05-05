#!/usr/bin/env node
// ani-mime hook — invoked by Claude Code on every hook event.
// Reads a JSON payload from stdin, decides whether the mirror should be
// busy/idle, and POSTs to the local ani-mime HTTP server. Silent on success.

import { execSync } from "node:child_process";

const PORT = 1234;
const HOST = "127.0.0.1";
const TIMEOUT_MS = 1000;

// Claude Code runs `node ... || true` via `sh -c`, so process.ppid is the
// wrapper shell (ephemeral). The grandparent is the long-lived claude
// process, which proc_scan shields from zombie cleanup. Fall back to
// pid=0 (virtual session, also shielded) if the walk fails.
function resolveSessionPid() {
  try {
    const out = execSync(`ps -o ppid= -p ${process.ppid}`, {
      encoding: "utf8",
      timeout: 200,
    }).trim();
    const pppid = parseInt(out, 10);
    if (Number.isFinite(pppid) && pppid > 1) return pppid;
  } catch {}
  return 0;
}

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
  const params = new URLSearchParams({ pid: String(resolveSessionPid()), state });
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
