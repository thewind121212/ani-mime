import { useState, useLayoutEffect, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

const STORE_FILE = "settings.json";
const STORE_KEY = "nickname";

export function useNickname() {
  const [nickname, setNicknameState] = useState("");
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    load(STORE_FILE).then((store) => {
      store.get<string>(STORE_KEY).then((saved) => {
        setNicknameState(saved ?? "");
        setLoaded(true);
      });
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("nickname-changed", (event) => {
      setNicknameState(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const setNickname = async (next: string) => {
    setNicknameState(next);
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, next);
    await store.save();
    await emit("nickname-changed", next);
  };

  return { nickname, setNickname, loaded };
}
