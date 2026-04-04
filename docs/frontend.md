# Frontend Architecture

The React frontend is a lightweight UI layer. It receives status events from the Rust backend and renders the appropriate mascot animation and status pill.

## Component Tree

```
<App>                         # Root: layout + drag handling
  <Mascot />                  # Sprite sheet animation
  <StatusPill />              # Status dot + label
</App>
```

## Module Overview

```
src/
├── main.tsx                  # ReactDOM entry point
├── App.tsx                   # Root component (composition + drag)
├── components/
│   ├── Mascot.tsx            # Sprite animation with auto-freeze
│   └── StatusPill.tsx        # Colored dot + status label
├── hooks/
│   └── useStatus.ts          # Listen to Tauri "status-changed" events
├── constants/
│   └── sprites.ts            # Sprite file map + frame counts
├── types/
│   └── status.ts             # Status type definition
└── styles/
    ├── app.css               # Global styles, container, drag cursor
    ├── mascot.css             # Sprite animation keyframes
    └── status-pill.css        # Pill, dot colors, pulse animation
```

## Components

### `App.tsx` — Root Component

Responsibilities:
- Compose `Mascot` and `StatusPill`
- Handle drag-to-move (via `getCurrentWindow().startDragging()`)
- Provide layout container

```tsx
function App() {
  const status = useStatus();
  const { dragging, onMouseDown } = useDrag();

  return (
    <div className={`container ${dragging ? "dragging" : ""}`} onMouseDown={onMouseDown}>
      <Mascot status={status} />
      <StatusPill status={status} />
    </div>
  );
}
```

### `Mascot.tsx` — Sprite Animation

Responsibilities:
- Look up sprite config from status
- Render CSS sprite sheet animation
- Auto-freeze animation after 10s for idle/disconnected states

Props: `{ status: Status }`

Uses CSS custom properties to drive animation:
- `--sprite-steps`: Number of frames
- `--sprite-width`: Total sprite sheet width
- `--sprite-duration`: Animation duration (frames x 80ms)

### `StatusPill.tsx` — Status Indicator

Responsibilities:
- Render colored dot with appropriate CSS class
- Show human-readable label

Props: `{ status: Status }`

Status → Label mapping:
| Status | Label | Dot Color |
|--------|-------|-----------|
| initializing | Initializing... | Orange pulse |
| searching | Searching... | Yellow pulse |
| busy | Working... | Red pulse |
| service | Service | Blue steady |
| idle | Free | Green steady |
| disconnected | Sleep | Gray |

## Hooks

### `useStatus()` — Status Event Listener

Subscribes to Tauri `"status-changed"` event. Returns current `Status`.

- Initial state: `"initializing"`
- Validates payload is a known status string before updating
- Cleans up listener on unmount

## Constants

### `sprites.ts` — Sprite Configuration

Maps each status to its sprite file and frame count:

```ts
export const spriteMap: Record<Status, SpriteConfig> = {
  disconnected: { file: "SleepDogg.png", frames: 8 },
  busy:         { file: "RottweilerSniff.png", frames: 31 },
  service:      { file: "RottweilerBark.png", frames: 12 },
  idle:         { file: "Sittiing.png", frames: 8 },
  searching:    { file: "RottweilerIdle.png", frames: 6 },
  initializing: { file: "RottweilerIdle.png", frames: 6 },
};
```

Sprite sheets are horizontal strips of 128x128 frames located in `src/assets/sprites/`.

## Types

### `status.ts` — Shared Types

```ts
export type Status = "initializing" | "searching" | "idle" | "busy" | "service" | "disconnected";

export interface SpriteConfig {
  file: string;
  frames: number;
}
```

## Styling

CSS is split by concern:

- **`app.css`**: Global reset, `#root` layout, `.container` flex + cursor
- **`mascot.css`**: `.sprite` animation keyframes, `.frozen` state, pixel rendering
- **`status-pill.css`**: `.pill` glassmorphism, `.dot` colors/animations, `.label` typography

## Adding New Features

### New status type
1. Add to `Status` union in `types/status.ts`
2. Add sprite config in `constants/sprites.ts`
3. Add dot color in `styles/status-pill.css`
4. Add label in `StatusPill.tsx`
5. Add to validation list in `useStatus.ts`

### New mascot/skin
1. Add sprite sheet PNG to `src/assets/sprites/`
2. Update `sprites.ts` with file name and frame count
3. (Future) Allow user to select skin via preferences

### New UI element
1. Create component in `components/`
2. Add styles in `styles/`
3. Compose in `App.tsx`
