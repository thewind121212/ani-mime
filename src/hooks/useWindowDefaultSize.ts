import { useEffect } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

/** The pet window's resting width (sprite is 128 + 32px breathing room). */
export const PET_BASE_WIDTH = 160;
/** Sprite (128) + ~112px slot below for the status pill row. */
export const PET_BASE_HEIGHT = 240;

/** Compute the resting window size at a given display scale. */
export function getDefaultPetSize(scale: number) {
  return {
    width: Math.round(PET_BASE_WIDTH * scale),
    height: Math.round(PET_BASE_HEIGHT * scale),
  };
}

/**
 * Single source of truth for the pet's resting window size.
 *
 * The window is fixed at PET_BASE * scale by default. Each trigger event
 * in App.tsx (bubble, visitors, session list, effect) explicitly grows
 * the window and restores it back to the default on deactivate. When all
 * triggers are inactive `paused` is false and this hook re-fires to snap
 * the window back to its default size.
 */
export function useWindowDefaultSize(scale: number, paused: boolean) {
  useEffect(() => {
    if (paused) return;
    const { width, height } = getDefaultPetSize(scale);
    void getCurrentWindow()
      .setSize(new LogicalSize(width, height))
      .catch(() => {});
  }, [scale, paused]);
}
