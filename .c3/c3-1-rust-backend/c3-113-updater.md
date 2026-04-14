---
id: c3-113
c3-seal: b384f7722aaaa3292263c12bfbf6dd144a7c7d335e95b1a3f77f6ac5be3acd7c
title: updater
type: component
category: feature
parent: c3-1
goal: Check GitHub Releases on startup and show a native update dialog when a newer version is available, respecting a "skipped version" preference in the Tauri store so users are not re-prompted on every launch.
uses:
    - rule-app-log-macros
---

## Goal

Check GitHub Releases on startup and show a native update dialog when a newer version is available, respecting a "skipped version" preference in the Tauri store so users are not re-prompted on every launch.

## Dependencies

| Direction | What | From/To |
| --- | --- | --- |
| IN | Persisted "skipped version" value | c3-201 |
| OUT | Log lines | c3-103 |
## Container Connection

updater.rs runs 3 seconds after startup in a dedicated thread. It reads Cargo.toml's version at compile time, fetches the GitHub Releases JSON via reqwest, compares semver, and on newer releases triggers a macOS dialog with Download / Skip / Later. Selecting "Skip" writes the new version into settings.json via the Tauri store plugin so the check is quiet until the next release.
