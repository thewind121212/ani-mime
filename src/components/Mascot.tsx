import { useState, useEffect, useRef } from "react";
import type { Status } from "../types/status";
import { getSpriteMap, autoStopStatuses } from "../constants/sprites";
import { usePet } from "../hooks/usePet";
import { useGlow } from "../hooks/useGlow";
import "../styles/mascot.css";

interface MascotProps {
  status: Status;
}

export function Mascot({ status }: MascotProps) {
  const { pet } = usePet();
  const { mode: glowMode } = useGlow();
  const [frozen, setFrozen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timerRef.current);
    setFrozen(false);

    if (autoStopStatuses.has(status)) {
      timerRef.current = setTimeout(() => setFrozen(true), 10_000);
    }

    return () => clearTimeout(timerRef.current);
  }, [status]);

  const spriteMap = getSpriteMap(pet);
  const sprite = spriteMap[status] ?? spriteMap.searching;
  const spriteUrl = new URL(
    `../assets/sprites/${sprite.file}`,
    import.meta.url
  ).href;

  const lastFrameOffset = (sprite.frames - 1) * 128;

  return (
    <div
      className={`sprite ${frozen ? "frozen" : ""} ${glowMode !== "off" ? `glow-${glowMode}` : ""}`}
      style={{
        backgroundImage: `url(${spriteUrl})`,
        width: 128,
        height: 128,
        "--sprite-steps": sprite.frames,
        "--sprite-width": `${sprite.frames * 128}px`,
        "--sprite-duration": `${sprite.frames * 80}ms`,
        ...(frozen ? { backgroundPosition: `-${lastFrameOffset}px 0` } : {}),
      } as React.CSSProperties}
    />
  );
}
