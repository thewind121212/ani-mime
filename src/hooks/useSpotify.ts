import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface SpotifyTrack {
  title: string;
  artist: string;
  artUrl: string | null;
  durationMs: number;
  isPlaying: boolean;
  progressMs: number;
  noDevice: boolean;
}

export interface SpotifyQueueItem {
  title: string;
  artist: string;
  artUrl: string | null;
}

function parseQueueItem(raw: unknown): SpotifyQueueItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const album = r.album as Record<string, unknown> | undefined;
  const images = (album?.images as Array<{ url: string }> | undefined) ?? [];
  const artists = (r.artists as Array<{ name: string }> | undefined) ?? [];
  return {
    title: (r.name as string) ?? "",
    artist: artists.map((a) => a.name).join(", "),
    artUrl: images[0]?.url ?? null,
  };
}

interface SpotifyStatus {
  connected: boolean;
  client_id: string;
}

const EVENT_CONNECTED = "spotify-connected";
const EVENT_CLIENT_CHANGED = "spotify-client-changed";

function isAuthError(err: string): boolean {
  const lower = err.toLowerCase();
  return (
    lower.includes("not connected") ||
    lower.includes("invalid_grant") ||
    lower.includes("refresh error") ||
    lower.includes("refresh request failed") ||
    lower.includes("no refresh token") ||
    lower.includes("no client_id") ||
    lower.includes("reconnect")
  );
}

function parseState(raw: unknown): SpotifyTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.no_device) {
    return {
      title: "",
      artist: "",
      artUrl: null,
      durationMs: 0,
      isPlaying: false,
      progressMs: 0,
      noDevice: true,
    };
  }
  const item = r.item as Record<string, unknown> | undefined;
  if (!item) return null;
  const album = item.album as Record<string, unknown> | undefined;
  const images = (album?.images as Array<{ url: string }> | undefined) ?? [];
  const artists = (item.artists as Array<{ name: string }> | undefined) ?? [];
  return {
    title: (item.name as string) ?? "",
    artist: artists.map((a) => a.name).join(", "),
    artUrl: images[0]?.url ?? null,
    durationMs: (item.duration_ms as number) ?? 0,
    isPlaying: Boolean(r.is_playing),
    progressMs: (r.progress_ms as number) ?? 0,
    noDevice: false,
  };
}

/**
 * Polls Spotify state every 2.5s while `active`. Between polls, interpolates
 * progress locally so the UI scrubber moves smoothly without hammering the API.
 */
export function useSpotify(active: boolean) {
  const [track, setTrack] = useState<SpotifyTrack | null>(null);
  const [nextUp, setNextUp] = useState<SpotifyQueueItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const authFailedRef = useRef(false);
  const lastFetchRef = useRef<number>(0);

  // Connection status comes from the backend (which reads settings.json
  // fresh each call). Going through tauri-plugin-store would race with
  // the backend's direct file writes — its cached snapshot stays stale
  // until reloaded, so we ask backend directly.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await invoke<SpotifyStatus>("spotify_status");
        if (!cancelled) setConnected(s.connected);
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    void refresh();
    const u = listen<boolean>(EVENT_CONNECTED, () => {
      void refresh();
      setNeedsReauth(false);
      setError(null);
      authFailedRef.current = false;
    });
    return () => {
      cancelled = true;
      u.then((fn) => fn());
    };
  }, []);

  const fetchState = useCallback(async () => {
    if (!connected || authFailedRef.current) return;
    try {
      const raw = await invoke<unknown>("spotify_state");
      lastFetchRef.current = Date.now();
      const parsed = parseState(raw);
      setTrack(parsed);
      setError(null);
    } catch (e) {
      const errStr = String(e);
      setError(errStr);
      if (isAuthError(errStr)) {
        authFailedRef.current = true;
        setConnected(false);
        setNeedsReauth(true);
        return; // Don't try queue — auth is dead.
      }
    }
    // Queue is independent of player state — fetch in parallel and
    // tolerate failure (e.g. some account types refuse the queue
    // endpoint with 403). A failed queue fetch shouldn't blank the
    // current-track UI.
    try {
      const q = await invoke<{ queue?: unknown[] }>("spotify_queue");
      const first = q?.queue?.[0];
      setNextUp(first ? parseQueueItem(first) : null);
    } catch {
      setNextUp(null);
    }
  }, [connected]);

  useEffect(() => {
    if (!active || !connected) return;
    void fetchState();
    const id = setInterval(() => void fetchState(), 2500);
    return () => clearInterval(id);
  }, [active, connected, fetchState]);

  // Local progress interpolation between polls.
  useEffect(() => {
    if (!track || !track.isPlaying) return;
    const id = setInterval(() => {
      setTrack((t) => {
        if (!t || !t.isPlaying) return t;
        const elapsed = Date.now() - lastFetchRef.current;
        const next = Math.min(t.durationMs, t.progressMs + 500);
        // If we drifted past the polled value by more than the poll
        // interval, freeze — the next poll will resync.
        if (elapsed > 3000) return t;
        return { ...t, progressMs: next };
      });
    }, 500);
    return () => clearInterval(id);
  }, [track]);

  const play = useCallback(async () => {
    try {
      await invoke("spotify_play");
      void fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const pause = useCallback(async () => {
    try {
      await invoke("spotify_pause");
      void fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const next = useCallback(async () => {
    try {
      await invoke("spotify_next");
      void fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const prev = useCallback(async () => {
    try {
      await invoke("spotify_prev");
      void fetchState();
    } catch (e) {
      setError(String(e));
    }
  }, [fetchState]);

  const seek = useCallback(async (positionMs: number) => {
    try {
      await invoke("spotify_seek", { positionMs });
      // Optimistic update so the slider feels responsive.
      setTrack((t) => (t ? { ...t, progressMs: positionMs } : t));
      lastFetchRef.current = Date.now();
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const reconnect = useCallback(async () => {
    try {
      const s = await invoke<SpotifyStatus>("spotify_status");
      if (!s.client_id) {
        setError("No Client ID configured. Set it in Settings → Spotify.");
        return;
      }
      await invoke<string>("spotify_connect", { clientId: s.client_id });
      // Browser opens — once user completes OAuth, spotify-connected event
      // fires and the event listener above resets needsReauth + connected.
    } catch (e) {
      setError(String(e));
    }
  }, []);

  return { track, nextUp, connected, needsReauth, error, play, pause, next, prev, seek, reconnect };
}

/**
 * Read-only connection mirror for components that need to know if Spotify is
 * connected (e.g. the pill button) without setting up the polling loop.
 */
export function useSpotifyConnected() {
  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState("");

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await invoke<SpotifyStatus>("spotify_status");
        if (!cancelled) {
          setConnected(s.connected);
          setClientId(s.client_id ?? "");
        }
      } catch {
        if (!cancelled) {
          setConnected(false);
        }
      }
    };
    void refresh();
    const u1 = listen<boolean>(EVENT_CONNECTED, () => void refresh());
    const u2 = listen<string>(EVENT_CLIENT_CHANGED, (ev) => setClientId(ev.payload));
    return () => {
      cancelled = true;
      u1.then((fn) => fn());
      u2.then((fn) => fn());
    };
  }, []);

  return { connected, clientId };
}
