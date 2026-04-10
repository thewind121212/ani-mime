# Animation & Sprite System

How pixel art sprites are rendered, animated, and extended.

## Sprite Sheet Format

Each animation is a single horizontal PNG strip:

```
┌────────┬────────┬────────┬────────┐
│ Frame 1│ Frame 2│ Frame 3│ Frame 4│  ← Single PNG file
└────────┴────────┴────────┴────────┘
  128px    128px    128px    128px
```

- Each frame is **128x128 pixels**
- Frames are arranged **left-to-right** in a single row
- Total image width = `frames * 128px`
- Image height = `128px`
- Format: PNG with transparency

## Sprite Registry

All sprites are registered in `src/constants/sprites.ts`. Each character has a map of `Status → SpriteConfig`:

```typescript
interface SpriteConfig {
  file: string;   // filename relative to character's sprite folder
  frames: number; // number of frames in the strip
}

// Example: Rottweiler
{
  idle: { file: "Sittiing.png", frames: 8 },
  busy: { file: "RottweilerSniff.png", frames: 31 },
  service: { file: "RottweilerBark.png", frames: 12 },
  disconnected: { file: "SleepDogg.png", frames: 8 },
  searching: { file: "RottweilerIdle.png", frames: 6 },
  initializing: { file: "RottweilerIdle.png", frames: 6 },
  visiting: { file: "Sittiing.png", frames: 8 },
}
```

## CSS Animation Engine

Animation is pure CSS using `steps()` timing function (defined in `src/styles/mascot.css`):

```css
.sprite {
  width: 128px;
  height: 128px;
  background-size: var(--sprite-width) 128px;
  animation: sprite-play var(--sprite-duration) steps(var(--sprite-steps)) infinite;
  image-rendering: pixelated;
}

@keyframes sprite-play {
  from { background-position: 0 0; }
  to   { background-position: calc(-1 * var(--sprite-width)) 0; }
}
```

### CSS Custom Properties (set by React)

| Property | Value | Example |
|----------|-------|---------|
| `--sprite-width` | `frames * 128px` | `992px` (for 8 frames) |
| `--sprite-duration` | `frames * 80ms` | `640ms` (for 8 frames) |
| `--sprite-steps` | `frames` | `8` |

### Frame Timing

- **80ms per frame** (~12.5 FPS) - consistent across all animations
- Total duration = `frames * 80ms`
- Animation loops infinitely unless frozen

## Auto-Freeze Behavior

For idle/disconnected states, the animation freezes on the last frame after 10 seconds to reduce visual noise:

```typescript
// In Mascot.tsx
const FREEZE_DELAY = 10_000; // 10 seconds

useEffect(() => {
  if (autoStopStatuses.has(status)) {
    const timer = setTimeout(() => setFrozen(true), FREEZE_DELAY);
    return () => clearTimeout(timer);
  }
  setFrozen(false);
}, [status]);
```

When frozen:
- Animation is paused
- Background position is set to the last frame: `calc(-1 * (frames - 1) * 128px)`
- `sprite.frozen` CSS class applied

Auto-stop statuses: `idle`, `disconnected` (defined in `autoStopStatuses` set)

## Visitor Dog Sprites

Visiting dogs use a smaller 96x96 viewport with the same sprite sheets:

- Horizontally mirrored: `transform: scaleX(-1)`
- Slide-in animation from right
- Always shows the `idle` sprite regardless of visitor's actual status
- Staggered by index: `right: calc(-110px - var(--visitor-offset))`

## Character/Pet System

Characters are organized by category in `src/constants/sprites.ts`:

```typescript
type MimeCategory = "pet" | "character";

interface PetInfo {
  id: Pet;
  name: string;
  category: MimeCategory;
  preview: string;        // thumbnail for settings UI
  sprites: Record<Status, SpriteConfig>;
}
```

### Current Characters

| ID | Name | Category | Sprite Count |
|----|------|----------|-------------|
| `rottweiler` | Rottweiler | pet | 7 animations |
| `dalmatian` | Dalmatian | pet | 7 animations |
| `samurai` | Samurai | character | 7 animations |
| `hancock` | Hancock | character | 7 animations |

## Adding a New Character

1. **Create sprite PNGs** - one per status, 128px frame height, horizontal strip
2. **Add to assets** - place in `src/assets/sprites/{character_name}/`
3. **Register sprites** - add entry in `src/constants/sprites.ts`:
   ```typescript
   const newCharacterSprites: Record<Status, SpriteConfig> = {
     idle: { file: "CharIdle.png", frames: 8 },
     busy: { file: "CharBusy.png", frames: 12 },
     // ... all 7 statuses
   };
   ```
4. **Add to PetInfo list** - in the `MIMES` array with id, name, category, preview
5. **Update Pet type** - add the new ID to the `Pet` union type in `src/types/status.ts`

No backend changes needed - the pet selection is stored in the frontend Tauri store and the mascot component reads it directly.

## Adding a New Animation State

If you need a new status with its own animation:

1. Add to `Status` type in `src/types/status.ts`
2. Add sprite entry for every character in `src/constants/sprites.ts`
3. Add dot color in `src/styles/status-pill.css`
4. Add label in `StatusPill.tsx`
5. Update `resolve_ui_state()` in `src-tauri/src/state.rs` (set priority)
6. Add to `autoStopStatuses` if the animation should freeze after 10s

## Performance Notes

- CSS `steps()` is GPU-friendly - no JavaScript in the animation loop
- `image-rendering: pixelated` prevents blurry upscaling of pixel art
- `will-change` is not used (not needed for simple background-position animation)
- Sprite sheets are loaded once per status change, cached by the browser
- Auto-freeze reduces CPU usage during long idle periods
