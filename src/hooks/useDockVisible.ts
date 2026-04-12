import { useState, useEffect, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

export function useDockVisible() {
  const [hidden, setHiddenState] = useState(false);

  useLayoutEffect(() => {
    load("settings.json").then(async (store) => {
      const val = await store.get<boolean>("hideDock");
      if (val !== null && val !== undefined) {
        setHiddenState(val);
      }
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<boolean>("hide-dock-changed", (event) => {
      setHiddenState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const setHidden = async (next: boolean) => {
    const store = await load("settings.json");
    await store.set("hideDock", next);
    await store.save();
    await invoke("set_dock_visible", { visible: !next });
    setHiddenState(next);
    await emit("hide-dock-changed", next);
  };

  return { hidden, setHidden };
}
