import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export interface InstallPromptPayload {
  id: string;
  name: string;
  creator: string | null;
  size_bytes: number;
  preview_url: string;
  download_url: string;
}

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<InstallPromptPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unlistenPromptRef = useRef<(() => void) | null>(null);
  const unlistenErrorRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let unmounted = false;

    listen<InstallPromptPayload>("install-prompt", (e) => {
      setError(null);
      setPrompt(e.payload);
    }).then((fn) => {
      if (unmounted) {
        fn();
      } else {
        unlistenPromptRef.current = fn;
      }
    });

    listen<string>("install-error", (e) => {
      setPrompt(null);
      setError(e.payload);
    }).then((fn) => {
      if (unmounted) {
        fn();
      } else {
        unlistenErrorRef.current = fn;
      }
    });

    return () => {
      unmounted = true;
      unlistenPromptRef.current?.();
      unlistenPromptRef.current = null;
      unlistenErrorRef.current?.();
      unlistenErrorRef.current = null;
    };
  }, []);

  const clear = useCallback(() => {
    setPrompt(null);
    setError(null);
  }, []);

  return { prompt, error, clear };
}
