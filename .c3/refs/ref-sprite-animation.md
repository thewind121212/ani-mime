---
id: ref-sprite-animation
c3-seal: 39cb3e07eebe4c9955a6e2b3ac3055a716a834d8ee88744f03635dbc63cc9b9f
title: sprite-animation
type: ref
goal: Animate the mascot without burning CPU, without a JavaScript animation loop, and in a way that stays crisp on retina displays.
---

## Goal

Animate the mascot without burning CPU, without a JavaScript animation loop, and in a way that stays crisp on retina displays.

## Choice

Horizontal PNG sprite strips (128px per frame) driven by pure CSS: animation: sprite-play duration steps(frames) infinite on a div whose background-image is the sprite sheet. image-rendering: pixelated keeps the art crisp. Three CSS custom properties (--sprite-width, --sprite-duration, --sprite-steps) are set from React based on the sprite registry so the same CSS handles every character and every status.

## Why

CSS steps() is GPU-accelerated and runs off the main thread, so the animation costs almost nothing even on a 2017 MacBook Air. A horizontal strip loads in one HTTP round-trip and exposes every frame to the browser cache immediately. Setting the frame count and duration via CSS variables lets React stay out of the animation hot path — it only re-renders when the status or pet actually changes, not per frame. Auto-freezing idle/disconnected after ten seconds drops CPU to near-zero during long idle windows.

## How

- Every character registers exactly seven sprites in src/constants/sprites.ts (one per Status), each with a PNG file and a frame count
- Each frame is 128x128; sheet width is frames * 128; height is 128; format is PNG with transparency
- Mascot.tsx sets --sprite-width to frames * 128 + "px", --sprite-duration to frames * 80 + "ms" (so ~12.5 FPS), and --sprite-steps to the frame count
- The CSS lives in src/styles/mascot.css and uses a single @keyframes sprite-play that shifts background-position from 0 to calc(-1 * var(--sprite-width))
- autoStopStatuses in src/constants/sprites.ts controls which statuses freeze after FREEZE_DELAY (10s); frozen sprites get the sprite.frozen class and have their background-position pinned to the last frame
- Visitor dogs use the same sheets but at 96x96 with transform: scaleX(-1)
