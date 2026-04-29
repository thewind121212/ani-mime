import { useState, useEffect, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

export function useFullscreenOverlay() {
  const [enabled, setEnabledState] = useState(false);

  useLayoutEffect(() => {
    load("settings.json").then(async (store) => {
      const val = await store.get<boolean>("fullscreenOverlay");
      if (val !== null && val !== undefined) {
        setEnabledState(val);
      }
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<boolean>("fullscreen-overlay-changed", (event) => {
      setEnabledState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const setEnabled = async (next: boolean) => {
    const store = await load("settings.json");
    await store.set("fullscreenOverlay", next);
    await store.save();
    await invoke("set_fullscreen_overlay", { enabled: next });
    setEnabledState(next);
    await emit("fullscreen-overlay-changed", next);
  };

  return { enabled, setEnabled };
}
