import { useEffect, useRef, useState } from "react";
import "../styles/settings.css";

interface AnimationPreviewProps {
  /** Object URL or data URL of the sprite sheet */
  spriteUrl: string;
  /** Number of frames in the sheet */
  frames: number;
  /** Label shown in the header */
  label: string;
  /** Close callback */
  onClose: () => void;
}

const FRAME_DURATION_MS = 100; // slightly slower than mascot for easier viewing
const CANDIDATE_FRAME_SIZES = [128, 96, 64, 48, 32, 16];

function inferGrid(w: number, h: number, frames: number) {
  for (const fp of CANDIDATE_FRAME_SIZES) {
    if (w % fp === 0 && h % fp === 0) {
      const cols = w / fp;
      const rows = h / fp;
      if (cols * rows >= frames) return { framePx: fp, cols, rows };
    }
  }
  return { framePx: h, cols: Math.max(1, Math.round(w / Math.max(1, h))), rows: 1 };
}

/**
 * Mini popup overlay that plays a sprite-sheet animation. Drives frames via
 * rAF and reads the source sheet's dimensions to handle both flat strips and
 * 2D grids — same approach as the Mascot component.
 */
export function AnimationPreview({ spriteUrl, frames, label, onClose }: AnimationPreviewProps) {
  const size = 96;
  const spriteRef = useRef<HTMLDivElement>(null);
  const [sheetDims, setSheetDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

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

  const layout = sheetDims ? inferGrid(sheetDims.w, sheetDims.h, frames) : null;

  useEffect(() => {
    const el = spriteRef.current;
    if (!el || !layout || frames < 1) return;
    const { cols } = layout;
    let raf = 0, frame = 0, last = performance.now();
    const setPos = (idx: number) => {
      const sx = (idx % cols) * size;
      const sy = Math.floor(idx / cols) * size;
      el.style.backgroundPosition = `-${sx}px -${sy}px`;
    };
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
  }, [layout, frames, size]);

  const sheetWidth = layout ? layout.cols * size : frames * size;
  const sheetHeight = layout ? layout.rows * size : size;

  return (
    <div className="anim-preview-overlay" onClick={onClose} data-testid="animation-preview">
      <div className="anim-preview-popup" onClick={(e) => e.stopPropagation()}>
        <div className="anim-preview-header">
          <span>{label}</span>
          <span className="anim-preview-meta">{frames} frame{frames !== 1 ? "s" : ""}</span>
          <button className="anim-preview-close" onClick={onClose} aria-label="Close preview" data-testid="anim-preview-close">x</button>
        </div>
        <div className="anim-preview-body">
          <div
            ref={spriteRef}
            data-testid="anim-preview-sprite"
            className="anim-preview-sprite"
            style={{
              backgroundImage: `url(${spriteUrl})`,
              width: size,
              height: size,
              backgroundSize: `${sheetWidth}px ${sheetHeight}px`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
