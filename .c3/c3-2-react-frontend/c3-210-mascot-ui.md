---
id: c3-210
c3-version: 4
c3-seal: e671b25ce101c818a0ba33497c34d92114252a21692ca80301244adf25863645
title: Mascot UI
type: component
category: feature
parent: c3-2
goal: 'Render the main mascot window: the animated sprite, the colored status pill, the speech bubble, and the draggable root layout that hosts the effect overlay and visiting dogs.'
summary: App.tsx root component orchestrating Mascot, StatusPill, SpeechBubble, VisitorDog, and DevTag in a transparent always-on-top 500×220 window
uses:
    - ref-sprite-animation
    - ref-status-priority
    - ref-theming
    - rule-data-testid
---

## Goal

Render the main mascot window: the animated sprite, the colored status pill, the speech bubble, and the draggable root layout that hosts the effect overlay and visiting dogs.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Status, bubble, theme, glow, drag state from hooks | c3-201 |
| IN | Sprite configs | c3-202 |
| IN | Effect overlay | c3-203 |
| IN | Visitor composition | c3-214 |
## Container Connection

App.tsx is the composition root for index.html. It applies data-theme on <html>, mounts Mascot, StatusPill, SpeechBubble, EffectOverlay, and the visitor layer. Auto-freeze logic lives in Mascot.tsx. Neon and pulse styling lives in styles/status-pill.css. Right-click on the mascot opens a context menu of peers wired to c3-214's start_visit flow.
