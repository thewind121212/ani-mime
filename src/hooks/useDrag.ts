import { useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useDrag() {
  const [dragging, setDragging] = useState(false);

  // Imperative starter — Mascot calls this after alpha-testing the click
  // against opaque sprite pixels, and the placeholder branch below uses
  // it for visiting-mode (no sprite to alpha-test).
  const start = useCallback(async () => {
    setDragging(true);
    await getCurrentWindow().startDragging();
    setDragging(false);
  }, []);

  // Container-level handler covers the visiting-mode placeholder only.
  // Sprite drag is alpha-tested inside Mascot, so clicks on the
  // transparent halo around the dog don't grab the window.
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!target.closest('[data-testid="mascot-placeholder"]')) return;
      void start();
    },
    [start]
  );

  return { dragging, onMouseDown, start };
}
