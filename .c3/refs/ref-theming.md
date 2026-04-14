---
id: ref-theming
c3-seal: 65461b21edf63d1938e9628d8f60cffe3e61ba741324754dcb3c0870b278e4b6
title: theming
type: ref
goal: Provide light and dark themes (plus status-aware accent colors) across every window without rebuilding or re-rendering the tree.
---

## Goal

Provide light and dark themes (plus status-aware accent colors) across every window without rebuilding or re-rendering the tree.

## Choice

CSS custom properties scoped by `[data-theme="dark"]` and `[data-theme="light"]` selectors in src/styles/theme.css. The useTheme hook writes the current theme to document.documentElement.dataset.theme and persists through the cross-window-sync pattern. Status colors (idle green, busy red, service purple, etc.) are defined once in status-pill.css and stay theme-independent so the status pill reads the same in both modes.

## Why

CSS variables are instant (no re-render, no class-name diffing) and work across all our components without props drilling. Scoping them by a data attribute on <html> means a single mutation updates every window that happens to be open. Keeping status colors outside the theme set avoids ambiguous "is busy red in light mode?" debates and keeps the branding consistent regardless of user preference.

## How

- Add variables under [data-theme="your-theme"] in src/styles/theme.css; never read theme inside React for styling
- useTheme (src/hooks/useTheme.ts) follows ref-cross-window-sync; it updates document.documentElement.dataset.theme and broadcasts theme-changed
- Status colors live in src/styles/status-pill.css under .dot-idle, .dot-busy, etc., and must not reference --text-primary or other theme variables
- Glow modes (off/light/dark) are applied as .glow-light / .glow-dark classes on the sprite — not via theme variables, because users can mix a dark theme with a light glow
- Backdrop-filter glass effect uses blur(10px)/blur(12px) on pill and bubble; image-rendering: pixelated stays on sprites regardless of theme
