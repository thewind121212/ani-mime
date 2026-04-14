import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { readFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { useStatus } from "../hooks/useStatus";
import { usePet } from "../hooks/usePet";
import { useScale } from "../hooks/useScale";
import { useCustomMimes } from "../hooks/useCustomMimes";
import { getSpriteMap } from "../constants/sprites";
import { useEffectEnabled } from "./useEffectEnabled";
import { effects } from "./index";
import type { EffectDefinition } from "./types";

const FRAME_BASE_PX = 128;
const CANDIDATE_FRAME_SIZES = [128, 96, 64, 48, 32, 16];

function inferGrid(w: number, h: number, frames: number) {
  for (const fp of CANDIDATE_FRAME_SIZES) {
    if (w % fp === 0 && h % fp === 0) {
      const cols = w / fp;
      const rows = h / fp;
      if (cols * rows >= frames) return { framePx: fp, cols };
    }
  }
  return { framePx: h, cols: Math.max(1, Math.round(w / Math.max(1, h))) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Flatten a potentially multi-row sprite sheet into a single-row strip.
 * The shadow clone CSS animation shifts background-position-x only,
 * so grids must be converted to horizontal strips.
 */
async function flattenToStrip(blob: Blob, frames: number): Promise<string> {
  const blobUrl = URL.createObjectURL(blob);
  const img = await loadImage(blobUrl);
  const { framePx, cols } = inferGrid(img.naturalWidth, img.naturalHeight, frames);

  // Already a flat strip — use the blob URL directly
  if (cols >= frames) return blobUrl;

  // Flatten grid to horizontal strip via canvas
  const canvas = document.createElement("canvas");
  canvas.width = framePx * frames;
  canvas.height = framePx;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < frames; i++) {
    const srcX = (i % cols) * framePx;
    const srcY = Math.floor(i / cols) * framePx;
    ctx.drawImage(img, srcX, srcY, framePx, framePx, i * framePx, 0, framePx, framePx);
  }
  URL.revokeObjectURL(blobUrl);

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(URL.createObjectURL(b!)), "image/png");
  });
}

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
  const { mimes } = useCustomMimes();

  const [activeEffect, setActiveEffect] = useState<ActiveEffect | null>(null);
  const [windowReady, setWindowReady] = useState(false);
  const prevStatusRef = useRef(status);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedWindowRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const customSpriteUrlRef = useRef<string | null>(null);

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
    if (customSpriteUrlRef.current) {
      URL.revokeObjectURL(customSpriteUrlRef.current);
      customSpriteUrlRef.current = null;
    }
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
    const frameSize = FRAME_BASE_PX * scale;
    let cancelled = false;

    const activate = async () => {
      let spriteUrl: string;
      let frames: number;

      if (isCustom) {
        const customMime = mimes.find((m) => m.id === pet);
        if (!customMime) return;
        const spriteData = customMime.sprites[status] ?? customMime.sprites.searching;
        frames = spriteData.frames;
        const base = await appDataDir();
        const filePath = await join(base, "custom-sprites", spriteData.fileName);
        const bytes = await readFile(filePath);
        if (cancelled) return;
        const blob = new Blob([bytes], { type: "image/png" });
        spriteUrl = await flattenToStrip(blob, frames);
        if (cancelled) {
          URL.revokeObjectURL(spriteUrl);
          return;
        }
        customSpriteUrlRef.current = spriteUrl;
      } else {
        const spriteMap = getSpriteMap(pet);
        const sprite = spriteMap[status];
        spriteUrl = new URL(
          `../assets/sprites/${sprite.file}`,
          import.meta.url
        ).href;
        frames = sprite.frames;
      }

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
        frames,
        frameSize,
      });

      timerRef.current = setTimeout(stopEffect, matchingEffect.duration);
    };

    activate();

    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
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
