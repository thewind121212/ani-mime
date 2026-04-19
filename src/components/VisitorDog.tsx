import { useState, useEffect, useMemo } from "react";
import { getSpriteMap, resolveBuiltinPet, FALLBACK_PET_ID } from "../constants/sprites";
import { useScale } from "../hooks/useScale";
import { warn } from "@tauri-apps/plugin-log";
import "../styles/visitor.css";

interface VisitorDogProps {
  pet: string;
  nickname: string;
  index: number;
}

export function VisitorDog({ pet, nickname, index }: VisitorDogProps) {
  const [entered, setEntered] = useState(false);
  const { scale } = useScale();

  // Resolve the peer's advertised pet against pets we can actually render.
  // Peers can advertise custom-* mime ids that don't exist on this instance;
  // those fall back to the default built-in so something shows up.
  const resolvedPet = useMemo(() => resolveBuiltinPet(pet), [pet]);

  useEffect(() => {
    if (resolvedPet !== pet) {
      warn(
        `[visitor] pet "${pet}" not available locally, falling back to "${resolvedPet}" for visitor "${nickname}"`
      ).catch(() => {});
    }
  }, [pet, resolvedPet, nickname]);

  useEffect(() => {
    requestAnimationFrame(() => setEntered(true));
  }, []);

  const spriteMap = getSpriteMap(resolvedPet);
  const sprite = spriteMap.idle ?? getSpriteMap(FALLBACK_PET_ID).idle;
  const spriteUrl = new URL(
    `../assets/sprites/${sprite.file}`,
    import.meta.url
  ).href;

  const visitorSize = 96 * scale;
  const offset = index * 80 * scale;

  return (
    <div
      data-testid={`visitor-dog-${index}`}
      className={`visitor-dog ${entered ? "entered" : ""}`}
      style={{ "--visitor-offset": `${offset}px` } as React.CSSProperties}
    >
      <div className="visitor-name">{nickname}</div>
      <div
        className="visitor-sprite"
        style={{
          backgroundImage: `url(${spriteUrl})`,
          width: visitorSize,
          height: visitorSize,
          "--sprite-steps": sprite.frames,
          "--sprite-width": `${sprite.frames * visitorSize}px`,
          "--sprite-height": `${visitorSize}px`,
          "--sprite-duration": `${sprite.frames * 80}ms`,
        } as React.CSSProperties}
      />
    </div>
  );
}
