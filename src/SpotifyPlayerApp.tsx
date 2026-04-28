import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSpotify } from "./hooks/useSpotify";
import { useTheme } from "./hooks/useTheme";
import "./styles/theme.css";
import "./styles/spotify-player.css";

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function SpotifyPlayerApp() {
  useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const { track, nextUp, connected, error, play, pause, next, prev, seek } = useSpotify(true);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  // Hide popover on blur — same pattern as peer-list.
  useEffect(() => {
    const win = getCurrentWindow();
    const unlistenP = win.onFocusChanged(({ payload: focused }) => {
      if (!focused) void win.hide();
    });
    return () => {
      unlistenP.then((fn) => fn());
    };
  }, []);

  const renderEmpty = (msg: string) => (
    <div className="spotify-shell">
      <div className="spotify-root">
        <div className="spotify-empty" data-testid="spotify-empty">{msg}</div>
      </div>
    </div>
  );

  if (!connected) return renderEmpty("Connect Spotify in Settings.");
  if (error && !track) return renderEmpty(error);
  if (!track) return renderEmpty("Loading...");
  if (track.noDevice) return renderEmpty("No active Spotify device. Open Spotify on any device, start a track, then come back.");

  const displayProgress = scrubbing ?? track.progressMs;
  const pct = track.durationMs > 0 ? (displayProgress / track.durationMs) * 100 : 0;

  return (
    <div ref={rootRef} className="spotify-shell">
      <div className="spotify-root" data-testid="spotify-player-root">
        <div className="spotify-track">
          {track.artUrl ? (
            <img src={track.artUrl} alt="" className="spotify-art" />
          ) : (
            <div className="spotify-art-placeholder" />
          )}
          <div className="spotify-meta">
            <span className="spotify-title" data-testid="spotify-title">{track.title || "Nothing playing"}</span>
            <span className="spotify-artist" data-testid="spotify-artist">{track.artist}</span>
          </div>
        </div>

        <div className="spotify-progress-row">
          <span className="spotify-time" data-testid="spotify-elapsed">{fmtTime(displayProgress)}</span>
          <input
            type="range"
            className="spotify-progress"
            min={0}
            max={track.durationMs || 1}
            value={displayProgress}
            data-testid="spotify-progress"
            style={{ "--pct": `${pct}%` } as React.CSSProperties}
            onChange={(e) => setScrubbing(Number(e.target.value))}
            onMouseDown={() => setScrubbing(track.progressMs)}
            onMouseUp={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              setScrubbing(null);
              void seek(v);
            }}
            onTouchEnd={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              setScrubbing(null);
              void seek(v);
            }}
          />
          <span className="spotify-time" data-testid="spotify-duration">{fmtTime(track.durationMs)}</span>
        </div>

        <div className="spotify-controls">
          <button
            type="button"
            className="spotify-btn"
            data-testid="spotify-prev"
            aria-label="Previous track"
            onClick={() => void prev()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>

          <button
            type="button"
            className="spotify-btn play"
            data-testid="spotify-play-pause"
            aria-label={track.isPlaying ? "Pause" : "Play"}
            onClick={() => void (track.isPlaying ? pause() : play())}
          >
            {track.isPlaying ? (
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>

          <button
            type="button"
            className="spotify-btn"
            data-testid="spotify-next"
            aria-label="Next track"
            onClick={() => void next()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zm-2 6L5.5 6v12z"/></svg>
          </button>
        </div>

        {nextUp && (
          <button
            type="button"
            className="spotify-up-next"
            data-testid="spotify-up-next"
            onClick={() => void next()}
            title="Skip to next track"
          >
            {nextUp.artUrl ? (
              <img src={nextUp.artUrl} alt="" className="spotify-up-next-art" />
            ) : (
              <span className="spotify-up-next-art placeholder" />
            )}
            <span className="spotify-up-next-meta">
              <span className="spotify-up-next-label">Up next</span>
              <span className="spotify-up-next-title">{nextUp.title}</span>
              <span className="spotify-up-next-artist">{nextUp.artist}</span>
            </span>
            <svg className="spotify-up-next-skip" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M16 6h2v12h-2zm-2 6L5.5 6v12z"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
