import { useEffect, useRef, useState } from "react";
import { emit } from "@tauri-apps/api/event";

/**
 * Fake visiting pets for the "Visitors" scenario. Each toggle emits the
 * same Tauri events the real visit flow uses (`visitor-arrived` /
 * `visitor-left`), so the existing `useVisitors` hook + `VisitorDog`
 * rendering path runs unmodified — no backend involved.
 */
interface FakeVisitor {
  instance_name: string;
  pet: string;
  nickname: string;
}

const FAKE_VISITORS: FakeVisitor[] = [
  { instance_name: "scenario-alice-1", pet: "rottweiler", nickname: "Alice" },
  { instance_name: "scenario-bob-2", pet: "dalmatian", nickname: "Bob" },
  { instance_name: "scenario-carol-3", pet: "samurai", nickname: "Carol" },
  { instance_name: "scenario-dave-4", pet: "hancock", nickname: "Dave" },
];

async function emitArrived(v: FakeVisitor) {
  await emit("visitor-arrived", {
    instance_name: v.instance_name,
    pet: v.pet,
    nickname: v.nickname,
    duration_secs: 9999, // effectively no auto-expiry while the scenario is active
  });
}

async function emitLeft(v: FakeVisitor) {
  await emit("visitor-left", {
    instance_name: v.instance_name,
    nickname: v.nickname,
  });
}

export function VisitorScenario() {
  const [active, setActive] = useState<Set<string>>(new Set());
  // Keep a ref of `active` so the unmount cleanup sees the latest set
  // without refreshing the effect dependency each toggle.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    return () => {
      // Clean up any visitors we spawned when the scenario unmounts.
      for (const name of activeRef.current) {
        const v = FAKE_VISITORS.find((f) => f.instance_name === name);
        if (v) void emitLeft(v);
      }
    };
  }, []);

  const toggle = async (v: FakeVisitor) => {
    if (active.has(v.instance_name)) {
      await emitLeft(v);
      setActive((s) => {
        const n = new Set(s);
        n.delete(v.instance_name);
        return n;
      });
    } else {
      await emitArrived(v);
      setActive((s) => new Set(s).add(v.instance_name));
    }
  };

  const clearAll = async () => {
    for (const name of active) {
      const v = FAKE_VISITORS.find((f) => f.instance_name === name);
      if (v) await emitLeft(v);
    }
    setActive(new Set());
  };

  return (
    <div className="scenario-panel">
      <div className="scenario-panel-desc">
        Toggle fake visiting pets to preview how the mascot row looks when
        friends send their pets over. Click a name to bring them in or out;
        your local pet stays put.
      </div>
      <div className="scenario-status-grid">
        {FAKE_VISITORS.map((v) => {
          const isActive = active.has(v.instance_name);
          return (
            <button
              key={v.instance_name}
              data-testid={`scenario-visitor-${v.nickname.toLowerCase()}`}
              className={`scenario-status-btn ${isActive ? "active" : ""}`}
              onClick={() => toggle(v)}
            >
              <div className="scenario-status-title">
                <span className="scenario-status-label">{v.nickname}</span>
              </div>
              <span className="scenario-status-desc">
                {v.pet} {isActive ? "(visiting)" : ""}
              </span>
            </button>
          );
        })}
      </div>
      {active.size > 0 && (
        <button
          type="button"
          className="scenario-stop-btn"
          style={{ marginTop: 12 }}
          onClick={clearAll}
          data-testid="scenario-visitor-clear"
        >
          Clear all visitors ({active.size})
        </button>
      )}
    </div>
  );
}
