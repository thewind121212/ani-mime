import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Status } from "../types/status";
import { fetchSessions, type SessionInfo } from "../hooks/useSessions";
import { useSessionList } from "../hooks/useSessionList";
import { useCollapsedSessionGroups } from "../hooks/useCollapsedSessionGroups";
import "../styles/status-pill.css";

interface StatusPillProps {
  status: Status;
  glow?: boolean;
}

const dotClassMap: Record<Status, string> = {
  service: "dot service",
  busy: "dot busy",
  idle: "dot idle",
  disconnected: "dot disconnected",
  initializing: "dot initializing",
  searching: "dot searching",
  visiting: "dot visiting",
};

const labelMap: Record<Status, string> = {
  service: "Service",
  busy: "Working...",
  idle: "Free",
  disconnected: "Sleep",
  initializing: "Initializing...",
  searching: "Searching...",
  visiting: "Visiting...",
};

// Priority for picking a group's summary state: busy > service > idle.
const statePriority: Record<string, number> = {
  busy: 3,
  service: 2,
  idle: 1,
};

function groupState(sessions: SessionInfo[]): string {
  let best = "idle";
  let bestP = 0;
  for (const s of sessions) {
    const p = statePriority[s.ui_state] ?? 0;
    if (p > bestP) {
      bestP = p;
      best = s.ui_state;
    }
  }
  return best;
}

/** Turn /Users/you/dev/foo into ~/dev/foo when home is known. */
function prettyPath(pwd: string, home?: string): string {
  if (!pwd) return "";
  if (home && pwd.startsWith(home)) return "~" + pwd.slice(home.length);
  return pwd;
}

/** Last path segment of a group (the leaf folder name). Falls back to the
 *  pretty path or a sensible string when pwd is missing. */
function groupBasename(g: { pwd: string; pretty: string; sessions: SessionInfo[] }): string {
  if (g.pwd) {
    const leaf = g.pwd.split("/").filter(Boolean).pop();
    if (leaf) return leaf;
  }
  // Fallback: if no pwd, use the pretty (already may be title/pid fallback).
  return g.pretty || g.sessions[0]?.title || "";
}

/** Human-readable label for what's happening in a single shell. */
function shellLabel(s: SessionInfo): string {
  if (s.has_claude) return "claude";
  if (s.fg_cmd) {
    // Some commands have "-" prefix when run as login shells ("-zsh" etc) — strip it.
    return s.fg_cmd.replace(/^-/, "");
  }
  if (s.ui_state === "busy" && s.busy_type) return s.busy_type;
  if (s.ui_state === "service") return "service";
  return "idle";
}

interface Group {
  key: string;
  pwd: string;
  pretty: string;
  sessions: SessionInfo[];
  state: string;
  isClaudeFallback: boolean;
}

function groupSessions(sessions: SessionInfo[], home?: string): Group[] {
  // Find pid=0 (legacy Claude shared virtual) — only used as a fallback bucket.
  const claudeVirtual = sessions.find((s) => s.pid === 0);
  const anyShellHasClaude = sessions.some((s) => s.pid !== 0 && s.has_claude);

  // Group real shells by PWD. If pwd is unknown (rare — scanner couldn't read
  // cwd), fall back to title so the row still shows something meaningful
  // instead of vanishing.
  const byKey = new Map<string, { pwd: string; list: SessionInfo[] }>();
  for (const s of sessions) {
    if (s.pid === 0) continue;       // legacy shared virtual
    if (s.is_claude_proc) continue;  // claude process — represented by its parent shell
    const key = s.pwd || s.title || String(s.pid);
    if (!byKey.has(key)) byKey.set(key, { pwd: s.pwd, list: [] });
    byKey.get(key)!.list.push(s);
  }

  const groups: Group[] = [];
  for (const [key, { pwd, list }] of byKey.entries()) {
    const pretty = pwd
      ? prettyPath(pwd, home)
      : list[0].title || `pid ${list[0].pid}`;
    groups.push({
      key,
      pwd,
      pretty,
      sessions: list,
      state: groupState(list),
      isClaudeFallback: false,
    });
  }

  // Active groups first, then alphabetical.
  groups.sort((a, b) => {
    const pa = statePriority[a.state] ?? 0;
    const pb = statePriority[b.state] ?? 0;
    if (pa !== pb) return pb - pa;
    return a.pretty.localeCompare(b.pretty);
  });

  // Fallback: if proc_scan found no claude but hooks report one, show it.
  if (claudeVirtual && !anyShellHasClaude) {
    groups.push({
      key: "claude-virtual",
      pwd: "",
      pretty: "Claude Code",
      sessions: [claudeVirtual],
      state: claudeVirtual.ui_state,
      isClaudeFallback: true,
    });
  }

  return groups;
}

