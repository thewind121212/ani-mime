import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { useStatus } from "../hooks/useStatus";
import { usePet } from "../hooks/usePet";
import { useScale } from "../hooks/useScale";
import { getSpriteMap } from "../constants/sprites";
import { useEffectEnabled } from "./useEffectEnabled";
import { effects } from "./index";
import type { EffectDefinition } from "./types";

interface EffectOverlayProps {
  onActiveChange?: (active: boolean) => void;
}

interface ActiveEffect {
  definition: EffectDefinition;
  spriteUrl: string;
  frames: number;
  frameSize: number;
}

/** Pin #root content to its current position so window resize doesn't shift it. */
function pinRootContent() {
  const root = document.getElementById("root");
  if (!root) return;
  const container = root.firstElementChild as HTMLElement | null;
  if (!container) return;

  const rootRect = root.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const offsetX = containerRect.left - rootRect.left;
  const offsetY = containerRect.top - rootRect.top;

  root.style.alignItems = "flex-start";
  root.style.justifyContent = "flex-start";
  root.style.paddingLeft = `${offsetX}px`;
  root.style.paddingTop = `${offsetY}px`;
}

/** Restore #root to its default centered layout. */
function unpinRootContent() {
  const root = document.getElementById("root");
  if (!root) return;
  root.style.alignItems = "";
  root.style.justifyContent = "";
  root.style.paddingLeft = "";
  root.style.paddingTop = "";
}

export function EffectOverlay({ onActiveChange }: EffectOverlayProps) {
  const { status } = useStatus();
  const { pet } = usePet();
  const { scale } = useScale();

  const [activeEffect, setActiveEffect] = useState<ActiveEffect | null>(null);
  const [windowReady, setWindowReady] = useState(false);
  const prevStatusRef = useRef(status);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedWindowRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const expandWindow = useCallback(async (size: number) => {
    try {
      const win = getCurrentWindow();
      const factor = await win.scaleFactor();
      const physPos = await win.outerPosition();
      const physSize = await win.outerSize();

      const logX = physPos.x / factor;
      const logY = physPos.y / factor;
      const logW = physSize.width / factor;
      const logH = physSize.height / factor;

      savedWindowRef.current = { x: logX, y: logY, w: logW, h: logH };

      // Pin content position BEFORE resizing to prevent centering shift
      pinRootContent();

      const shiftX = (size - logW) / 2;
      const shiftY = (size - logH) / 2;

      await win.setShadow(false);
      await Promise.all([
        win.setPosition(new LogicalPosition(logX - shiftX, logY - shiftY)),
        win.setSize(new LogicalSize(size, size)),
      ]);

      // Re-center content now that window is at final size
      unpinRootContent();
      setWindowReady(true);
    } catch (err) {
      console.error("[effects] expand error:", err);
      unpinRootContent();
      setWindowReady(true);
    }
  }, []);

  const restoreWindow = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      if (savedWindowRef.current) {
        const { x, y, w, h } = savedWindowRef.current;

        pinRootContent();
        await Promise.all([
          win.setPosition(new LogicalPosition(x, y)),
          win.setSize(new LogicalSize(w, h)),
        ]);
        unpinRootContent();
        // await win.setShadow(true);
        savedWindowRef.current = null;
      }
    } catch (err) {
      console.error("[effects] restore error:", err);
      unpinRootContent();
    }
  }, []);

  const stopEffect = useCallback(() => {
    clearTimeout(timerRef.current);
    setActiveEffect(null);
    setWindowReady(false);
    onActiveChange?.(false);
    restoreWindow();
  }, [onActiveChange, restoreWindow]);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (activeEffect && status !== activeEffect.definition.trigger) {
      stopEffect();
      return;
    }

    if (prevStatus === status) return;

    const matchingEffect = effects.find((e) => e.trigger === status);
    if (!matchingEffect) return;

    const isCustom = pet.startsWith("custom-");
    if (isCustom) return;

    const spriteMap = getSpriteMap(pet);
    const sprite = spriteMap[status];
    const spriteUrl = new URL(
      `../assets/sprites/${sprite.file}`,
      import.meta.url
    ).href;
    const frameSize = 128 * scale;

    // Pause auto-size BEFORE rendering the effect
    onActiveChange?.(true);

    // Expand window (pinning prevents content shift)
    if (matchingEffect.expandWindow) {
      expandWindow(matchingEffect.expandWindow);
    } else {
      setWindowReady(true);
    }

    setActiveEffect({
      definition: matchingEffect,
      spriteUrl,
      frames: sprite.frames,
      frameSize,
    });

    timerRef.current = setTimeout(stopEffect, matchingEffect.duration);

    return () => clearTimeout(timerRef.current);
  }, [status]);

  if (!activeEffect || !windowReady) return null;

  return (
    <EffectRunner effect={activeEffect} onDisabled={stopEffect} />
  );
}

interface EffectRunnerProps {
  effect: ActiveEffect;
  onDisabled: () => void;
}

function EffectRunner({ effect, onDisabled }: EffectRunnerProps) {
  const { enabled } = useEffectEnabled(effect.definition.id);

  useEffect(() => {
    if (!enabled) onDisabled();
  }, [enabled]);

  if (!enabled) return null;

  const Component = effect.definition.component;
  return (
    <Component
      spriteUrl={effect.spriteUrl}
      frames={effect.frames}
      frameSize={effect.frameSize}
    />
  );
}
