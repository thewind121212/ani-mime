import { useState, useEffect, useMemo } from "react";
import { getSpriteMap, resolveBuiltinPet, FALLBACK_PET_ID } from "../constants/sprites";
import { randomGreeting } from "../constants/visitorGreetings";
import { useScale } from "../hooks/useScale";
import { warn } from "@tauri-apps/plugin-log";
import "../styles/visitor.css";

/** How long the arrival greeting bubble stays visible. */
const GREETING_DURATION_MS = 5000;

interface VisitorDogProps {
  pet: string;
  nickname: string;
  index: number;
  /** Optional chat message from the sender. When present, replaces the
   *  random greeting and stays visible the whole visit. */
  message?: string;
}

export function VisitorDog({ pet, nickname, message, index }: VisitorDogProps) {
  const [entered, setEntered] = useState(false);
  // If the sender attached a message, show that verbatim and keep it
  // visible for the full visit. Otherwise pick a random greeting and
  // auto-hide it after GREETING_DURATION_MS.
  const hasMessage = !!message;
  const greeting = useMemo(
    () => message ?? randomGreeting(),
    [message]
  );
  const [greetingVisible, setGreetingVisible] = useState(true);
  const { scale } = useScale();

  useEffect(() => {
    if (hasMessage) return; // messages stay visible for the whole visit
    const id = setTimeout(() => setGreetingVisible(false), GREETING_DURATION_MS);
    return () => clearTimeout(id);
  }, [hasMessage]);

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
      {greetingVisible && (
        <div
          className={`visitor-greeting ${hasMessage ? "is-message" : ""}`}
          data-testid={`visitor-greeting-${index}`}
          onClick={() => setGreetingVisible(false)}
          title="Click to dismiss"
        >
          <span className="visitor-greeting-text">{greeting}</span>
          <span className="visitor-greeting-tail" aria-hidden="true" />
        </div>
      )}
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
      <div className="visitor-name">{nickname}</div>
    </div>
  );
}