// Detect user's home dir from the first absolute path we see.
function detectHome(sessions: SessionInfo[]): string | undefined {
  for (const s of sessions) {
    const m = s.pwd.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
    if (m) return m[1];
  }
  return undefined;
}

/** The watchdog auto-flips `ui_state` from "service" back to "idle" after 2
 *  seconds (so the global pill doesn't lock blue while a dev server runs).
 *  But `busy_type` stays "service" until precmd fires — which long-running
 *  servers never do. So in the dropdown we trust busy_type and re-assert the
 *  service color for the whole lifetime of the dev server. */
function reflectActiveServices(sessions: SessionInfo[]): SessionInfo[] {
  return sessions.map((s) =>
    s.busy_type === "service" && s.ui_state === "idle"
      ? { ...s, ui_state: "service" }
      : s,
  );
}

/** Claude Code's busy/idle state lives on a separate session — either the
 *  per-claude PID (after the pid=$PPID hook migration) or the legacy shared
 *  pid=0. Overlay that state onto each shell with has_claude=true so the
 *  dropdown dot reflects what that specific Claude is doing.
 *
 *  Each claude-hosting shell gets the state of ITS OWN claude_pid session, so
 *  two Claude tabs no longer turn red together when only one is busy. */
function overlayClaudeState(sessions: SessionInfo[]): SessionInfo[] {
  const sessionByPid = new Map<number, SessionInfo>();
  for (const s of sessions) sessionByPid.set(s.pid, s);

  return sessions.map((s) => {
    if (!s.has_claude) return s;

    // Prefer the dedicated per-claude PID; fall back to legacy pid=0.
    const claudeSession =
      (s.claude_pid != null && sessionByPid.get(s.claude_pid)) ||
      sessionByPid.get(0);

    if (!claudeSession) return s;
    const claudeP = statePriority[claudeSession.ui_state] ?? 0;
    const ownP = statePriority[s.ui_state] ?? 0;
    return ownP >= claudeP ? s : { ...s, ui_state: claudeSession.ui_state };
  });
}

