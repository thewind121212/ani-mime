import type { EffectDefinition } from "./types";
export type { EffectDefinition, EffectProps } from "./types";
export { useEffectEnabled } from "./useEffectEnabled";
export { EffectOverlay } from "./EffectOverlay";

// --- Registered effects (add new effects here) ---
import { shadowCloneEffect } from "./shadow-clone";

export const effects: EffectDefinition[] = [
  shadowCloneEffect,
];
