import { useState, useLayoutEffect, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const STORE_FILE = "settings.json";
const STORE_KEY = "petOpacity";

export const OPACITY_MIN = 0.1;
export const OPACITY_MAX = 1;
export const OPACITY_DEFAULT = 1;

function clamp(v: number): number {
  if (Number.isNaN(v)) return OPACITY_DEFAULT;
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, v));
}

export function useOpacity() {
  const [opacity, setOpacityState] = useState<number>(OPACITY_DEFAULT);

  useLayoutEffect(() => {
    load(STORE_FILE).then((store) => {
      store.get<number>(STORE_KEY).then((saved) => {
        if (typeof saved === "number") setOpacityState(clamp(saved));
      });
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<number>("opacity-changed", (event) => {
      setOpacityState(clamp(event.payload));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const setOpacity = async (next: number) => {
    const v = clamp(next);
    setOpacityState(v);
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, v);
    await store.save();
    await emit("opacity-changed", v);
  };

  const previewOpacity = async (next: number) => {
    const v = clamp(next);
    setOpacityState(v);
    await emit("opacity-changed", v);
  };

  const loadSavedOpacity = async (): Promise<number> => {
    const store = await load(STORE_FILE);
    const saved = await store.get<number>(STORE_KEY);
    return typeof saved === "number" ? clamp(saved) : OPACITY_DEFAULT;
  };

  return { opacity, setOpacity, previewOpacity, loadSavedOpacity };
}
