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

/**
 * Module-level cache of persisted effect toggles. The first load of each
 * effect id reads from disk and populates this map; every subsequent useState
 * initializer then reads synchronously from it, so reopening Settings no
 * longer flashes the default `true` state before the async disk read returns.
 */
const cache = new Map<string, boolean>();

export function useEffectEnabled(effectId: string) {
  // Initializer function → only runs on first render. Reads from cache if we
  // have it, else falls back to the app-wide default of "on".
  const [enabled, setEnabledState] = useState<boolean>(() =>
    cache.has(effectId) ? cache.get(effectId)! : true,
  );

  useLayoutEffect(() => {
    load(STORE_FILE).then(async (store) => {
      const val = await store.get<boolean>(storeKey(effectId));
      if (val !== null && val !== undefined) {
        cache.set(effectId, val);
        setEnabledState(val);
      } else if (!cache.has(effectId)) {
        // No persisted value yet — lock in the default so later mounts skip
        // the async round-trip.
        cache.set(effectId, true);
      }
    });
  }, [effectId]);

  useEffect(() => {
    const unlisten = listen<boolean>(eventName(effectId), (event) => {
      cache.set(effectId, event.payload);
      setEnabledState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [effectId]);

  const setEnabled = async (next: boolean) => {
    cache.set(effectId, next);
    setEnabledState(next);
    const store = await load(STORE_FILE);
    await store.set(storeKey(effectId), next);
    await store.save();
    await emit(eventName(effectId), next);
  };

  return { enabled, setEnabled };
}
