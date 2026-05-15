import { useEffect, useRef } from "react";
import { useClaudeUsage } from "../hooks/useClaudeUsage";

interface UsagePopoverProps {
  open: boolean;
  onClose: () => void;
  /** Pixel offset from the wrapper's top edge to position under the dot. */
  top: number;
}

export function UsagePopover({ open, onClose, top }: UsagePopoverProps) {
  const { data, loading, error, refresh } = useClaudeUsage({ enabled: open });
  const popoverRef = useRef<HTMLDivElement>(null);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Click-outside closes. The handler is mounted after a tick so the same
  // click that opened the popover isn't immediately treated as outside.
  useEffect(() => {
    if (!open) return;
    let handler: ((e: MouseEvent) => void) | null = null;
    const id = window.setTimeout(() => {
      handler = (e: MouseEvent) => {
        const el = popoverRef.current;
        if (!el) return;
        if (e.target instanceof Node && !el.contains(e.target)) {
          onClose();
        }
      };
      window.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      window.clearTimeout(id);
      if (handler) window.removeEventListener("mousedown", handler);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      className="usage-popover"
      data-testid="usage-popover"
      style={{ top }}
      role="dialog"
      aria-label="Claude Code usage"
    >
      <div className="usage-popover-header">
        <span className="usage-popover-title">Claude usage</span>
        <button
          type="button"
          data-testid="usage-popover-refresh"
          className="usage-popover-refresh"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh usage"
          title="Refresh"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.45 10.5h-2.09A6 6 0 1 1 12 6a5.94 5.94 0 0 1 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
        </button>
      </div>
      <div className="usage-popover-body">
        {loading && !data && (
          <div className="usage-popover-loading" data-testid="usage-popover-loading">
            Checking usage…
          </div>
        )}
        {error && (
          <div className="usage-popover-error" data-testid="usage-popover-error">
            <div>{error}</div>
            <button
              type="button"
              data-testid="usage-popover-retry"
              className="usage-popover-retry"
              onClick={refresh}
              disabled={loading}
            >
              Retry
            </button>
          </div>
        )}
        {data && (
          <pre className="usage-popover-text" data-testid="usage-popover-text">
            {data.text}
          </pre>
        )}
      </div>
    </div>
  );
}
