import { Mascot } from "./components/Mascot";
import { StatusPill } from "./components/StatusPill";
import { useStatus } from "./hooks/useStatus";
import { useDrag } from "./hooks/useDrag";
import "./styles/app.css";

function App() {
  const status = useStatus();
  const { dragging, onMouseDown } = useDrag();

  return (
    <div
      className={`container ${dragging ? "dragging" : ""}`}
      onMouseDown={onMouseDown}
    >
      <Mascot status={status} />
      <StatusPill status={status} />
    </div>
  );
}

export default App;
