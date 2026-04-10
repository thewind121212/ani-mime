# Theming System

How visual styling and themes work across the application.

## Theme Architecture

Themes are applied via the `data-theme` attribute on `<html>`, controlled by the `useTheme` hook.

```
useTheme hook → Store("settings.json") → data-theme attribute → CSS variables
```

### Available Themes

| Theme | Attribute | Default |
|-------|-----------|---------|
| Dark | `data-theme="dark"` | Yes |
| Light | `data-theme="light"` | No |

## CSS Variables

Defined in `src/styles/theme.css`. All theme-aware components use these variables instead of hardcoded colors.

### Dark Theme (Default)

```css
[data-theme="dark"] {
  --bg-pill:        rgba(30, 30, 30, 0.8);
  --bg-pill-hover:  rgba(40, 40, 40, 0.85);
  --border-pill:    rgba(255, 255, 255, 0.08);
  --text-primary:   rgba(255, 255, 255, 0.85);
  --text-secondary: rgba(255, 255, 255, 0.5);
  --bg-bubble:      rgba(128, 128, 128, 0.85);
  --text-bubble:    #fff;
}
```

### Light Theme

```css
[data-theme="light"] {
  --bg-pill:        rgba(255, 255, 255, 0.75);
  --bg-pill-hover:  rgba(255, 255, 255, 0.85);
  --border-pill:    rgba(0, 0, 0, 0.08);
  --text-primary:   rgba(0, 0, 0, 0.85);
  --text-secondary: rgba(0, 0, 0, 0.5);
  --bg-bubble:      rgba(255, 255, 255, 0.85);
  --text-bubble:    #1a1a1a;
}
```

## Status Colors

These are theme-independent (same in dark and light). Defined in `src/styles/status-pill.css`:

| Status | Color | CSS Class | Animation |
|--------|-------|-----------|-----------|
| idle | `#34c759` (green) | `.dot-idle` | None |
| busy | `#ff3b30` (red) | `.dot-busy` | Pulse 0.4s |
| service | `#5e5ce6` (purple) | `.dot-service` | None |
| disconnected | `#636366` (gray) | `.dot-disconnected` | None |
| initializing | `#ff9f0a` (orange) | `.dot-initializing` | Pulse 1s |
| searching | `#ffcc00` (yellow) | `.dot-searching` | Pulse 1.5s |
| visiting | `#af52de` (magenta) | `.dot-visiting` | Pulse 1.5s |

## Glow Effects

Controlled by `useGlow` hook. Three modes applied as CSS classes on the mascot:

| Mode | CSS Class | Effect |
|------|-----------|--------|
| off | (none) | No glow |
| light | `.glow-light` | White drop-shadow |
| dark | `.glow-dark` | Black drop-shadow |

```css
.sprite.glow-light {
  filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.5));
}
.sprite.glow-dark {
  filter: drop-shadow(0 0 6px rgba(0, 0, 0, 0.5));
}
```

## Neon Effects

Status pill has neon glow animations for special states:

- **Task completed**: Green neon pulse (`neon-pulse` keyframe)
- **Busy state**: Red neon pulse (`neon-pulse-red` keyframe)

Both use multi-layer `drop-shadow` for the neon look.

## Glass/Blur Effect

Components use `backdrop-filter: blur()` for the frosted glass appearance:

| Component | Blur Amount |
|-----------|-------------|
| StatusPill | `blur(12px)` on hover |
| SpeechBubble | `blur(10px)` |
| Settings sidebar | Background opacity |

## Adding a New Theme

1. Add variables to `src/styles/theme.css` under a new `[data-theme="your-theme"]` selector
2. Update the `Theme` type in `src/hooks/useTheme.ts`
3. Add UI option in `src/components/Settings.tsx` (General tab)
4. The `useTheme` hook handles persistence and cross-window broadcast automatically

## Multi-Window Theme Sync

Theme changes broadcast via Tauri events so all windows stay in sync:

```
Settings window: setTheme("light")
  → Store.set("theme", "light")
  → emit("theme-changed", "light")
  → Main window: useTheme listens → applies data-theme
  → Superpower window: useTheme listens → applies data-theme
```
