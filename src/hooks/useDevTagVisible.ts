import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Session-only dev toggle: when true, the DEV tag overlay is shown
 * while dev mode is active.
 *
 * Auto-synced with dev mode: enabling dev mode turns this on, and
 * disabling dev mode turns it off. The Superpower tool can still
 * individually toggle it via `dev-tag-changed` while dev mode is
 * active — flipping this off only hides the DEV tag and leaves the
 * other dev outlines (app/container/root bounds) untouched.
 */
export function useDevTagVisible() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unlistenTag = listen<boolean>("dev-tag-changed", (e) => {
      setVisible(Boolean(e.payload));
    });
    const unlistenDevMode = listen<boolean>("dev-mode-changed", (e) => {
      setVisible(Boolean(e.payload));
    });
    return () => {
      unlistenTag.then((fn) => fn());
      unlistenDevMode.then((fn) => fn());
    };
  }, []);

  return visible;
}
