---
id: c3-202
c3-version: 4
c3-seal: 7cdf92daeb24f495cef2dfdcdc0f94ab9055b227b7b48cf3cd73018dd21a1000
title: Sprite Engine
type: component
category: foundation
parent: c3-2
goal: Animate 128x128 pixel art by mapping character x status to a horizontal sprite sheet and driving it with CSS steps() — no JS in the hot path — plus auto-freeze for idle and disconnected after 10 seconds to save CPU.
summary: CSS steps() animation on horizontal sprite strips (128px frames), sprite registry mapping characters × statuses to sheet files, and visibility-based auto-freeze to save CPU
uses:
    - ref-sprite-animation
---

## Goal

Animate 128x128 pixel art by mapping character x status to a horizontal sprite sheet and driving it with CSS steps() — no JS in the hot path — plus auto-freeze for idle and disconnected after 10 seconds to save CPU.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Current status and pet from hooks | c3-201 |
| IN | Custom mime sprite overrides | c3-213 |
| OUT | Sprite configs consumed by Mascot UI | c3-210 |
| OUT | Sprite configs consumed by Visitor Dogs | c3-214 |
## Container Connection

constants/sprites.ts is the single registry — every character must register exactly seven sprites (one per Status). types/status.ts holds the Status, Pet, SpriteConfig, and PetInfo types that tie the frontend to the backend's status strings. Auto-freeze logic lives in Mascot.tsx and reads the autoStopStatuses set from constants/sprites.ts.
