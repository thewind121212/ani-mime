import { useState, useEffect, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

export type SoundCategory = "status" | "visit";

interface SoundSettings {
  master: boolean;
  status: boolean;
  visit: boolean;
  /** When true the Working case plays its sound on a loop while busy; when false it plays once at the busy transition. */
  workingLoop: boolean;
}

const DEFAULTS: SoundSettings = { master: true, status: true, visit: true, workingLoop: false };

const STORE_KEYS = {
  master: "soundMaster",
  status: "soundStatus",
  visit: "soundVisit",
  workingLoop: "soundWorkingLoop",
} as const;

const EVENT_NAMES = {
  master: "sound-master-changed",
  status: "sound-status-changed",
  visit: "sound-visit-changed",
  workingLoop: "sound-working-loop-changed",
} as const;

export function useSoundSettings() {
  const [settings, setSettings] = useState<SoundSettings>(DEFAULTS);

  useLayoutEffect(() => {
    load("settings.json").then(async (store) => {
      const next: SoundSettings = { ...DEFAULTS };
      for (const key of Object.keys(STORE_KEYS) as (keyof SoundSettings)[]) {
        const val = await store.get<boolean>(STORE_KEYS[key]);
        if (val !== null && val !== undefined) next[key] = val;
      }
      setSettings(next);
    });
  }, []);

  useEffect(() => {
    const unlisteners = (Object.keys(EVENT_NAMES) as (keyof SoundSettings)[]).map((key) =>
      listen<boolean>(EVENT_NAMES[key], (e) => {
        setSettings((prev) => ({ ...prev, [key]: e.payload }));
      })
    );
    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  const setFlag = async (key: keyof SoundSettings, next: boolean) => {
    const store = await load("settings.json");
    await store.set(STORE_KEYS[key], next);
    await store.save();
    setSettings((prev) => ({ ...prev, [key]: next }));
    await emit(EVENT_NAMES[key], next);
  };

  const isCategoryEnabled = (category: SoundCategory): boolean =>
    settings.master && settings[category];

  return {
    ...settings,
    setMaster: (v: boolean) => setFlag("master", v),
    setStatus: (v: boolean) => setFlag("status", v),
    setVisit: (v: boolean) => setFlag("visit", v),
    setWorkingLoop: (v: boolean) => setFlag("workingLoop", v),
    isCategoryEnabled,
  };
}
