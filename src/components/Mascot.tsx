import { useState, useEffect, useRef } from "react";
import type { Status } from "../types/status";
import { getSpriteMap, autoStopStatuses } from "../constants/sprites";
import { usePet } from "../hooks/usePet";
import { useGlow } from "../hooks/useGlow";
import { useScale } from "../hooks/useScale";
import { useCustomMimes } from "../hooks/useCustomMimes";
import { readFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { error as logError } from "@tauri-apps/plugin-log";
import "../styles/mascot.css";

interface MascotProps {
  status: Status;
}

const FRAME_BASE_PX = 128;
const FRAME_DURATION_MS = 80;
const CANDIDATE_FRAME_SIZES = [128, 96, 64, 48, 32, 16];

/** Infer the source frame size + grid layout from sheet dims and frame count.
 * Built-in pets use 64px cells in flat strips; custom mimes use 128px in grids
 * up to 4096px wide. Picks the largest frame size that divides both axes
 * cleanly and gives enough cells for `frames`. */
function inferGrid(w: number, h: number, frames: number) {
  for (const fp of CANDIDATE_FRAME_SIZES) {
    if (w % fp === 0 && h % fp === 0) {
      const cols = w / fp;
      const rows = h / fp;
      if (cols * rows >= frames) return { framePx: fp, cols, rows };
    }
  }
  // Fallback: treat as a flat strip
  return { framePx: h, cols: Math.max(1, Math.round(w / Math.max(1, h))), rows: 1 };
}

export function Mascot({ status }: MascotProps) {
  const { pet } = usePet();
  const { mode: glowMode } = useGlow();
  const { scale } = useScale();
  const { mimes } = useCustomMimes();
  const [frozen, setFrozen] = useState(false);
  const [customSpriteUrl, setCustomSpriteUrl] = useState<string | null>(null);
  const [sheetDims, setSheetDims] = useState<{ w: number; h: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const spriteRef = useRef<HTMLDivElement>(null);

  const isCustom = pet.startsWith("custom-");
  const customMime = isCustom ? mimes.find((m) => m.id === pet) : null;

  useEffect(() => {
    clearTimeout(timerRef.current);
    setFrozen(false);

    if (autoStopStatuses.has(status)) {
      timerRef.current = setTimeout(() => setFrozen(true), 10_000);
    }

    return () => clearTimeout(timerRef.current);
  }, [status]);

  // Resolve custom sprite URL by reading file bytes via FS plugin
  useEffect(() => {
    if (!customMime) {
      setCustomSpriteUrl(null);
      return;
    }
    let revoked = false;
    let objectUrl: string | null = null;
    const spriteData = customMime.sprites[status] ?? customMime.sprites.searching;
    appDataDir().then(async (base) => {
      try {
        const filePath = await join(base, "custom-sprites", spriteData.fileName);
        const bytes = await readFile(filePath);
        if (revoked) return;
        const blob = new Blob([bytes], { type: "image/png" });
        const url = URL.createObjectURL(blob);
        objectUrl = url;
        setCustomSpriteUrl(url);
      } catch (err) {
        logError(`[mascot] failed to load sprite ${spriteData.fileName}: ${err instanceof Error ? err.message : err}`);
      }
    });
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [customMime, status]);

  let spriteUrl: string;
  let frames: number;

  if (isCustom && customMime) {
    const spriteData = customMime.sprites[status] ?? customMime.sprites.searching;
    frames = spriteData.frames;
    spriteUrl = customSpriteUrl ?? "";
  } else {
    const spriteMap = getSpriteMap(pet);
    const sprite = spriteMap[status] ?? spriteMap.searching;
    frames = sprite.frames;
    spriteUrl = new URL(
      `../assets/sprites/${sprite.file}`,
      import.meta.url
    ).href;
  }

  const frameSize = FRAME_BASE_PX * scale;

  // Read sheet dimensions when URL changes (needed to compute grid layout)
  useEffect(() => {
    setSheetDims(null);
    if (!spriteUrl) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setSheetDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = spriteUrl;
    return () => { cancelled = true; };
  }, [spriteUrl]);

  // Drive frame animation via rAF; supports 1×N strips and M×N grids,
  // and any source frame size (built-ins are 64px, custom packer uses 128px).
  // Using JS instead of CSS steps() avoids the WebKit ~8192px texture limit.
  const layout = sheetDims ? inferGrid(sheetDims.w, sheetDims.h, frames) : null;

  useEffect(() => {
    const el = spriteRef.current;
    if (!el || !layout || frames < 1) return;

    const { cols } = layout;
    const lastIdx = Math.max(0, frames - 1);

    const setPos = (idx: number) => {
      const sx = (idx % cols) * frameSize;
      const sy = Math.floor(idx / cols) * frameSize;
      el.style.backgroundPosition = `-${sx}px -${sy}px`;
    };

    if (frozen) {
      setPos(lastIdx);
      return;
    }

    let raf = 0, frame = 0, last = performance.now();
    setPos(0);
    const tick = (t: number) => {
      if (t - last >= FRAME_DURATION_MS) {
        frame = (frame + 1) % frames;
        setPos(frame);
        last = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [layout, frames, frameSize, frozen]);

  if (isCustom && !customSpriteUrl) return null;

  // Display each source cell at frameSize (128 * scale). Background is scaled
  // up from its native frame_px (64 or 128) to that display size.
  const sheetWidth = layout ? layout.cols * frameSize : frames * frameSize;
  const sheetHeight = layout ? layout.rows * frameSize : frameSize;

  return (
    <div
      ref={spriteRef}
      data-testid="mascot-sprite"
      className={`sprite ${frozen ? "frozen" : ""} ${glowMode !== "off" ? `glow-${glowMode}` : ""}`}
      style={{
        backgroundImage: `url(${spriteUrl})`,
        width: frameSize,
        height: frameSize,
        backgroundSize: `${sheetWidth}px ${sheetHeight}px`,
      }}
    />
  );
}
