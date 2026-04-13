import type { EffectDefinition } from "../types";
import { ShadowCloneEffect } from "./ShadowCloneEffect";

export const shadowCloneEffect: EffectDefinition = {
  id: "shadow-clone",
  name: "Shadow Clone",
  trigger: "busy",
  duration: 2000,
  expandWindow: 1200,
  component: ShadowCloneEffect,
};
