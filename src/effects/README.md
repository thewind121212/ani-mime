# Effects System

Plug-and-play visual effects that trigger on status transitions.

## Adding a New Effect

### 1. Create the effect folder

```
src/effects/my-effect/
  index.ts
  MyEffect.tsx
  my-effect.css
```

### 2. Create the visual component

`MyEffect.tsx` receives `EffectProps` and renders the animation:

```tsx
import type { EffectProps } from "../types";
import "./my-effect.css";

export function MyEffect({ spriteUrl, frames, frameSize }: EffectProps) {
  return (
    <div className="my-effect-container">
      {/* Your animation here */}
    </div>
  );
}
```

**Props provided automatically:**
| Prop | Type | Description |
|------|------|-------------|
| `spriteUrl` | `string` | URL of the sprite sheet for the trigger status |
| `frames` | `number` | Number of frames in the sprite sheet |
| `frameSize` | `number` | Pixel size of each frame (128 * scale) |

### 3. Define the effect

`index.ts` exports an `EffectDefinition`:

```ts
import type { EffectDefinition } from "../types";
import { MyEffect } from "./MyEffect";

export const myEffect: EffectDefinition = {
  id: "my-effect",        // Unique ID (used as settings key)
  name: "My Effect",      // Display name in Settings
  trigger: "busy",        // Status that triggers this effect
  duration: 2000,         // How long the effect plays (ms)
  expandWindow: 1200,     // Optional: expand window to this size (px)
  component: MyEffect,
};
```

**`trigger`** — which status transition activates the effect. One of: `"busy"`, `"idle"`, `"service"`, `"disconnected"`, `"searching"`, `"initializing"`, `"visiting"`.

**`expandWindow`** — if set, the window temporarily expands to this square size to give the effect room. Omit if the effect fits within the normal window.

**`duration`** — the effect auto-dismisses after this many milliseconds. The window restores to its original size/position when the effect ends.

### 4. Register it

Add one line to `src/effects/index.ts`:

```ts
import { myEffect } from "./my-effect";

export const effects: EffectDefinition[] = [
  shadowCloneEffect,
  myEffect,             // <-- add here
];
```

That's it. The effect now:
- Triggers automatically on the matching status transition
- Has an on/off toggle in Settings > Appearance
- Expands/restores the window if `expandWindow` is set
- Settings persist across restarts

## Architecture

```
EffectOverlay (App.tsx)
  ├── Detects status transitions
  ├── Finds matching effect from registry
  ├── Expands window if needed
  └── EffectRunner
        ├── Checks if effect is enabled (settings)
        ├── Renders effect component
        └── Auto-dismisses after duration
```

## Files

| File | Purpose |
|------|---------|
| `types.ts` | `EffectDefinition` and `EffectProps` interfaces |
| `index.ts` | Effect registry — add new effects here |
| `useEffectEnabled.ts` | Generic hook for per-effect on/off setting |
| `EffectOverlay.tsx` | Orchestrator: status detection, window management, rendering |
