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
]);

export function useStatus(): Status {
  const [status, setStatus] = useState<Status>("initializing");

  useEffect(() => {
    const unlistenStatus = listen<string>("status-changed", (e) => {
      if (validStatuses.has(e.payload)) {
        setStatus(e.payload as Status);
      }
    });

    return () => {
      unlistenStatus.then((fn) => fn());
    };
  }, []);

  return status;
}
