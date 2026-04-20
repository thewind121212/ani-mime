import { Mascot } from "./components/Mascot";
import { StatusPill } from "./components/StatusPill";
import { SpeechBubble } from "./components/SpeechBubble";
import { VisitorDog } from "./components/VisitorDog";
import { DevTag } from "./components/DevTag";
import { DevBuildBadge } from "./components/DevBuildBadge";
import { EffectOverlay } from "./effects";
import { useStatus } from "./hooks/useStatus";
import { useDrag } from "./hooks/useDrag";
import { useTheme } from "./hooks/useTheme";
import { useBubble } from "./hooks/useBubble";
import { useVisitors } from "./hooks/useVisitors";
import { useScale } from "./hooks/useScale";
import { useDevMode } from "./hooks/useDevMode";
import { useWindowAutoSize } from "./hooks/useWindowAutoSize";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import "./styles/theme.css";
import "./styles/app.css";

// Extra height to add to the widget window while the fixed-positioned
// session-list dropdown is open. Gives the dropdown room to render
// without being clipped (the dropdown itself is position: fixed so it
// doesn't inflate the container, which means useWindowAutoSize would
// otherwise leave the window at its compact size). 300 = dropdown
// max-height (280px) + top gap (6) + shadow buffer (~14).
const SESSION_DROPDOWN_EXTRA_HEIGHT = 300;
const SESSION_DROPDOWN_MIN_WIDTH = 320;

function App() {
  const { status, scenario } = useStatus();
  const { dragging, onMouseDown } = useDrag();
  const { visible, message, dismiss } = useBubble();
  const visitors = useVisitors();
  const { scale } = useScale();
  const devMode = useDevMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const [effectActive, setEffectActive] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  useTheme();
  // Pause auto-size while the session dropdown is open — we manually
  // grow the window so the absolute-positioned dropdown has room.
  useWindowAutoSize(containerRef, effectActive || sessionOpen);

  useEffect(() => {
    if (!sessionOpen) return;
    const el = containerRef.current;
    if (!el) return;
    const width = Math.max(el.offsetWidth, SESSION_DROPDOWN_MIN_WIDTH);
    const height = el.offsetHeight + SESSION_DROPDOWN_EXTRA_HEIGHT;
    getCurrentWindow()
      .setSize(new LogicalSize(width, height))
      .catch((err) => console.error("[session-dropdown] setSize failed:", err));
  }, [sessionOpen]);

  return (
    <div
      ref={containerRef}
      data-testid="app-container"
      className={`container ${dragging ? "dragging" : ""} ${scenario ? "scenario-active" : ""}`}
      onMouseDown={onMouseDown}
    >
      <div className="main-col">
        {scenario && <div data-testid="scenario-badge" className="scenario-badge">SCENARIO</div>}
        <EffectOverlay onActiveChange={setEffectActive} />
        <SpeechBubble visible={visible} message={message} onDismiss={dismiss} />
        {status !== "visiting" && <Mascot status={status} />}
        {status === "visiting" && <div style={{ width: 128 * scale, height: 128 * scale }} />}
        <DevBuildBadge />
        <StatusPill
          status={status}
          glow={visible}
          disabled={status === "visiting"}
          onOpenChange={setSessionOpen}
        />
        {devMode && <DevTag />}
      </div>
      {visitors.length > 0 && (
        <div className="visitors-col" data-testid="visitors-col">
          {visitors.map((v, i) => (
            <VisitorDog
              key={v.instance_name || v.nickname || `${i}`}
              pet={v.pet}
              nickname={v.nickname}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
