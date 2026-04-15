import { useState, useEffect, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const STORAGE_KEY = "sessionListEnabled";
const EVENT_NAME = "session-list-changed";

/** Whether the click-the-pill session list dropdown is enabled. Defaults to on. */
export function useSessionList() {
  const [enabled, setEnabledState] = useState(true);

  useLayoutEffect(() => {
    load("settings.json").then(async (store) => {
      const val = await store.get<boolean>(STORAGE_KEY);
      if (val !== null && val !== undefined) {
        setEnabledState(val);
      }
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<boolean>(EVENT_NAME, (event) => {
      setEnabledState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const setEnabled = async (next: boolean) => {
    const store = await load("settings.json");
    await store.set(STORAGE_KEY, next);
    await store.save();
    setEnabledState(next);
    await emit(EVENT_NAME, next);
  };

  return { enabled, setEnabled };
}
