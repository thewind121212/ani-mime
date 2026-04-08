import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export function useDevMode() {
  const [devMode, setDevMode] = useState(false);

  useEffect(() => {
    const unlisten = listen<boolean>("dev-mode-changed", (event) => {
      setDevMode(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return devMode;
}
