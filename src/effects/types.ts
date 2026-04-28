import type { Status } from "../types/status";

export interface EffectProps {
  spriteUrl: string;
  frames: number;
  frameSize: number;
  /** Dog center X within the (expanded) window, in CSS px. */
  anchorX: number;
  /** Dog center Y within the (expanded) window, in CSS px. */
  anchorY: number;
}

export interface EffectDefinition {
  id: string;
  name: string;
  trigger: Status;
  duration: number;
  expandWindow?: number;
  component: React.ComponentType<EffectProps>;
}
