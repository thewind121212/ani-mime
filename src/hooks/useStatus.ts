import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { Status } from "../types/status";

const validStatuses = new Set<string>([
  "initializing",
  "searching",
  "busy",
  "idle",
  "service",
  "disconnected",
  "visiting",
]);

interface ScenarioOverride {
  status: string;
}

interface UseStatusResult {
  status: Status;
  scenario: boolean;
}

export function useStatus(): UseStatusResult {
  const [status, setStatus] = useState<Status>("initializing");
  const [away, setAway] = useState(false);
  const [scenarioStatus, setScenarioStatus] = useState<Status | null>(null);
  const [reactionStatus, setReactionStatus] = useState<Status | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // Pull current backend state once on mount — covers the race where the
    // backend's first status-changed emit happens before this listener attaches.
    // Without this the UI sticks on "initializing" until the next state change.
    invoke<string>("get_status")
      .then((s) => {
        if (validStatuses.has(s)) {
          setStatus(s as Status);
        }
      })
      .catch(() => {});

    const unlistenStatus = listen<string>("status-changed", (e) => {
      if (validStatuses.has(e.payload)) {
        setStatus(e.payload as Status);
      }
    });

    const unlistenAway = listen<boolean>("dog-away", (e) => {
      setAway(e.payload);
    });

    const unlistenScenario = listen<ScenarioOverride | null>("scenario-override", (e) => {
      if (e.payload && typeof e.payload === "object" && "status" in e.payload && validStatuses.has(e.payload.status)) {
        setScenarioStatus(e.payload.status as Status);
      } else {
        setScenarioStatus(null);
      }
    });

    return () => {
      unlistenStatus.then((fn) => fn());
      unlistenAway.then((fn) => fn());
      unlistenScenario.then((fn) => fn());
    };
  }, []);

  // MCP reaction: temporary animation override with auto-revert
  useEffect(() => {
    const unlisten = listen<{ status: string; duration_ms: number }>("mcp-react", (e) => {
      if (validStatuses.has(e.payload.status)) {
        clearTimeout(reactionTimerRef.current);
        setReactionStatus(e.payload.status as Status);
        reactionTimerRef.current = setTimeout(() => {
          setReactionStatus(null);
        }, e.payload.duration_ms || 3000);
      }
    });

    return () => {
      clearTimeout(reactionTimerRef.current);
      unlisten.then((fn) => fn());
    };
  }, []);

  // Priority: scenario (dev tools) > reaction (MCP) > real status
  if (scenarioStatus) {
    return { status: scenarioStatus, scenario: true };
  }
  if (reactionStatus) {
    return { status: reactionStatus, scenario: false };
  }
  return { status: away ? "visiting" : status, scenario: false };
}
