# Setup Flow

Ani-Mime runs an automatic setup on first launch to configure shell hooks and (optionally) Claude Code integration.

## Flow Diagram

```
App Launches
    │
    ▼
Check ~/.ani-mime/setup-done exists?
    │
    ├── Yes → Skip setup, start normally
    │
    └── No → Begin setup
            │
            ▼
        Detect installed shells (zsh, bash, fish)
            │
            ├── None found → Show error dialog → Exit
            │
            └── Found shells
                    │
                    ▼
                Check which shells already have hooks
                    │
                    ▼
                ┌─ One shell needs setup ─────→ Yes/Skip dialog
                │
                └─ Multiple shells need setup ─→ Choose-from-list dialog
                    │
                    ▼
                User selects shells (or skips)
                    │
                    ├── Skipped all + none pre-configured → Show error → Exit
                    │
                    └── Selected shells
                            │
                            ▼
                        Inject hook lines into RC files
                            │
                            ▼
                        Check for Claude Code
                            │
                            ├── Found → "Allow Claude tracking?" dialog
                            │
                            └── Not found → "Pre-configure hooks?" dialog
                                    │
                                    ▼
                                Write ~/.claude/settings.json hooks (if yes)
                                    │
                                    ▼
                                Write ~/.ani-mime/setup-done marker
                                    │
                                    ▼
                                Show "Setup complete, restarting" dialog
                                    │
                                    ▼
                                Restart app
```

## What Gets Modified

### Shell RC Files

A `source` line is appended:

```bash
# --- Ani-Mime Terminal Hook ---
source "/Applications/ani-mime.app/Contents/Resources/script/terminal-mirror.zsh"
```

The path points to the bundled script inside the Tauri app bundle.

### Claude Code Settings

If the user opts in, hooks are added to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "",
      "hooks": [{ "type": "command", "command": "curl -s --max-time 1 'http://127.0.0.1:1234/status?pid=0&state=busy&type=task' > /dev/null 2>&1" }]
    }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "curl ... busy" }] }],
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "curl ... idle" }] }],
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "curl ... idle" }] }],
    "SessionEnd": [{ "matcher": "", "hooks": [{ "type": "command", "command": "curl ... idle" }] }]
  }
}
```

### Marker File

`~/.ani-mime/setup-done` — Presence of this file prevents setup from running again.

## Native Dialogs

All dialogs use macOS `osascript` (AppleScript):
- `display dialog` — Yes/No confirmations
- `choose from list` — Multi-select shell picker

This avoids depending on a GUI framework for setup dialogs.

## Re-running Setup

To re-run setup:
1. Delete `~/.ani-mime/setup-done`
2. Restart the app

To manually remove hooks:
1. Edit `~/.zshrc` (or equivalent) and remove the `# --- Ani-Mime Terminal Hook ---` block
2. Edit `~/.claude/settings.json` and remove entries containing `127.0.0.1:1234`
