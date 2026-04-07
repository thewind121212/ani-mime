import { Mascot } from "./components/Mascot";
import { StatusPill } from "./components/StatusPill";
import { SpeechBubble } from "./components/SpeechBubble";
import { useStatus } from "./hooks/useStatus";
import { useDrag } from "./hooks/useDrag";
import { useTheme } from "./hooks/useTheme";
import { useBubble } from "./hooks/useBubble";
import "./styles/theme.css";
import "./styles/app.css";

function App() {
  const status = useStatus();
  const { dragging, onMouseDown } = useDrag();
  const { visible, message, dismiss } = useBubble();
  useTheme();

  return (
    <div
      className={`container ${dragging ? "dragging" : ""}`}
      onMouseDown={onMouseDown}
    >
      <SpeechBubble visible={visible} message={message} onDismiss={dismiss} />
      <Mascot status={status} />
      <StatusPill status={status} glow={visible} />
    </div>
  );
}

export default App;
