import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface PeerInfo {
  instance_name: string;
  nickname: string;
  pet: string;
  ip: string;
  port: number;
}

export function usePeers() {
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    // `peers-changed` only fires on add/expire — seed initial state from
    // the backend so the count shows up after reload/HMR without waiting
    // for a peer join or leave.
    invoke<PeerInfo[]>("get_peers").then((list) => {
      if (!cancelled) setPeers(list);
    });

    const unlisten = listen<PeerInfo[]>("peers-changed", (e) => {
      setPeers(e.payload);
    });

    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  return peers;
}
