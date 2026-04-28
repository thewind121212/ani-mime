import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { fetchSessions } from "./useSessions";

/**
 * Live count of session groups — same grouping rule as the session dropdown:
 * shells grouped by pwd, plus the Claude Code virtual row if no shell owns it.
 * Event-driven: fetches once on mount, then refreshes only when the backend
 * emits `sessions-changed` (fingerprint-gated — no refresh unless something
 * the UI cares about actually changed).
 */
export function useSessionGroupCount(enabled: boolean = true): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      const list = await fetchSessions();
      if (cancelled) return;

      const keys = new Set<string>();
      let hasClaudeVirtual = false;
      let anyShellHasClaude = false;

      for (const s of list) {
        if (s.pid === 0) {
          hasClaudeVirtual = true;
          continue;
        }
        if (s.is_claude_proc) continue;
        if (s.is_codex_proc) continue;
        if (s.has_claude) anyShellHasClaude = true;
        keys.add(s.pwd || s.title || String(s.pid));
      }

      let n = keys.size;
      if (hasClaudeVirtual && !anyShellHasClaude) n += 1;
      setCount(n);
    };

    void refresh();
    const unlistenP = listen("sessions-changed", () => void refresh());

    return () => {
      cancelled = true;
      unlistenP.then((fn) => fn());
    };
  }, [enabled]);

  return count;
}
