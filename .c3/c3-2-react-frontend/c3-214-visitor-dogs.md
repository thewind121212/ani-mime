---
id: c3-214
c3-seal: 1e2bd0ecd3a4a620d392c88447ca027b42e55e03c124f157ec0b256b4789aa3f
title: visitor-dogs
type: component
category: feature
parent: c3-2
goal: Render peer visiting dogs on the right side of the mascot window — 96x96 mirrored sprites with slide-in animation and staggered offsets — when visitor-arrived events arrive from the backend, and initiate outgoing visits from a right-click context menu on the mascot.
uses:
    - ref-peer-visit-protocol
    - ref-sprite-animation
    - rule-data-testid
---

## Goal

Render peer visiting dogs on the right side of the mascot window — 96x96 mirrored sprites with slide-in animation and staggered offsets — when visitor-arrived events arrive from the backend, and initiate outgoing visits from a right-click context menu on the mascot.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Visitor list and peer list from hooks | c3-201 |
| IN | Sprite configs for visitor rendering | c3-202 |
| OUT | start_visit command invocation | c3-111 |
| OUT | Composed into the main window | c3-210 |
## Container Connection

VisitorDog.tsx renders a 96x96 sprite mirrored via transform: scaleX(-1) so the visitor faces the resident dog. The useVisitors and usePeers hooks in c3-201 feed the list; the right-click peer menu on the mascot invokes start_visit(peer_id, nickname, pet) which routes through c3-111. visitor.css handles the slide-in keyframe and stagger via --visitor-offset.
