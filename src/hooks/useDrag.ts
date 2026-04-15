import { useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useDrag() {
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback(async (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't start a window drag when interacting with the pill dropdown.
    // Match by data-testid rather than class name per project conventions.
    if ((e.target as HTMLElement).closest('[data-testid="status-pill-wrap"]')) return;
    setDragging(true);
    await getCurrentWindow().startDragging();
    setDragging(false);
  }, []);

  return { dragging, onMouseDown };
}
