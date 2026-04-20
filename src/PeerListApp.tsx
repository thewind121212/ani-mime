import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePeers, type PeerInfo } from "./hooks/usePeers";
import { useNickname } from "./hooks/useNickname";
import { usePet } from "./hooks/usePet";
import { useTheme } from "./hooks/useTheme";
import { useWindowAutoSize } from "./hooks/useWindowAutoSize";
import "./styles/theme.css";
import "./styles/peer-list-window.css";

export function PeerListApp() {
  const peers = usePeers();
  const { nickname } = useNickname();
  const { pet } = usePet();
  const rootRef = useRef<HTMLDivElement>(null);
  useTheme();
  // Auto-size this popover's Tauri window to match content height —
  // shrinks for empty state, grows as peers arrive.
  useWindowAutoSize(rootRef);

  // Auto-hide the popover when it loses focus (user clicks outside).
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenP = win.onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        void win.hide();
      }
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, []);

  // Escape closes the popover.
  useEffect(() => {
    const win = getCurrentWindow();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void win.hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleVisit = async (peer: PeerInfo) => {
    try {
      await invoke("start_visit", {
        peerId: peer.instance_name,
        nickname,
        pet,
      });
    } catch (err) {
      console.error("[peer-list] start_visit failed:", err);
    } finally {
      void getCurrentWindow().hide();
    }
  };

  return (
    <div ref={rootRef} className="peer-list-shell">
      <div className="peer-list-root" data-testid="peer-list-root">
        <div className="peer-list-header">Mime Around You</div>
      {peers.length === 0 ? (
        <div className="peer-list-empty" data-testid="peer-list-empty">
          <span className="peer-list-empty-title">No peers nearby</span>
          <span className="peer-list-empty-hint">
            Check Local Network permission
          </span>
        </div>
      ) : (
        <div className="peer-list-items" data-testid="peer-list-items">
          {peers.map((p) => (
            <button
              key={p.instance_name}
              type="button"
              className="peer-list-row"
              data-testid={`peer-list-row-${p.instance_name}`}
              onClick={() => handleVisit(p)}
              title={`Visit ${p.nickname} — ${p.ip}:${p.port}`}
            >
              <span className="peer-list-row-dot" aria-hidden="true" />
              <span className="peer-list-row-main">
                <span className="peer-list-row-nickname">{p.nickname}</span>
                <span className="peer-list-row-pet">{p.pet}</span>
              </span>
              <span className="peer-list-row-action" aria-hidden="true">
                visit
              </span>
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
