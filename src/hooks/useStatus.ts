import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
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

  useEffect(() => {
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

  if (scenarioStatus) {
    return { status: scenarioStatus, scenario: true };
  }
  return { status: away ? "visiting" : status, scenario: false };
}
