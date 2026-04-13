import type { Status } from "../types/status";

export interface EffectProps {
  spriteUrl: string;
  frames: number;
  frameSize: number;
}

export interface EffectDefinition {
  id: string;
  name: string;
  trigger: Status;
  duration: number;
  expandWindow?: number;
  component: React.ComponentType<EffectProps>;
}
