export type Status =
  | "initializing"
  | "searching"
  | "idle"
  | "busy"
  | "service"
  | "disconnected";

export interface SpriteConfig {
  file: string;
  frames: number;
}
