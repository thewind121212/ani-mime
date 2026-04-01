# Ani-Mime

<p align="center">
  <img src="https://raw.githubusercontent.com/vietnguyenhoangw/ani-mime/main/src-tauri/icons/128x128.png" width="128" alt="Ani-Mime Logo" />
</p>

<p align="center">
  <strong>A floating pixel mascot that mirrors your terminal & Claude Code activity on macOS.</strong>
</p>

<p align="center">
  <a href="https://github.com/vietnguyenhoangw/ani-mime/releases"><img src="https://img.shields.io/github/v/release/vietnguyenhoangw/ani-mime?style=for-the-badge&color=8b5cf6" alt="Version"></a>
  <a href="https://github.com/vietnguyenhoangw/ani-mime/blob/main/LICENSE"><img src="https://img.shields.io/github/license/vietnguyenhoangw/ani-mime?style=for-the-badge" alt="License"></a>
  <img src="https://img.shields.io/badge/Platform-macOS-000000?style=for-the-badge&logo=apple" alt="Platform">
  <img src="https://img.shields.io/badge/Built%20with-Rust%20%26%20Tauri-orange?style=for-the-badge&logo=rust" alt="Built with Rust">
</p>

<p align="center">
  <img src="docs/demo.gif" width="960" alt="Ani-Mime Demo" />
</p>

---

## What is Ani-Mime?

A tiny always-on-top pixel dog that reacts to what your terminal is doing. It sniffs when you're building, barks when a dev server is running, sits when you're free, and sleeps when nothing's happening.

It also integrates with **Claude Code** — the dog knows when Claude is thinking vs waiting for you.

## Mascot States

| Status | Dot | Mascot | Meaning |
| :--- | :--- | :--- | :--- |
| **Free** | Green | Sitting | Terminal idle, ready for commands |
| **Working** | Red (pulse) | Sniffing | Running a task (build, git push, etc.) |
| **Service** | Blue | Barking | Dev server launched (vite, metro, etc.) |
| **Searching** | Yellow (pulse) | Idle | Waiting for connection |
| **Sleep** | Gray | Sleeping | Terminal closed or 10s of inactivity |

## Features

- **Pixel Art Mascot** — animated sprite sheet dog above the status pill
- **Manual Tagging** — zsh hooks classify commands as `task` or `service`
- **Heartbeat Architecture** — no process tree scanning, no time-based guessing
- **Claude Code Hooks** — tracks when Claude is actively working vs waiting
- **Multi-Session** — handles multiple terminals, priority: busy > service > idle
- **Auto-Setup** — first launch configures zsh hooks and Claude Code hooks via native macOS dialogs
- **All Workspaces** — visible on every macOS Space/desktop
- **Low Footprint** — Rust + Tauri, minimal CPU and RAM

---

## Install

### Homebrew (recommended)

```bash
brew tap vietnguyenhoangw/ani-mime
brew install --cask ani-mime
```

Open the app. On first launch, Ani-Mime will:
1. Ask to add a hook to your `~/.zshrc` (required for terminal tracking)
2. Ask to configure Claude Code hooks (optional)

Open a new terminal tab and the mascot starts reacting.

### Manual (from source)

```bash
git clone https://github.com/vietnguyenhoangw/ani-mime.git
cd ani-mime
bun install
bun tauri dev
```

Then source the zsh script:

```bash
echo 'source "/path/to/ani-mime/src-tauri/script/terminal-mirror.zsh"' >> ~/.zshrc
source ~/.zshrc
```

---

## Requirements

- **macOS** (Intel or Apple Silicon)
- **zsh** (default shell on macOS)
- **Claude Code** (optional) — for Claude activity tracking

## Architecture

```
Zsh Hooks ──HTTP:1234──> Rust Server ──Tauri Events──> React UI
                              |
Claude Code Hooks ────────────┘
```

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for full details.

## Tech Stack

- **Frontend:** React, TypeScript, Vite
- **Backend:** Rust, Tauri v2, tiny_http
- **Shell:** zsh hooks (preexec / precmd)
- **Sprites:** CSS sprite sheet animation (64x64 pixel art)

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing`)
5. Open a Pull Request

Contributions for new pixel art sprites, Rust logic improvements, or UI enhancements are welcome.

## License

MIT. See [LICENSE](LICENSE) for details.
