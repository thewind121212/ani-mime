import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const STORE_KEY = "collapsedSessionGroups";
const EVENT = "collapsed-session-groups-changed";

export function useCollapsedSessionGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  useLayoutEffect(() => {
    load("settings.json").then(async (store) => {
      const raw = await store.get<string[]>(STORE_KEY);
      if (Array.isArray(raw)) setCollapsed(new Set(raw));
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<string[]>(EVENT, (event) => {
      setCollapsed(new Set(event.payload ?? []));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const toggle = useCallback(async (key: string) => {
    const store = await load("settings.json");
    const current = (await store.get<string[]>(STORE_KEY)) ?? [];
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    const arr = Array.from(next);
    await store.set(STORE_KEY, arr);
    await store.save();
    setCollapsed(next);
    await emit(EVENT, arr);
  }, []);

  return { collapsed, toggle };
}
