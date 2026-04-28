# Spotify Setup

Ani-Mime can show your currently-playing Spotify track and let you play / pause / skip / scrub from a popover under the dog. This is opt-in and uses Spotify's official OAuth (PKCE) flow — no client secret, no third-party server.

## Prerequisites

- A Spotify **Premium** account (Free accounts can read playback state but cannot control playback per Spotify's API rules).
- An active Spotify session on at least one device (desktop app, web player, phone). Ani-Mime controls whichever device Spotify treats as currently active.

## 1. Register a Spotify app (5 min)

1. Open <https://developer.spotify.com/dashboard> and sign in.
2. Click **Create app**.
3. Fill in:
   - **App name**: `Ani-Mime` (anything; only you will see it)
   - **App description**: anything
   - **Website**: leave blank or paste anything
   - **Redirect URI**: `http://127.0.0.1:1234/spotify/callback`  ← exact match required
   - **Which API/SDKs are you planning to use**: check **Web API**
4. Agree to terms, click **Save**.
5. On the resulting app page, click **Settings**. Copy the **Client ID** (long hex string).

You do **not** need the Client Secret — Ani-Mime uses PKCE.

## 2. Connect Ani-Mime

1. Open Ani-Mime → **Settings** → **Spotify**.
2. Paste the Client ID into the **Client ID** field, click **Save**.
3. Click **Connect Spotify**. Your default browser opens Spotify's auth page.
4. Click **Agree**. Spotify redirects to `127.0.0.1:1234/spotify/callback`, Ani-Mime captures the code, exchanges it for tokens, and the popover under the dog becomes available.

## 3. Use it

- A music-note button appears under the dog when connected. Click to open the player popover.
- Popover shows: track art, title, artist, progress bar (drag to seek), and play / pause / prev / next buttons.
- Polling refreshes state every ~2.5s while the popover is open.

## Scopes requested

| Scope | Why |
|-------|-----|
| `user-read-playback-state` | Read what's playing + progress + active device |
| `user-modify-playback-state` | Play / pause / skip / seek |
| `user-read-currently-playing` | Fallback for currently-playing track |

## Disconnect

Settings → Spotify → **Disconnect**. This wipes the stored tokens from `settings.json`. Spotify still remembers the app authorisation; revoke it at <https://www.spotify.com/account/apps/> if you also want to remove it from your account.

## Troubleshooting

- **"INVALID_CLIENT: Invalid redirect URI"** — the redirect URI in your Spotify app settings does not exactly match `http://127.0.0.1:1234/spotify/callback`. Fix and save.
- **"No active device"** — Spotify needs an active player. Open the Spotify app or web player and start any track once. Ani-Mime then sees the device.
- **Controls do nothing** — confirm your account is Premium. Free accounts return `403 Forbidden` on play/pause/skip.
- **Auth page loops back to "Connect Spotify"** — make sure the Ani-Mime HTTP server is running (it starts with the app). Check logs for `[spotify]` lines.
