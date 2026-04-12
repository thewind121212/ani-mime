import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export interface Visitor {
  instance_name: string;
  pet: string;
  nickname: string;
  duration_secs: number;
}

export function useVisitors() {
  const [visitors, setVisitors] = useState<Visitor[]>([]);

  useEffect(() => {
    const unlistenArrived = listen<Visitor>("visitor-arrived", (e) => {
      setVisitors((prev) => [...prev, e.payload]);
    });

    const unlistenLeft = listen<{ instance_name: string; nickname: string }>("visitor-left", (e) => {
      setVisitors((prev) => {
        if (e.payload.instance_name) {
          return prev.filter((v) => v.instance_name !== e.payload.instance_name);
        }
        // Fallback for older peers
        return prev.filter((v) => v.nickname !== e.payload.nickname);
      });
    });

    return () => {
      unlistenArrived.then((fn) => fn());
      unlistenLeft.then((fn) => fn());
    };
  }, []);

  return visitors;
}
