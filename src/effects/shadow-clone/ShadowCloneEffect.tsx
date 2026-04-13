import { useMemo } from "react";
import type { EffectProps } from "../types";
import "./shadow-clone.css";

const TOTAL_EFFECT_MS = 2000;

interface CloneData {
  id: string;
  targetX: number;
  targetY: number;
  rotation: number;
  delay: number;
  duration: number;
}

function generateClones(count: number): CloneData[] {
  return Array.from({ length: count }, (_, i): CloneData => {
    const angle = Math.random() * 2 * Math.PI;
    const distance = 150 + Math.random() * 150;
    const delay = i * 20;
    return {
      id: `clone-${i}`,
      targetX: Math.cos(angle) * distance,
      targetY: Math.sin(angle) * distance,
      rotation: -20 + Math.random() * 40,
      delay,
      duration: TOTAL_EFFECT_MS - delay,
    };
  });
}

export function ShadowCloneEffect({
  spriteUrl,
  frames,
  frameSize,
}: EffectProps) {
  const clones = useMemo(() => generateClones(50), []);

  return (
    <div className="shadow-clone-container" data-testid="shadow-clone-effect">
      <div className="shadow-clone-origin">
        {clones.map((clone) => (
          <div
            key={clone.id}
            className="shadow-clone-wrapper"
            style={
              {
                "--clone-x": `${clone.targetX}px`,
                "--clone-y": `${clone.targetY}px`,
                "--clone-rotation": `${clone.rotation}deg`,
                "--clone-delay": `${clone.delay}ms`,
                "--clone-duration": `${clone.duration}ms`,
              } as React.CSSProperties
            }
          >
            <div
              className="shadow-clone-sprite"
              style={{
                backgroundImage: `url(${spriteUrl})`,
                width: frameSize,
                height: frameSize,
                backgroundSize: `${frames * frameSize}px ${frameSize}px`,
                "--clone-sprite-steps": frames,
                "--clone-sprite-width": `${frames * frameSize}px`,
                "--clone-sprite-duration": `${frames * 80}ms`,
              } as React.CSSProperties}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
