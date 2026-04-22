import { useState, useEffect, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import type { SoundChoice, SoundOverrides } from "../constants/sounds";

const STORE_KEY = "soundOverrides";
const EVENT_NAME = "sound-overrides-changed";

export function useSoundOverrides() {
  const [overrides, setOverrides] = useState<SoundOverrides>({});

  useLayoutEffect(() => {
    load("settings.json").then(async (store) => {
      const val = await store.get<SoundOverrides>(STORE_KEY);
      if (val && typeof val === "object") setOverrides(val);
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<SoundOverrides>(EVENT_NAME, (e) => {
      if (e.payload && typeof e.payload === "object") setOverrides(e.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const setOverride = async (caseId: string, choice: SoundChoice | null) => {
    const store = await load("settings.json");
    const current = (await store.get<SoundOverrides>(STORE_KEY)) ?? {};
    const next: SoundOverrides = { ...current };
    if (choice === null) {
      delete next[caseId];
    } else {
      next[caseId] = choice;
    }
    await store.set(STORE_KEY, next);
    await store.save();
    setOverrides(next);
    await emit(EVENT_NAME, next);
  };

  return { overrides, setOverride };
}
