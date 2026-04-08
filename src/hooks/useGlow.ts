import { useState, useEffect, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

export type GlowMode = "off" | "light" | "dark";

const STORE_FILE = "settings.json";
const STORE_KEY = "glowMode";

export function useGlow() {
  const [mode, setModeState] = useState<GlowMode>("light");

  useLayoutEffect(() => {
    load(STORE_FILE).then(async (store) => {
      // Migrate old boolean format
      const oldKey = await store.get<boolean>("glowEnabled");
      const saved = await store.get<GlowMode>(STORE_KEY);
      if (saved) {
        setModeState(saved);
      } else if (oldKey !== null && oldKey !== undefined) {
        const migrated: GlowMode = oldKey ? "light" : "off";
        setModeState(migrated);
        await store.set(STORE_KEY, migrated);
        await store.delete("glowEnabled");
        await store.save();
      }
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<GlowMode>("glow-changed", (event) => {
      setModeState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const setMode = async (next: GlowMode) => {
    setModeState(next);
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, next);
    await store.save();
    await emit("glow-changed", next);
  };

  return { mode, setMode };
}
