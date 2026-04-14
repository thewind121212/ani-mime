---
id: c3-213
c3-seal: 41d0536645e4d78f5810c402b91869d3de96624bb286172b60559fd0078e0695
title: smart-import
type: component
category: feature
parent: c3-2
goal: 'Let users import arbitrary sprite sheets as custom mascots: pick frames from a grid, crop a chroma-key background, preview the animation, and persist the resulting custom pet so it appears in the Mime tab alongside built-in characters.'
uses:
    - rule-data-testid
---

## Goal

Let users import arbitrary sprite sheets as custom mascots: pick frames from a grid, crop a chroma-key background, preview the animation, and persist the resulting custom pet so it appears in the Mime tab alongside built-in characters.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Persistence + custom mime hook | c3-201 |
| OUT | Extended sprite registry for Sprite Engine | c3-202 |
| OUT | Selectable pet entries for Settings | c3-211 |
## Container Connection

SmartImport.tsx is launched from the Settings Mime tab. It uses the Tauri dialog plugin to pick a PNG sheet, spriteSheetProcessor.ts to extract per-frame images and chroma-key the background, and the Tauri fs plugin to write frames under ~/.ani-mime/custom/<slug>/. The resulting PetInfo is stored via the useCustomMimes hook and flows back into c3-202's sprite registry for both Mascot UI and Visitor Dogs.
