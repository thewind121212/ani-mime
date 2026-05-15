import { useEffect, useRef } from "react";
import { useClaudeUsage } from "../hooks/useClaudeUsage";

interface UsagePopoverProps {
  open: boolean;
  onClose: () => void;
  /** Pixel offset from the wrapper's top edge to position under the dot. */
  top: number;
  /** Caps total popover height so the bottom doesn't clip the window edge. */
  maxHeight: number;
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

const PCT_RE = /([0-9]{1,3})\s*%/;
// `claude /usage` prints reset stamps like "Resets 10:20pm (Asia/Saigon)"
// or "Resets May 22 at 1am (Asia/Saigon)" — and the pty output sometimes
// strips spaces, leaving us with "resetsMay22at1am(asia/saigon)". Both
// alts use `\s*` (not `\s+`) so they match either form.
// First alt is anchored on a month-name prefix so `[a-z]+` can't
// greedily swallow "Resets" into the capture (which produced the
// "Resets ResetsMay 22 at 1am" double-prefix bug).
const TIME_RE =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\d{1,2}\s*at\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}(?::\d{2})?\s*(?:am|pm))/i;

// "May22at1am" → "May 22 at 1am". No-op on already-spaced input.
function prettifyTime(s: string): string {
  return s
    .replace(/([a-z])(\d)/gi, "$1 $2")
    .replace(/(\d)at(?=\s|\d)/gi, "$1 at ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetric(block: string): Metric {
  const pct = block.match(PCT_RE)?.[1];
  const reset = block.match(TIME_RE)?.[1];
  return {
    percent: pct !== undefined ? Math.min(100, Number(pct)) : undefined,
    resetIn: reset ? prettifyTime(reset) : undefined,
  };
}

function parseUsage(text: string): ParsedUsage {
  const lines = text.split(/\r?\n/);
  const result: ParsedUsage = { session: {}, week: {}, sonnet: {} };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    // Wider window (10 lines) so the reset time — which can sit several
    // lines below the header (progress bar + blank separator) — is
    // still captured. TIME_RE returns the first match, so spillover
    // into the next section can't shadow this section's own time.
    const block = lines.slice(i, i + 10).join("\n");

    // Substring tests (not `\s+`-anchored regexes) so the
    // ANSI-compressed forms — "Currentweek(allmodels)" with no spaces —
    // match the same way the normal "Current week (all models)" does.
    // Order matters: "Current week (Sonnet only)" contains both "week"
    // and "sonnet", and we want it to fill the sonnet bucket.
    if (line.includes("sonnet")) {
      if (!result.sonnet.percent && !result.sonnet.resetIn) {
        result.sonnet = extractMetric(block);
      }
    } else if (line.includes("week")) {
      if (!result.week.percent && !result.week.resetIn) {
        result.week = extractMetric(block);
      }
    } else if (line.includes("session") || /5\s*hour|5h\b/.test(line)) {
      if (!result.session.percent && !result.session.resetIn) {
        result.session = extractMetric(block);
      }
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

export function UsagePopover({ open, onClose, top, maxHeight }: UsagePopoverProps) {
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

  // Click-outside closes.
  useEffect(() => {
    if (!open) return;
    let handler: ((e: MouseEvent) => void) | null = null;
    const id = window.setTimeout(() => {
      handler = (e: MouseEvent) => {
        const el = popoverRef.current;
        if (!el) return;
        if (!(e.target instanceof Node)) return;
        if (el.contains(e.target)) return;
        // Ignore clicks on the dot/pill that opens this popover — its own
        // onClick handler will close it. Without this guard the mousedown
        // here closes first, then the subsequent click event re-reads
        // `usageOpen=false` and reopens it (close → reopen flash).
        if (
          e.target instanceof Element &&
          e.target.closest("[data-usage-trigger]")
        ) {
          return;
        }
        onClose();
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
      style={{ top, maxHeight }}
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
          <div className="usage-popover-cards">
            <UsageCard label="Current session" metric={parsed.session} />
            <UsageCard label="This week" metric={parsed.week} />
            <UsageCard label="Sonnet" metric={parsed.sonnet} />
          </div>
        )}
      </div>
    </div>
  );
}
