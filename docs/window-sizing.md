# Window Sizing & Bounds

The Ani-Mime main pet window has a **fixed default size** (`PET_BASE_WIDTH × PET_BASE_HEIGHT`, scaled by the user's display-size preference). Each named "trigger" — speech bubble, visitors, session list, shadow-clone effect — explicitly grows the window away from the default and restores it on deactivate. This doc is the reference for that pipeline. **Read it before touching any `setSize`/`setPosition` call**, the `useWindowDefaultSize` hook, or any CSS that touches `.container` dimensions.

> **History:** this used to be a content-driven `useWindowAutoSize` (window tracked `container.offsetWidth/Height`). It was replaced because (a) bubble extras inflated the container which made the sprite visually drift, and (b) the dynamic content size was unpredictable across triggers. The architecture was flipped: container is now fixed, and triggers explicitly size the window. If you find lingering references to the old approach (e.g. `bubbleExtra` state, CSS `--bubble-extra-*` vars), they're dead code — remove them.

## Default size

`PET_BASE_WIDTH × PET_BASE_HEIGHT` — currently **160 × 240** at scale 1.

| Where | Value |
|---|---|
| `src/hooks/useWindowDefaultSize.ts` → `PET_BASE_WIDTH` | `160` |
| `src/hooks/useWindowDefaultSize.ts` → `PET_BASE_HEIGHT` | `240` |
| `src-tauri/tauri.conf.json` main window | `width: 160, height: 240` (matches default so the first frame paints correctly) |
| `src/styles/app.css` → `.container` | `min-width: 160px; min-height: 240px` (matches default; container fills the window when no trigger is active) |
| `src/App.tsx` inline style on `.container` | `minWidth/minHeight` reference `PET_BASE_*` — keep in sync |

When all triggers are inactive, **`useWindowDefaultSize`** sets the window to `PET_BASE × scale` and the container fills it.

## Mechanics

```
┌─ Tauri window (size set explicitly per trigger) ─────────────┐
│ #root (100% × 100%, flex)                                    │
│   ┌─ .container (FIXED min 160 × 240) ─────────────────────┐ │
│   │                                                         │ │
│   │   .main-col      .visitors-col (only when visiting)    │ │
│   │                                                         │ │
│   └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

The container is **intentionally fixed-size**. Any window expansion happens at the Tauri-window level; the container does not grow. The bubble lives `position: absolute` inside `.mascot-wrap` and may visually extend past the container edge — the surrounding (grown) Tauri window provides the room.

### `useWindowDefaultSize`

`src/hooks/useWindowDefaultSize.ts`

```ts
export function useWindowDefaultSize(scale: number, paused: boolean) {
  useEffect(() => {
    if (paused) return;
    const { width, height } = getDefaultPetSize(scale);
    void getCurrentWindow().setSize(new LogicalSize(width, height)).catch(() => {});
  }, [scale, paused]);
}
```

Called from `App.tsx` with `paused = effectActive || sessionOpen || sessionClosing || bubbleGrowActive || visitors.length > 0`. When `paused` flips false (all triggers gone), the hook re-fires and snaps the window back to `PET_BASE × scale`.

## Triggers (the five "owners")

Only one is active at a time. All non-default owners follow the same shape:

```
                ┌── DEFAULT ────────┐
                │  no other trigger │
                │  active           │
                │                   │
                │  PET_BASE × scale │
                │  via useWindowDefaultSize
                └───────────────────┘
                         │
                         │ trigger fires (any of):
                         ▼
        ┌────────────────┬────────────────┬────────────────┬────────────────┐
        │                │                │                │                │
   ┌─ BUBBLE ──┐   ┌─ VISITORS ──┐   ┌─ SESSION ──┐   ┌─ EFFECT ────┐
   │ visible &&│   │ visitors    │   │ sessionOpen│   │ status="busy"│
   │ message.  │   │ .length     │   │ === true   │   │ + enabled    │
   │ length>30 │   │ > 0         │   │            │   │              │
   ├───────────┤   ├─────────────┤   ├────────────┤   ├──────────────┤
   │ 320 × 400 │   │ 500 × 240   │   │ 320 × 400  │   │ 1200 × 1200  │
   │ X-80, Y   │   │ X-170, Y    │   │ X-80, Y    │   │ centered     │
   └───────────┘   └─────────────┘   └────────────┘   └──────────────┘
```

### The shared trigger pattern

Each trigger effect:

1. Pauses `useWindowDefaultSize` via the `paused` argument (so the default hook doesn't fight).
2. Computes `newWidth = max(default.width, TARGET_W)` and `newHeight = max(default.height, TARGET_H)`.
3. Computes `dx = newWidth - default.width` (X shift; Y is **never** shifted — the sprite must stay vertically anchored across all triggers).
4. **Saves the original position once** to its own `*SavedPosRef` (with a `if (!ref.current)` guard — see below).
5. Issues `setPosition(orig.x − dx/2, orig.y)` and `setSize(newWidth, newHeight)` together via `Promise.all`.
6. On deactivate, restores: `setPosition(savedPos)` + `setSize(default.width, default.height)`.

### Save-once guard (anti-shift bug)

Effects can re-run for reasons other than the trigger flipping (e.g. another trigger's flag changing in the same dependency array, scale change, parent re-render churn). If the saved-position ref is **overwritten** on every re-run, each run captures the *already-shifted* current window as the new "original" and shifts another `dx/2` — the window drifts left every time the effect re-fires.

```ts
// CORRECT — save once, every re-run is idempotent
if (!bubbleSavedPosRef.current) {
  bubbleSavedPosRef.current = new LogicalPosition(origX, origY);
}
const savedPos = bubbleSavedPosRef.current;
await Promise.all([
  win.setPosition(new LogicalPosition(savedPos.x - Math.round(dx / 2), savedPos.y)),
  win.setSize(new LogicalSize(newWidth, newHeight)),
]);
```

The ref is cleared in the restore path so the next grow cycle saves a fresh position. **Both the bubble and visitor effects need this guard.** Session also has it implicitly (it only re-runs on `sessionOpen` flips, not on overlapping triggers).

### Sprite Y is invariant

All triggers grow the window **down/sideways**, never up. So the sprite's screen Y stays at `Y + 20` (= window Y + container's `padding-top`) across every trigger. Don't shift `setPosition` Y on grow — if you do, the sprite jumps and the user notices.

## The five triggers in detail

### Default

`useWindowDefaultSize(scale, paused)` in `App.tsx:181`. The only "trigger" that doesn't grow — it sets the window back to default whenever `paused` is `false`. Pause condition:

```ts
effectActive || sessionOpen || sessionClosing || bubbleGrowActive || visitors.length > 0
```

### Bubble (length-driven)

`App.tsx` — single combined effect (see "the speech bubble" section below).

- Trigger: `bubbleGrowActive = visible && message.length > LONG_BUBBLE_THRESHOLD`
- `LONG_BUBBLE_THRESHOLD = 30` (chars), exported from `src/hooks/useBubble.ts`
- Target: `max(default, SESSION_DROPDOWN_MIN_WIDTH=320) × max(default, SESSION_DROPDOWN_WINDOW_HEIGHT=400)` — same dimensions as the session list dropdown by design
- Skip when `sessionOpen` is true (session already owns the grown window — bubble would be no-op)

### Visitors

`App.tsx` — `visitors.length` effect.

- Target: `500 × default.height`
- `.container.has-visitors` CSS class (set when `visitors.length > 0`) lifts `min-width` from 160 → 500 so the layout has horizontal room for visiting sprites.

### Session list

`App.tsx` — `sessionOpen` effect.

- Target: `max(default, 320) × max(default, 400)`
- The dropdown itself is `position: fixed`. `StatusPill.tsx` computes its `max-height` as `400 − dropdownTop − 10` so long lists scroll inside the budget instead of past the window edge.
- `sessionClosing` is a transient flag bumped by the `onOpenChange` callback in `App.tsx` to prevent `useWindowDefaultSize` racing the close-restore. **Don't use `sessionClosing` to gate other triggers** — it's been observed to get stuck `true` in scenario sequences and will break those triggers' grow paths if checked.

### Shadow-clone effect

`src/effects/EffectOverlay.tsx`. Triggered on `status === "busy"` (when the effect is enabled in settings). Grows to `1200 × 1200` for `2s`, then restores. Uses the same save-once-then-restore pattern.

## Speech bubble — special considerations

The bubble is `position: absolute` inside `.mascot-wrap`, so it doesn't contribute to layout. The window grows **for the bubble** but the container doesn't. The bubble naturally extends above the sprite (via `bottom: 128px*scale - 46px*scale` in `speech-bubble.css`) and lives in the empty space inside the now-taller window.

### Length detection

```ts
const bubbleGrowActive = visible && message.length > LONG_BUBBLE_THRESHOLD;
```

- `LONG_BUBBLE_THRESHOLD = 30` is empirically tuned. Short messages (Welcome, Task complete, etc., all ≤ 25 chars) fit comfortably inside the default 160×240 window. Anything beyond starts wrapping or overflowing the sprite area.
- All five bubble sources funnel through `useBubble.ts` (welcome, task-completed, discovery-hint, mcp-say, bubble-preview), so length detection covers every trigger uniformly.

### Cross-window dismiss

`src/components/scenarios/PetStatusScenario.tsx` has a "Clear Bubble" button that emits a `bubble-dismiss` event. `useBubble.ts` listens for it and clears `visible` + the auto-hide timer:

```ts
emit("bubble-dismiss");                    // any window
listen("bubble-dismiss", () => {           // useBubble (main window)
  clearTimeout(timerRef.current);
  setVisible(false);
});
```

This is a reusable cross-window pattern for any action that needs to reach into the main pet window from Settings or Superpower.

## Sprite scale (0.5 / 1 / 1.5 / 2)

`src/hooks/useScale.ts` writes the `--sprite-scale` CSS variable AND passes the numeric `scale` into `useWindowDefaultSize(scale, paused)`. Changing scale:

- CSS scales the sprite proportionally
- `useWindowDefaultSize` re-runs on `scale` dep change → window resizes to `PET_BASE × scale`
- Each trigger's restore path also reads `getDefaultPetSize(scale)` → returns the same scaled values

| Scale | Default window | Sprite |
|---|---|---|
| 0.5× (Tiny) | 80 × 120 | 64 |
| 1× (Normal) | 160 × 240 | 128 |
| 1.5× (Large) | 240 × 360 | 192 |
| 2× (XL) | 320 × 480 | 256 |

`SESSION_DROPDOWN_MIN_WIDTH` and `SESSION_DROPDOWN_WINDOW_HEIGHT` are **not** scaled — they're absolute thresholds for dropdown content. At scale 2x where `default.width = 320`, the session-dropdown grow becomes a no-op for width because `max(320, 320) = 320`.

## How triggers combine

They can stack — e.g., a visitor arrives while the session list is open, or a bubble appears during shadow-clone effect.

- Pause condition is an `OR` of all trigger flags → the default hook never resets the window mid-stack.
- Each effect's `if (sessionOpen) return` guards prevent the inner triggers from fighting an outer trigger that already owns the grown window.
- Each trigger has its own `*SavedPosRef`, populated once on activate and cleared on deactivate. Restores are independent.
- If two triggers' `setSize` calls race, the LAST commit wins. Targets are usually identical (e.g., session and bubble both target 320×400), so the result is correct.

If you add a sixth trigger, follow the same rules:
- Add its flag to the `useWindowDefaultSize` pause condition.
- Use the standard pattern: save-once `*SavedPosRef`, parallel `Promise.all([setPosition, setSize])`.
- Restore by setting `getDefaultPetSize(scale)` (NOT `containerRef.offsetWidth/Height` — the container is fixed-size now).
- Decide what to do when another trigger is already active — the bubble pattern (`if (sessionOpen) return`) is the simplest.

## Constants quick-reference

```ts
// src/hooks/useWindowDefaultSize.ts
PET_BASE_WIDTH                  = 160
PET_BASE_HEIGHT                 = 240

// src/App.tsx
SESSION_DROPDOWN_MIN_WIDTH      = 320
SESSION_DROPDOWN_WINDOW_HEIGHT  = 400

// src/hooks/useBubble.ts
LONG_BUBBLE_THRESHOLD           = 30   (chars)

// src/App.tsx (inline)
VISITOR_WIDTH                   = 500  (hardcoded inside the visitors effect)

// src/effects/shadow-clone/index.ts
SHADOW_CLONE_WIN_SIZE           = 1200
```

## Dev outlines (App Bounds / Container / Root)

Visual debugging tool. Enable dev mode (click the Version label 10× in Settings) and three outlines appear on the main window:

| Toggle | Color | Element |
|---|---|---|
| App Bounds | purple `#5e5ce6` | `.container` |
| Container | red `#ff3b30` | `.container` content area (inside base padding) |
| Root | green `#34c759` | `#root` (= full webview) |

Hooks: `src/hooks/useDevAppBounds.ts`, `useDevContainerBounds.ts`, `useDevRootBounds.ts`. With the new architecture, the container is fixed-size, so `App Bounds` and `Container` won't change size during triggers — only `Root` (= window) does.

In `App.tsx` the outline states are gated with `devMode && toggle`, so if dev mode is off, outlines never render — even if a `dev-*-bounds-changed` event leaks in.

## Diagnostic logging

`@tauri-apps/plugin-log` is wired up for the frontend (see `src-tauri/src/lib.rs:418` — `tauri_plugin_log::Builder` with `Stdout`/`LogDir`/`Webview` targets). Frontend log calls flow through to the same terminal where Rust logs land:

```ts
import { info as logInfo } from "@tauri-apps/plugin-log";
void logInfo("[bubble-grow] ...");   // visible in `bun run tauri dev` stdout
```

Use this when diagnosing trigger issues — DevTools is awkward to open on the borderless transparent main window. Add `logInfo()` calls inside the trigger effect, run the dev server, paste the output. Remove the calls when done.

## Change recipes

### Change the default size

1. `src/hooks/useWindowDefaultSize.ts` → `PET_BASE_WIDTH` / `PET_BASE_HEIGHT`
2. `src-tauri/tauri.conf.json` → main window `width` / `height` (match default for first-paint correctness)
3. `src/styles/app.css` → `.container { min-width; min-height }` (match default)
4. `src/App.tsx` → inline `style={{ minWidth, minHeight }}` on `.container` (uses `PET_BASE_*` constants — should auto-update if you import them)
5. Verify `SESSION_DROPDOWN_MIN_WIDTH` (320) is still ≥ default width — it's the floor the session/bubble triggers use for `max(default, …)`.

### Change the visitor width

1. `src/App.tsx` → inside the `visitors.length` effect, change `newWidth = 500`
2. `src/styles/app.css` → `.container.has-visitors { min-width: 500px }` (keep in sync)

### Change the session-dropdown size

1. `src/App.tsx` → `SESSION_DROPDOWN_WINDOW_HEIGHT` and/or `SESSION_DROPDOWN_MIN_WIDTH`
2. `src/components/StatusPill.tsx` → the `SESSION_WINDOW_HEIGHT` local constant inside the `sessionOpen` effect (used to compute dropdown's `max-height` — keep in sync with `SESSION_DROPDOWN_WINDOW_HEIGHT`)

### Change the long-bubble threshold

`src/hooks/useBubble.ts` → `LONG_BUBBLE_THRESHOLD`. The default `30` chars is empirically tuned for 12px sans-serif at the bubble's `max-width: 280px`. Lower = more aggressive (more bubbles trigger window grow). Higher = more bubbles stay at default and may clip.

### Change the shadow-clone effect size

`src/effects/shadow-clone/index.ts` → the `expandWindow` field on the effect descriptor.

### Add a new growth mode (sixth trigger)

Template: see the `bubble` effect in `App.tsx` (~lines 197–257). Steps:

1. Add a flag (state or derived value) for the trigger.
2. Add the flag to `useWindowDefaultSize`'s `paused` arg.
3. Create a `useEffect` keyed on `[flag, sessionOpen, scale]` that:
   - Skips when `sessionOpen` is true (session list owns the grown window)
   - On `flag === true`: save-once into a new `*SavedPosRef`, then `Promise.all([setPosition(saved.x − dx/2, saved.y), setSize(newW, newH)])`
   - On `flag === false`: read & clear `*SavedPosRef`, then `Promise.all([setPosition(saved), setSize(default)])`
4. Decide what happens when another trigger is already active. For width-only growth (like visitors), the trigger composes naturally; for height growth, you may need to read the current state and adjust.

## Related files

| Path | Responsibility |
|---|---|
| `src/hooks/useWindowDefaultSize.ts` | Default-size constants + hook |
| `src/hooks/useWindowAutoSize.ts` | Old content-driven hook — **only used by `PeerListApp` and `SessionListApp`** popovers (those genuinely need content-driven sizing). Don't reintroduce it for the main pet window. |
| `src/App.tsx` | All trigger effects, pause coordination, `*SavedPosRef`s, constants |
| `src/components/StatusPill.tsx` | Session dropdown's `max-height` |
| `src/hooks/useBubble.ts` | Bubble state, 5 source listeners, `LONG_BUBBLE_THRESHOLD`, `bubble-dismiss` listener |
| `src/hooks/useVisitors.ts` | Visitor state source (with Strict-Mode dedup) |
| `src/hooks/useScale.ts` | Sprite scale — writes CSS var, reads from `displayScale` store key |
| `src/effects/EffectOverlay.tsx` | Shadow-clone effect grow (uses `expandWindow` from effect descriptor) |
| `src/styles/app.css` | `.container` baseline + `.has-visitors` + dev-outline CSS |
| `src/styles/speech-bubble.css` | Bubble sizing, absolute position, animation |
| `src/styles/visitor.css` | Visitor-dog layout, absolute-positioned greeting |
| `src-tauri/tauri.conf.json` | Native initial size (matches default) |
| `src/components/scenarios/PetStatusScenario.tsx` | Scenario panel + `bubble-dismiss` button |
