import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { scenarios, type ScenarioDefinition } from "./registry";

export function ScenarioViewer() {
  const [active, setActive] = useState<ScenarioDefinition | null>(null);

  // Clean up on unmount: exit scenario mode when switching menu or closing window
  useEffect(() => {
    return () => {
      invoke("scenario_override", { status: null });
    };
  }, []);

  const handleStart = (scenario: ScenarioDefinition) => {
    setActive(scenario);
  };

  const handleStop = () => {
    invoke("scenario_override", { status: null });
    setActive(null);
  };

  if (active) {
    const Component = active.component;
    return (
      <div className="scenario-viewer">
        <div className="scenario-header">
          <div className="scenario-header-info">
            <span className="scenario-header-icon">{active.icon}</span>
            <span className="scenario-header-name">{active.name}</span>
          </div>
          <button className="scenario-stop-btn" onClick={handleStop}>
            Stop Scenario
          </button>
        </div>
        <div className="scenario-body">
          <Component />
        </div>
      </div>
    );
  }

  return (
    <div className="scenario-viewer">
      <div className="scenario-toolbar">
        <span className="scenario-toolbar-title">Scenarios</span>
        <span className="scenario-toolbar-count">{scenarios.length} available</span>
      </div>
      <div className="scenario-list">
        {scenarios.map((s) => (
          <button
            key={s.id}
            className="scenario-card"
            onClick={() => handleStart(s)}
          >
            <span className="scenario-card-icon">{s.icon}</span>
            <div className="scenario-card-text">
              <span className="scenario-card-name">{s.name}</span>
              <span className="scenario-card-desc">{s.description}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
