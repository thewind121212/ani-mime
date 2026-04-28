import { useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useDrag() {
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Drag only when the cursor lands on the dog sprite itself (or its
    // visiting-mode placeholder). The speech bubble, status pill, and
    // surrounding padding are NOT drag handles — clicking the bubble
    // dismisses it, and empty space shouldn't grab the window.
    const onSprite =
      target.closest('[data-testid="mascot-sprite"]') ||
      target.closest('[data-testid="mascot-placeholder"]');
    if (!onSprite) return;
    setDragging(true);
    await getCurrentWindow().startDragging();
    setDragging(false);
  }, []);

  return { dragging, onMouseDown };
}
