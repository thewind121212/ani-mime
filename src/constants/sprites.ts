import type { SpriteConfig, Status } from "../types/status";

export const spriteMap: Record<Status, SpriteConfig> = {
  disconnected: { file: "SleepDogg.png", frames: 8 },
  busy: { file: "RottweilerSniff.png", frames: 31 },
  service: { file: "RottweilerBark.png", frames: 12 },
  idle: { file: "Sittiing.png", frames: 8 },
  searching: { file: "RottweilerIdle.png", frames: 6 },
  initializing: { file: "RottweilerIdle.png", frames: 6 },
};

export const autoStopStatuses = new Set<Status>(["idle", "disconnected"]);
