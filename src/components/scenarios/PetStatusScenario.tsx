import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Status } from "../../types/status";

const statuses: { status: Status; label: string; desc: string; color: string }[] = [
  { status: "idle", label: "Free", desc: "No active tasks", color: "#34c759" },
  { status: "busy", label: "Working", desc: "Running a command", color: "#ff3b30" },
  { status: "service", label: "Service", desc: "Brief service event", color: "#5e5ce6" },
  { status: "disconnected", label: "Sleep", desc: "Idle timeout / no sessions", color: "#636366" },
  { status: "initializing", label: "Initializing", desc: "App starting up", color: "#ff9f0a" },
  { status: "searching", label: "Searching", desc: "Looking for shell sessions", color: "#ffcc00" },
  { status: "visiting", label: "Visiting", desc: "Dog visiting a peer", color: "#af52de" },
];

export function PetStatusScenario() {
  const [active, setActive] = useState<Status | null>(null);

  const handleClick = (status: Status) => {
    setActive(status);
    invoke("scenario_override", { status });
  };

  return (
    <div className="scenario-panel">
      <div className="scenario-panel-desc">
        Click a status to preview it on the mascot in real-time.
      </div>
      <div className="scenario-status-grid">
        {statuses.map(({ status, label, desc, color }) => (
          <button
            key={status}
            className={`scenario-status-btn ${active === status ? "active" : ""}`}
            onClick={() => handleClick(status)}
          >
            <div className="scenario-status-title">
              <span className="scenario-status-dot" style={{ background: color }} />
              <span className="scenario-status-label">{label}</span>
            </div>
            <span className="scenario-status-desc">{desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
