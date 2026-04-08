import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

interface UpdateInfo {
  latest: string;
  current: string;
}

export function useUpdate() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    const unlisten = listen<UpdateInfo>("update-available", (event) => {
      setUpdate(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const dismiss = () => setUpdate(null);

  return { update, dismiss };
}
