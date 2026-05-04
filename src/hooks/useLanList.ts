import { useState, useEffect, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const STORAGE_KEY = "lanListEnabled";
const MIGRATION_KEY = "lanListDefaultFalseMigrated";
const EVENT_NAME = "lan-list-changed";

/** Whether the LAN (peers) icon in the status pill is shown. Defaults to off. */
export function useLanList() {
  const [enabled, setEnabledState] = useState(false);

  useLayoutEffect(() => {
    load("settings.json").then(async (store) => {
      const migrated = await store.get<boolean>(MIGRATION_KEY);
      if (!migrated) {
        await store.set(STORAGE_KEY, false);
        await store.set(MIGRATION_KEY, true);
        await store.save();
        setEnabledState(false);
        return;
      }
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
