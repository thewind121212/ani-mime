import { useState, useEffect, useLayoutEffect, useRef } from "react";
import type { Status } from "../types/status";
import { getSpriteMap, autoStopStatuses } from "../constants/sprites";
import { usePet } from "../hooks/usePet";
import { useGlow } from "../hooks/useGlow";
import { useScale } from "../hooks/useScale";
import { useOpacity } from "../hooks/useOpacity";
import { useCustomMimes } from "../hooks/useCustomMimes";
import { readFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { error as logError } from "@tauri-apps/plugin-log";
import "../styles/mascot.css";

interface MascotProps {
  status: Status;
  onDragStart?: () => void;
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

export function Mascot({ status, onDragStart }: MascotProps) {
  const { pet } = usePet();
  const { mode: glowMode } = useGlow();
  const { scale } = useScale();
  const { opacity } = useOpacity("mime");
  const { mimes } = useCustomMimes();
  const [frozen, setFrozen] = useState(false);
  const [customSpriteUrl, setCustomSpriteUrl] = useState<string | null>(null);
  const [sheetDims, setSheetDims] = useState<{ w: number; h: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const spriteRef = useRef<HTMLDivElement>(null);
  // Per-sprite alpha mask, populated after the sheet decodes. Drag
  // hit-testing reads it so clicks on the transparent halo around the
  // dog don't start a window drag.
  const spriteAlphaRef = useRef<{
    data: Uint8ClampedArray;
    width: number;
    height: number;
  } | null>(null);
  // Frame index updated by the rAF loop below, used by the drag
  // hit-test to read alpha at the right cell of the sheet.
  const currentFrameRef = useRef(0);

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

  // Read sheet dimensions when URL changes (needed to compute grid layout).
  // useLayoutEffect so setSheetDims(null) commits before paint — otherwise
  // the first render after a status change uses the NEW spriteUrl + frames
  // with the OLD sheetDims, which inferGrid turns into a wildly stretched
  // backgroundSize for one frame. Also reset backgroundPosition so the
  // stale offset from the previous status' rAF loop doesn't briefly show
  // an off-grid region of the new sprite.
  //
  // Same effect also caches the alpha channel of the sheet so drag
  // hit-testing in handleMouseDown can skip clicks on transparent
  // pixels around the visible dog.
  useLayoutEffect(() => {
    setSheetDims(null);
    spriteAlphaRef.current = null;
    if (spriteRef.current) spriteRef.current.style.backgroundPosition = "0 0";
    if (!spriteUrl) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setSheetDims({ w: img.naturalWidth, h: img.naturalHeight });
      try {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const id = ctx.getImageData(0, 0, c.width, c.height);
        spriteAlphaRef.current = {
          data: id.data,
          width: id.width,
          height: id.height,
        };
      } catch (err) {
        // CORS/security failure — fall back to no alpha test (drag
        // works on the full sprite frame, same as before).
        logError(`[mascot] alpha cache failed: ${err instanceof Error ? err.message : err}`);
      }
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
      currentFrameRef.current = idx;
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

  // Drag hit-test: only start dragging when the click lands on an
  // opaque pixel of the current frame. The sheet is cached above as
  // ImageData; we map the click from display coords (frameSize px) to
  // source coords (layout.framePx px) and read alpha at that cell.
  // If the alpha cache isn't populated yet, fall back to whole-frame
  // drag so the window stays draggable during the brief decode window.
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const start = onDragStart;
    if (!start) return;
    const alpha = spriteAlphaRef.current;
    if (!alpha || !layout) {
      start();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const xInDisp = e.clientX - rect.left;
    const yInDisp = e.clientY - rect.top;
    if (xInDisp < 0 || yInDisp < 0 || xInDisp >= rect.width || yInDisp >= rect.height) {
      return;
    }
    const ratio = layout.framePx / frameSize;
    const idx = currentFrameRef.current;
    const sx = (idx % layout.cols) * layout.framePx + xInDisp * ratio;
    const sy = Math.floor(idx / layout.cols) * layout.framePx + yInDisp * ratio;
    const px = Math.floor(sx);
    const py = Math.floor(sy);
    if (px < 0 || py < 0 || px >= alpha.width || py >= alpha.height) {
      start();
      return;
    }
    const a = alpha.data[(py * alpha.width + px) * 4 + 3];
    // Threshold of 16 keeps anti-aliased edge pixels grabbable while
    // ignoring the empty halo around the dog.
    if (a < 16) return;
    start();
  };

  if (isCustom && !customSpriteUrl) return null;

  // Display each source cell at frameSize (128 * scale). Background is scaled
  // up from its native frame_px (64 or 128) to that display size.
  const sheetWidth = layout ? layout.cols * frameSize : frames * frameSize;
  const sheetHeight = layout ? layout.rows * frameSize : frameSize;

  return (
    <div
      ref={spriteRef}
      data-testid="mascot-sprite"
      onMouseDown={handleMouseDown}
      className={`sprite ${frozen ? "frozen" : ""} ${glowMode !== "off" ? `glow-${glowMode}` : ""}`}
      style={{
        backgroundImage: `url(${spriteUrl})`,
        width: frameSize,
        height: frameSize,
        backgroundSize: `${sheetWidth}px ${sheetHeight}px`,
        opacity,
      }}
    />
  );
}
