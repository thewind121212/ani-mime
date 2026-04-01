import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

type Status = "initializing" | "searching" | "idle" | "busy" | "service" | "disconnected";

const spriteMap: Record<string, { file: string; frames: number }> = {
  disconnected: { file: "SleepDogg.png", frames: 8 },
  busy: { file: "RottweilerSniff.png", frames: 31 },
  service: { file: "RottweilerBark.png", frames: 12 },
  idle: { file: "Sittiing.png", frames: 8 },
  searching: { file: "RottweilerIdle.png", frames: 6 },
  initializing: { file: "RottweilerIdle.png", frames: 6 },
};

// These statuses stop animating after 10s and freeze on the last frame
const autoStopStatuses = new Set<Status>(["idle", "disconnected"]);

function App() {
  const [status, setStatus] = useState<Status>("initializing");
  const [dragging, setDragging] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  // Handle auto-stop animation for idle/sleep
  useEffect(() => {
    clearTimeout(timerRef.current);
    setFrozen(false);

    if (autoStopStatuses.has(status)) {
      timerRef.current = setTimeout(() => setFrozen(true), 10_000);
    }

    return () => clearTimeout(timerRef.current);
  }, [status]);

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

  const sprite = spriteMap[status] ?? spriteMap.searching;
  const spriteUrl = new URL(
    `./assets/sprites/${sprite.file}`,
    import.meta.url
  ).href;

  // When frozen, show the last frame by setting background-position to the end
  const lastFrameOffset = (sprite.frames - 1) * 128;

  return (
    <div
      className={`container ${dragging ? "dragging" : ""}`}
      onMouseDown={handleMouseDown}
    >
      <div
        className={`sprite ${frozen ? "frozen" : ""}`}
        style={{
          backgroundImage: `url(${spriteUrl})`,
          width: 128,
          height: 128,
          "--sprite-steps": sprite.frames,
          "--sprite-width": `${sprite.frames * 128}px`,
          "--sprite-duration": `${sprite.frames * 80}ms`,
          ...(frozen ? { backgroundPosition: `-${lastFrameOffset}px 0` } : {}),
        } as React.CSSProperties}
      />
      <div className="pill">
        <span className={dotClass} />
        <span className="label">{label}</span>
      </div>
    </div>
  );
}

export default App;
