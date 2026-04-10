import { useState, useEffect, useLayoutEffect } from "react";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { emit, listen } from "@tauri-apps/api/event";

export function useAutoStart() {
  const [enabled, setEnabledState] = useState(false);

  useLayoutEffect(() => {
    isEnabled().then((val) => setEnabledState(val));
  }, []);

  useEffect(() => {
    const unlisten = listen<boolean>("autostart-changed", (event) => {
      setEnabledState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const setEnabled = async (next: boolean) => {
    if (next) {
      await enable();
    } else {
      await disable();
    }
    setEnabledState(next);
    await emit("autostart-changed", next);
  };

  return { enabled, setEnabled };
}
