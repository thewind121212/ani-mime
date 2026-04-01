import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

type Status = "initializing" | "searching" | "idle" | "busy" | "service" | "disconnected";

function App() {
  const [status, setStatus] = useState<Status>("initializing");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const unlistenStatus = listen<string>("status-changed", (e) => {
      const s = e.payload;
      if (
        s === "initializing" ||
        s === "searching" ||
        s === "busy" ||
        s === "idle" ||
        s === "service" ||
        s === "disconnected"
      ) {
        setStatus(s as Status);
      }
    });

    return () => {
      unlistenStatus.then((fn) => fn());
    };
  }, []);

  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    await getCurrentWindow().startDragging();
    setDragging(false);
  }, []);

  const dotClass =
    status === "service"
      ? "dot service"
      : status === "busy"
        ? "dot busy"
        : status === "idle"
          ? "dot idle"
          : status === "disconnected"
            ? "dot disconnected"
            : status === "initializing"
              ? "dot initializing"
              : "dot searching";

  const label =
    status === "service"
      ? "Service"
      : status === "busy"
        ? "Working..."
        : status === "idle"
          ? "Free"
          : status === "disconnected"
            ? "Sleep"
            : status === "initializing"
              ? "Initializing..."
              : "Searching...";

  return (
    <div
      className={`pill ${dragging ? "dragging" : ""}`}
      onMouseDown={handleMouseDown}
    >
      <span className={dotClass} />
      <span className="label">{label}</span>
    </div>
  );
}

export default App;
