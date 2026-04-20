import { useState, useLayoutEffect, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const STORE_FILE = "settings.json";

export const OPACITY_MIN = 0.1;
export const OPACITY_MAX = 1;
export const OPACITY_DEFAULT = 1;

export type OpacityTarget = "mime" | "status";

const CONFIG: Record<OpacityTarget, { key: string; event: string }> = {
  mime: { key: "mimeOpacity", event: "mime-opacity-changed" },
  status: { key: "statusOpacity", event: "status-opacity-changed" },
};

function clamp(v: number): number {
  if (Number.isNaN(v)) return OPACITY_DEFAULT;
  return Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, v));
}

export function useOpacity(target: OpacityTarget) {
  const { key, event } = CONFIG[target];
  const [opacity, setOpacityState] = useState<number>(OPACITY_DEFAULT);

  useLayoutEffect(() => {
    load(STORE_FILE).then((store) => {
      store.get<number>(key).then((saved) => {
        if (typeof saved === "number") setOpacityState(clamp(saved));
      });
    });
  }, [key]);

  useEffect(() => {
    const unlisten = listen<number>(event, (e) => {
      setOpacityState(clamp(e.payload));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [event]);

  const setOpacity = async (next: number) => {
    const v = clamp(next);
    setOpacityState(v);
    const store = await load(STORE_FILE);
    await store.set(key, v);
    await store.save();
    await emit(event, v);
  };

  const previewOpacity = async (next: number) => {
    const v = clamp(next);
    setOpacityState(v);
    await emit(event, v);
  };

  const loadSavedOpacity = async (): Promise<number> => {
    const store = await load(STORE_FILE);
    const saved = await store.get<number>(key);
    return typeof saved === "number" ? clamp(saved) : OPACITY_DEFAULT;
  };

  return { opacity, setOpacity, previewOpacity, loadSavedOpacity };
}
