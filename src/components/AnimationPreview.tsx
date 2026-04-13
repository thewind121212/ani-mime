import { useEffect } from "react";
import "../styles/settings.css";

interface AnimationPreviewProps {
  /** Object URL or data URL of the sprite strip */
  spriteUrl: string;
  /** Number of frames in the strip */
  frames: number;
  /** Label shown in the header */
  label: string;
  /** Close callback */
  onClose: () => void;
}

/**
 * Mini popup overlay that plays a sprite-strip animation,
 * using the same CSS stepping technique as the Mascot component.
 */
export function AnimationPreview({ spriteUrl, frames, label, onClose }: AnimationPreviewProps) {
  const size = 96;
  const duration = frames * 100; // slightly slower than mascot for easier viewing

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

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
            data-testid="anim-preview-sprite"
            className="anim-preview-sprite"
            style={{
              backgroundImage: `url(${spriteUrl})`,
              width: size,
              height: size,
              "--sprite-steps": frames,
              "--sprite-width": `${frames * size}px`,
              "--sprite-height": `${size}px`,
              "--sprite-duration": `${duration}ms`,
            } as React.CSSProperties}
          />
        </div>
      </div>
    </div>
  );
}
