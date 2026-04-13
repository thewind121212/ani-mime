import { useState, useEffect, useLayoutEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const STORE_FILE = "settings.json";

function storeKey(effectId: string) {
  return `effect_${effectId}_enabled`;
}

function eventName(effectId: string) {
  return `effect-${effectId}-changed`;
}

export function useEffectEnabled(effectId: string) {
  const [enabled, setEnabledState] = useState(true);

  useLayoutEffect(() => {
    load(STORE_FILE).then(async (store) => {
      const val = await store.get<boolean>(storeKey(effectId));
      if (val !== null && val !== undefined) {
        setEnabledState(val);
      }
    });
  }, [effectId]);

  useEffect(() => {
    const unlisten = listen<boolean>(eventName(effectId), (event) => {
      setEnabledState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [effectId]);

  const setEnabled = async (next: boolean) => {
    setEnabledState(next);
    const store = await load(STORE_FILE);
    await store.set(storeKey(effectId), next);
    await store.save();
    await emit(eventName(effectId), next);
  };

  return { enabled, setEnabled };
}
