import { useEffect, useRef, useState } from "react";
import { useClaudeUsage } from "../hooks/useClaudeUsage";

interface UsagePopoverProps {
  open: boolean;
  onClose: () => void;
  /** Pixel offset from the wrapper's top edge to position under the dot. */
  top: number;
}

interface Metric {
  percent?: number;
  resetIn?: string;
}

interface ParsedUsage {
  session: Metric;
  week: Metric;
  sonnet: Metric;
}

const RESET_RE =
  /reset[^a-z0-9]*?(?:in|at|on|after)?\s*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?(?:\s*[a-z]{3,9})?(?:\s+[0-9]{1,2}[hm])?(?:\s+[0-9]{1,2}[hm])?|[0-9]+\s*(?:days?|hours?|minutes?|d|h|m)(?:\s+[0-9]+\s*[hm])?|[a-z]+\s+at\s+[0-9:]+\s*[ap]m)/i;
const PCT_RE = /([0-9]{1,3})\s*%/;

function extractMetric(block: string): Metric {
  const pct = block.match(PCT_RE)?.[1];
  const reset = block.match(RESET_RE)?.[1];
  return {
    percent: pct !== undefined ? Math.min(100, Number(pct)) : undefined,
    resetIn: reset?.trim().replace(/\s+/g, " "),
  };
}

function parseUsage(text: string): ParsedUsage {
  const lines = text.split(/\r?\n/);
  const result: ParsedUsage = { session: {}, week: {}, sonnet: {} };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    // Look at a 4-line window so reset times on the next line are caught.
    const block = lines.slice(i, i + 4).join(" ");
    const blockL = block.toLowerCase();

    if (!result.session.percent && !result.session.resetIn && /(?:current\s+)?session|5\s*hour|5h\b/.test(line)) {
      result.session = extractMetric(blockL);
    }
    if (!result.week.percent && !result.week.resetIn && /(?:current\s+)?week(?:ly)?/.test(line)) {
      result.week = extractMetric(blockL);
    }
    if (!result.sonnet.resetIn && /sonnet/.test(line)) {
      result.sonnet = extractMetric(blockL);
    }
  }

  return result;
}

function barColor(percent: number): string {
  if (percent >= 85) return "var(--usage-bar-red, #ef4444)";
  if (percent >= 60) return "var(--usage-bar-yellow, #facc15)";
  return "var(--usage-bar-green, #4ade80)";
}

function UsageCard({
  label,
  metric,
  hidePercent,
}: {
  label: string;
  metric: Metric;
  hidePercent?: boolean;
}) {
  const hasPercent = metric.percent !== undefined && !hidePercent;
  return (
    <div className="usage-card" data-testid={`usage-card-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className="usage-card-label">{label}</div>
      <div className="usage-card-row">
        {hasPercent ? (
          <div className="usage-card-value">{metric.percent}%</div>
        ) : (
          <div className="usage-card-value usage-card-value-muted">—</div>
        )}
        <div className="usage-card-reset">
          {metric.resetIn ? <>Resets {metric.resetIn}</> : <span className="usage-card-reset-muted">No reset info</span>}
        </div>
      </div>
      {hasPercent && (
        <div className="usage-card-bar" aria-hidden="true">
          <div
            className="usage-card-bar-fill"
            style={{
              width: `${metric.percent}%`,
              background: barColor(metric.percent ?? 0),
            }}
          />
        </div>
      )}
    </div>
  );
}

export function UsagePopover({ open, onClose, top }: UsagePopoverProps) {
  const { data, loading, error, refresh } = useClaudeUsage({ enabled: open });
  const popoverRef = useRef<HTMLDivElement>(null);
  const [showRaw, setShowRaw] = useState(false);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Click-outside closes.
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

  const parsed = data ? parseUsage(data.text) : null;

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
        {parsed && (
          <>
            <div className="usage-popover-cards">
              <UsageCard label="Current session" metric={parsed.session} />
              <UsageCard label="This week" metric={parsed.week} />
              <UsageCard label="Sonnet" metric={parsed.sonnet} hidePercent />
            </div>
            <button
              type="button"
              className="usage-popover-raw-toggle"
              onClick={() => setShowRaw((v) => !v)}
              data-testid="usage-popover-raw-toggle"
            >
              {showRaw ? "Hide raw output" : "Show raw output"}
            </button>
            {showRaw && (
              <pre className="usage-popover-text" data-testid="usage-popover-text">
                {data!.text}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