export function StatusPill({ status, glow }: StatusPillProps) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { enabled: sessionListEnabled } = useSessionList();
  const { collapsed, toggle: toggleCollapsed } = useCollapsedSessionGroups();

  const toggleOpen = async (e: React.MouseEvent) => {
    if (!sessionListEnabled) return; // feature disabled — pill is not clickable
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const list = await fetchSessions();
    const overlaid = overlayClaudeState(reflectActiveServices(list));
    setGroups(groupSessions(overlaid, detectHome(overlaid)));
    setOpen(true);
  };

  // If the user disables the feature while the dropdown is open, close it.
  useEffect(() => {
    if (!sessionListEnabled && open) setOpen(false);
  }, [sessionListEnabled, open]);

  // Live updates while the dropdown is open. Hybrid strategy:
  //   • Listen to `status-changed` Tauri events for instant busy/idle reflection
  //   • Plus a 3s fallback poll for proc_scan-driven changes (new tabs, cd,
  //     fg_cmd updates) that don't fire status-changed
  // Costs ~5ms per refresh; total well under 1Hz average while open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const refresh = async () => {
      const list = await fetchSessions();
      if (cancelled) return;
      const overlaid = overlayClaudeState(reflectActiveServices(list));
      setGroups(groupSessions(overlaid, detectHome(overlaid)));
    };

    // Subscribe to backend state-change events.
    const unlistenP = listen("status-changed", () => {
      void refresh();
    });

    // Fallback poll covers OS-scan changes that don't emit status-changed.
    const id = setInterval(refresh, 3000);

    return () => {
      cancelled = true;
      clearInterval(id);
      unlistenP.then((fn) => fn());
    };
  }, [open]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="pill-wrap" data-testid="status-pill-wrap">
      <div
        data-testid="status-pill"
        className={`pill ${glow ? "neon-glow" : ""} ${status === "busy" ? "neon-busy" : ""} ${open ? "is-open" : ""} ${!sessionListEnabled ? "no-dropdown" : ""}`}
        onClick={toggleOpen}
      >
        <span data-testid="status-dot" className={dotClassMap[status] ?? "dot searching"} />
        <span data-testid="status-label" className="label">{labelMap[status] ?? "Searching..."}</span>
        {sessionListEnabled && (
          <span className={`caret ${open ? "up" : ""}`} aria-hidden="true" />
        )}
      </div>

      {sessionListEnabled && open && (
        <div data-testid="session-dropdown" className="session-dropdown" role="menu">
          {groups.length === 0 ? (
            <div className="session-empty">No active terminals</div>
          ) : (
            groups.map((g) => {
              const isCollapsed = collapsed.has(g.key);
              const headContent = (
                <>
                  {!g.isClaudeFallback && (
                    <span className="session-group-caret" aria-hidden="true" />
                  )}
                  <span className={`dot small ${g.state}`} />
                  <span className="session-group-title-row">
                    <span className="session-group-title">
                      {groupBasename(g)}
                    </span>
                    {g.pretty && g.pretty !== groupBasename(g) && (
                      <span
                        className="session-group-info"
                        data-path={g.pretty}
                        aria-label={`Full path: ${g.pretty}`}
                      >
                        ?
                      </span>
                    )}
                  </span>
                  {g.sessions.length > 1 && (
                    <span className="session-count">{g.sessions.length}</span>
                  )}
                </>
              );
              return (
              <div
                key={g.key}
                className={`session-group ${g.isClaudeFallback ? "claude" : ""}`}
                data-testid={`session-group-${g.key}`}
              >
                {g.isClaudeFallback ? (
                  <div className="session-group-head">{headContent}</div>
                ) : (
                  <button
                    type="button"
                    className={`session-group-head clickable ${isCollapsed ? "collapsed" : ""}`}
                    data-testid={`session-group-head-${g.key}`}
                    aria-expanded={!isCollapsed}
                    aria-controls={`session-children-${g.key}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleCollapsed(g.key);
                    }}
                  >
                    {headContent}
                  </button>
                )}

                {!g.isClaudeFallback && !isCollapsed && (
                  <div
                    className="session-children"
                    id={`session-children-${g.key}`}
                  >
                    {g.sessions.map((s) => (
                      <button
                        key={s.pid}
                        type="button"
                        className={`session-child ${s.has_claude ? "has-claude" : ""}`}
                        data-testid={`session-item-${s.pid}`}
                        title="Click to bring this terminal to the front"
                        onClick={(e) => {
                          e.stopPropagation();
                          invoke("focus_terminal", { pid: s.pid, tty: s.tty || null })
                            .catch((err) => console.error("[focus_terminal]", err));
                          setOpen(false);
                        }}
                      >
                        <span className={`dot small ${s.ui_state}`} />
                        <span className="session-child-label-row">
                          <span className="session-child-label">{shellLabel(s)}</span>
                          {s.has_claude && (
                            <span
                              className="session-child-claude"
                              aria-label="Claude Code running"
                            />
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
