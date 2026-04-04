import type { Status } from "../types/status";
import "../styles/status-pill.css";

interface StatusPillProps {
  status: Status;
}

const dotClassMap: Record<Status, string> = {
  service: "dot service",
  busy: "dot busy",
  idle: "dot idle",
  disconnected: "dot disconnected",
  initializing: "dot initializing",
  searching: "dot searching",
};

const labelMap: Record<Status, string> = {
  service: "Service",
  busy: "Working...",
  idle: "Free",
  disconnected: "Sleep",
  initializing: "Initializing...",
  searching: "Searching...",
};

export function StatusPill({ status }: StatusPillProps) {
  return (
    <div className="pill">
      <span className={dotClassMap[status] ?? "dot searching"} />
      <span className="label">{labelMap[status] ?? "Searching..."}</span>
    </div>
  );
}
