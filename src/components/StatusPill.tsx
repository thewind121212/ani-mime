import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  getCurrentWindow,
  LogicalPosition,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Status } from "../types/status";
import { Chat } from "./Chat";
import { fetchSessions, type SessionInfo } from "../hooks/useSessions";
import { useSessionList } from "../hooks/useSessionList";
import { useSessionGroupCount } from "../hooks/useSessionGroupCount";
import { useLanList } from "../hooks/useLanList";
import { useSpotifyConnected } from "../hooks/useSpotify";
import { useTelegram } from "../hooks/useTelegram";
import { useOpacity } from "../hooks/useOpacity";
import { useCollapsedSessionGroups } from "../hooks/useCollapsedSessionGroups";
import { usePeers } from "../hooks/usePeers";
import { useSoundSettings } from "../hooks/useSoundSettings";
import { playAudio } from "../utils/audio";
import "../styles/status-pill.css";

interface StatusPillProps {
  status: Status;
  glow?: boolean;
  /**
   * Disables the lan (peer) icon — used during a visit when the user
   * can't start a second one. The task icon (session list) is always
   * available regardless of visiting state.
   */
  disabled?: boolean;
  /**
   * Notifies parent when the session-list dropdown open state changes.
   * App uses this to pause window auto-size and manually grow the Tauri
   * window while the fixed-positioned dropdown is visible.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Notifies parent when the inline chat panel open state changes.
   * Same purpose as `onOpenChange` but for chat: App grows the window
   * around the chat panel rather than letting auto-size shrink it back.
   */
  onChatOpenChange?: (open: boolean) => void;
}

const dotClassMap: Record<Status, string> = {
  service: "dot service",
  busy: "dot busy",
  idle: "dot idle",
  disconnected: "dot disconnected",
  initializing: "dot initializing",
  searching: "dot searching",
  waiting: "dot waiting",
  visiting: "dot visiting",
};

const labelMap: Record<Status, string> = {
  service: "Service",
  busy: "Working...",
  idle: "Free",
  disconnected: "Sleep",
  initializing: "Initializing...",
  searching: "Searching...",
  waiting: "Awaiting permission...",
  visiting: "Visiting...",
};

// Priority for picking a group's summary state: waiting > busy > service > idle.
// Waiting tops busy because a permission prompt blocks the user — it's louder
// than work that can keep running on its own.
const statePriority: Record<string, number> = {
  waiting: 4,
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
  return g.pretty || g.sessions[0]?.title || "";
}

/** Human-readable label for what's happening in a single shell. */
function shellLabel(s: SessionInfo): string {
  if (s.has_claude) return "claude";
  if (s.has_codex) return "codex";
  if (s.fg_cmd) {
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
  const claudeVirtual = sessions.find((s) => s.pid === 0);
  const anyShellHasClaude = sessions.some((s) => s.pid !== 0 && s.has_claude);

  const byKey = new Map<string, { pwd: string; list: SessionInfo[] }>();
  for (const s of sessions) {
    if (s.pid === 0) continue;
    if (s.is_claude_proc) continue;
    if (s.is_codex_proc) continue;
    const key = s.pwd || s.title || String(s.pid);
    if (!byKey.has(key)) byKey.set(key, { pwd: s.pwd, list: [] });
    byKey.get(key)!.list.push(s);
  }

  const groups: Group[] = [];
  for (const [key, { pwd, list }] of byKey.entries()) {
    const pretty = pwd
      ? prettyPath(pwd, home)
      : list[0].title || `pid ${list[0].pid}`;
    // Sort children within a group by pid so row order stays stable
    // across refreshes. The backend returns sessions from a HashMap,
    // so iteration order can change between invocations — without this
    // sort, rows can swap under the cursor every 3s refresh and the
    // CSS :hover highlight flickers off the row you're hovering.
    list.sort((a, b) => a.pid - b.pid);
    groups.push({
      key,
      pwd,
      pretty,
      sessions: list,
      state: groupState(list),
      isClaudeFallback: false,
    });
  }

  groups.sort((a, b) => {
    const pa = statePriority[a.state] ?? 0;
    const pb = statePriority[b.state] ?? 0;
    if (pa !== pb) return pb - pa;
    return a.pretty.localeCompare(b.pretty);
  });

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

function detectHome(sessions: SessionInfo[]): string | undefined {
  for (const s of sessions) {
    const m = s.pwd.match(/^(\/Users\/[^/]+|\/home\/[^/]+)/);
    if (m) return m[1];
  }
  return undefined;
}

function reflectActiveServices(sessions: SessionInfo[]): SessionInfo[] {
  return sessions.map((s) =>
    s.busy_type === "service" && s.ui_state === "idle"
      ? { ...s, ui_state: "service" }
      : s,
  );
}

function overlayClaudeState(sessions: SessionInfo[]): SessionInfo[] {
  const sessionByPid = new Map<number, SessionInfo>();
  for (const s of sessions) sessionByPid.set(s.pid, s);

  return sessions.map((s) => {
    // Promote whichever child (claude or codex) has the higher state
    // priority over the parent shell, so a busy AI tool drives the
    // shell row even when the shell itself is at an idle prompt.
    let promoted = s;
    if (s.has_claude) {
      const claudeSession =
        (s.claude_pid != null && sessionByPid.get(s.claude_pid)) ||
        sessionByPid.get(0);
      if (claudeSession) {
        const claudeP = statePriority[claudeSession.ui_state] ?? 0;
        const ownP = statePriority[promoted.ui_state] ?? 0;
        if (ownP < claudeP) promoted = { ...promoted, ui_state: claudeSession.ui_state };
      }
    }
    if (s.has_codex) {
      const codexSession = s.codex_pid != null ? sessionByPid.get(s.codex_pid) : undefined;
      if (codexSession) {
        const codexP = statePriority[codexSession.ui_state] ?? 0;
        const curP = statePriority[promoted.ui_state] ?? 0;
        if (curP < codexP) promoted = { ...promoted, ui_state: codexSession.ui_state };
      }
    }
    return promoted;
  });
}

/** Width of the peer-list popover window — must match tauri.conf.json. */
const POPOVER_WIDTH = 280;
/** Negative offset overlaps the popover's 12px shadow-buffer padding. */
const POPOVER_TOP_GAP = -8;

/** Inline chat panel — total Tauri window height while open. Sized to fit
 *  the chat content + the pill above. App.tsx grows the window to this
 *  before the panel renders so the chat fits without clipping. Must stay
 *  in sync with CHAT_DROPDOWN_WINDOW_HEIGHT in App.tsx. */
const CHAT_DROPDOWN_WINDOW_HEIGHT = 600;

/** Spotify popover — must match tauri.conf.json width. */
const SPOTIFY_WIDTH = 320;
const SPOTIFY_TOP_GAP = -8;

async function computePopoverScreenPos(
  anchorEl: HTMLElement
): Promise<LogicalPosition> {
  const main = getCurrentWindow();
  const mainPos = await main.outerPosition();
  const scale = await main.scaleFactor();

  const pill = anchorEl.closest(".pill") ?? anchorEl;
  const rect = (pill as HTMLElement).getBoundingClientRect();

  const mainLogical =
    mainPos instanceof PhysicalPosition ? mainPos.toLogical(scale) : mainPos;

  const centerX = mainLogical.x + rect.left + rect.width / 2;
  const left = centerX - POPOVER_WIDTH / 2;
  const top = mainLogical.y + rect.bottom + POPOVER_TOP_GAP;
  return new LogicalPosition(Math.round(left), Math.round(top));
}

async function computeSpotifyScreenPos(
  anchorEl: HTMLElement
): Promise<LogicalPosition> {
  const main = getCurrentWindow();
  const mainPos = await main.outerPosition();
  const scale = await main.scaleFactor();

  const pill = anchorEl.closest(".pill") ?? anchorEl;
  const rect = (pill as HTMLElement).getBoundingClientRect();

  const mainLogical =
    mainPos instanceof PhysicalPosition ? mainPos.toLogical(scale) : mainPos;

  const centerX = mainLogical.x + rect.left + rect.width / 2;
  const left = centerX - SPOTIFY_WIDTH / 2;
  const top = mainLogical.y + rect.bottom + SPOTIFY_TOP_GAP;
  return new LogicalPosition(Math.round(left), Math.round(top));
}

export function StatusPill({ status, glow, disabled = false, onOpenChange, onChatOpenChange }: StatusPillProps) {
  // --- Session list state ---
  const [sessionOpen, setSessionOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [dropdownTop, setDropdownTop] = useState(0);
  const [dropdownMaxHeight, setDropdownMaxHeight] = useState(280);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { enabled: sessionListEnabled } = useSessionList();
  const sessionCount = useSessionGroupCount(sessionListEnabled);
  const { collapsed, toggle: toggleCollapsed } = useCollapsedSessionGroups();

  // --- Peer popover state ---
  const peers = usePeers();
  const { enabled: lanListEnabled } = useLanList();
  const telegram = useTelegram();
  const [statusTipVisible, setStatusTipVisible] = useState(false);
  const statusTipTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { opacity: statusOpacity } = useOpacity("status");
  const [peerOpen, setPeerOpen] = useState(false);
  const lanButtonRef = useRef<HTMLButtonElement>(null);

  // --- Chat panel state (inline, mirrors session-list dropdown) ---
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDropdownTop, setChatDropdownTop] = useState(0);
  const [chatDropdownMaxHeight, setChatDropdownMaxHeight] = useState(460);
  const chatButtonRef = useRef<HTMLButtonElement>(null);

  // --- Spotify popover state ---
  const { connected: spotifyConnected } = useSpotifyConnected();
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const spotifyButtonRef = useRef<HTMLButtonElement>(null);

  // UI click feedback — short tap on either pill button. Gated by the
  // master sound toggle so fully silencing the app silences these too.
  const soundSettings = useSoundSettings();
  const playClickTap = () => {
    if (soundSettings.master) playAudio("tap");
  };

  // --- Session-group path tooltip (portaled to body so the dropdown's
  // overflow:auto doesn't clip it when it renders above the first row). ---
  const [pathTooltip, setPathTooltip] = useState<{
    text: string;
    anchorX: number;
    anchorTop: number;
    anchorBottom: number;
  } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const showPathTooltip = (el: HTMLElement, text: string) => {
    const rect = el.getBoundingClientRect();
    setPathTooltip({
      text,
      anchorX: rect.left + rect.width / 2,
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
    });
  };
  const hidePathTooltip = () => setPathTooltip(null);

  // Position the tooltip after render so we can measure its actual size and
  // clamp it inside the window — paths are often wider than the dropdown,
  // which would otherwise leave the tooltip clipped by the window edge.
  useLayoutEffect(() => {
    if (!pathTooltip) return;
    const el = tooltipRef.current;
    if (!el) return;

    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const MARGIN = 8;
    const GAP = 6;
    const vw = window.innerWidth;

    const placeAbove = pathTooltip.anchorTop >= h + GAP + MARGIN;
    const y = placeAbove
      ? pathTooltip.anchorTop - h - GAP
      : pathTooltip.anchorBottom + GAP;

    let x = pathTooltip.anchorX - w / 2;
    x = Math.max(MARGIN, Math.min(x, vw - w - MARGIN));

    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.setProperty("--arrow-x", `${Math.round(pathTooltip.anchorX - x)}px`);
    el.classList.toggle("below", !placeAbove);
    el.style.visibility = "visible";
  }, [pathTooltip]);

  useEffect(() => {
    onOpenChange?.(sessionOpen);
  }, [sessionOpen, onOpenChange]);

  useEffect(() => {
    if (!sessionOpen) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.bottom + 6;
    setDropdownTop(top);
    // The window grows to 400 tall when the session list opens (see
    // SESSION_DROPDOWN_WINDOW_HEIGHT in App.tsx). Cap the dropdown's
    // max-height so it fits between `top` and the window's bottom —
    // the 10px tail leaves room for the shadow buffer. overflow-y:auto
    // (in status-pill.css) scrolls when the list is taller.
    const SESSION_WINDOW_HEIGHT = 400;
    const BOTTOM_MARGIN = 10;
    setDropdownMaxHeight(
      Math.max(120, SESSION_WINDOW_HEIGHT - top - BOTTOM_MARGIN)
    );
  }, [sessionOpen]);

  const toggleSession = async (e: React.MouseEvent) => {
    if (!sessionListEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    playClickTap();
    if (sessionOpen) {
      setSessionOpen(false);
      return;
    }
    // Only one overlay at a time — close every other dropdown before
    // showing the session list. Mirrors the close logic in toggleChat
    // / toggleSpotify so any pair of buttons interleaves cleanly.
    if (peerOpen) {
      const popover = await WebviewWindow.getByLabel("peer-list");
      await popover?.hide().catch(() => {});
      setPeerOpen(false);
    }
    if (chatOpen) setChatOpen(false);
    if (spotifyOpen) {
      const win = await WebviewWindow.getByLabel("spotify-player");
      await win?.hide().catch(() => {});
      setSpotifyOpen(false);
    }
    const list = await fetchSessions();
    const overlaid = overlayClaudeState(reflectActiveServices(list));
    setGroups(groupSessions(overlaid, detectHome(overlaid)));
    setSessionOpen(true);
  };

  useEffect(() => {
    if (!sessionListEnabled && sessionOpen) setSessionOpen(false);
  }, [sessionListEnabled, sessionOpen]);

  // Live session refresh while dropdown is open. Event-driven via
  // `sessions-changed` (emitted by the backend only when the session set or
  // any UI-relevant field changes) — no polling.
  useEffect(() => {
    if (!sessionOpen) return;
    let cancelled = false;

    const refresh = async () => {
      const list = await fetchSessions();
      if (cancelled) return;
      const overlaid = overlayClaudeState(reflectActiveServices(list));
      setGroups(groupSessions(overlaid, detectHome(overlaid)));
    };

    const unlistenP = listen("sessions-changed", () => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unlistenP.then((fn) => fn());
    };
  }, [sessionOpen]);

  // Session dropdown closes ONLY on Escape, pill-toggle, or item click.
  useEffect(() => {
    if (!sessionOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSessionOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sessionOpen]);

  // --- Peer popover effects ---
  useEffect(() => {
    if (!disabled && lanListEnabled) return;
    void (async () => {
      const popover = await WebviewWindow.getByLabel("peer-list");
      await popover?.hide().catch(() => {});
    })();
    setPeerOpen(false);
  }, [disabled, lanListEnabled]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const popover = await WebviewWindow.getByLabel("peer-list");
      if (!popover) return;
      const fn = await popover.onFocusChanged(({ payload: focused }) => {
        if (!focused) setPeerOpen(false);
      });
      unlisten = fn;
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!peerOpen) return;
    const main = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let raf = 0;

    (async () => {
      const popover = await WebviewWindow.getByLabel("peer-list");
      if (!popover || cancelled) return;
      const handler = async () => {
        if (!lanButtonRef.current) return;
        if (!(await popover.isVisible())) return;
        const pos = await computePopoverScreenPos(lanButtonRef.current);
        await popover.setPosition(pos).catch(() => {});
      };
      // Coalesce drag move bursts to one IPC per frame. Without this,
      // every native move event fires three async IPCs (outerPosition,
      // scaleFactor, setPosition) and the popover visibly trails the
      // pill during drag. macOS additionally tracks the parent natively
      // via the `parent` config, so this throttle is mostly redundant
      // there but still required on Linux/Windows.
      const throttled = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          void handler();
        });
      };
      const fn = await main.onMoved(throttled);
      unlisten = fn;
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      unlisten?.();
    };
  }, [peerOpen]);

  // --- Chat panel effects ---
  // Chat is rendered inline as a fixed-position panel inside the main
  // window — mirrors the session-list dropdown. No separate WebviewWindow,
  // so drag preserves position natively (the chat moves with the main
  // window) and the dog is not occluded.

  useEffect(() => {
    onChatOpenChange?.(chatOpen);
  }, [chatOpen, onChatOpenChange]);

  // Compute dropdown top + max height when chat opens. Top = below pill;
  // max-height clamps the panel inside the grown Tauri window.
  useEffect(() => {
    if (!chatOpen) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const top = rect.bottom + 6;
    setChatDropdownTop(top);
    const BOTTOM_MARGIN = 10;
    setChatDropdownMaxHeight(
      Math.max(200, CHAT_DROPDOWN_WINDOW_HEIGHT - top - BOTTOM_MARGIN)
    );
  }, [chatOpen]);

  // Close on Escape — mirrors the session-list close-on-Escape behavior.
  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChatOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen]);

  // Spotify popover — hide on blur, reposition on main window move.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const win = await WebviewWindow.getByLabel("spotify-player");
      if (!win) return;
      const fn = await win.onFocusChanged(({ payload: focused }) => {
        if (!focused) {
          void win.hide();
          setSpotifyOpen(false);
        }
      });
      unlisten = fn;
    })();
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!spotifyOpen) return;
    const main = getCurrentWindow();
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let raf = 0;

    (async () => {
      const win = await WebviewWindow.getByLabel("spotify-player");
      if (!win || cancelled) return;
      const handler = async () => {
        if (!spotifyButtonRef.current) return;
        if (!(await win.isVisible())) return;
        const pos = await computeSpotifyScreenPos(spotifyButtonRef.current);
        await win.setPosition(pos).catch(() => {});
      };
      const throttled = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          void handler();
        });
      };
      const fn = await main.onMoved(throttled);
      unlisten = fn;
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      unlisten?.();
    };
  }, [spotifyOpen]);

  // Hide popover when Spotify gets disconnected (e.g. user clicked Disconnect).
  useEffect(() => {
    if (spotifyConnected) return;
    void (async () => {
      const win = await WebviewWindow.getByLabel("spotify-player");
      await win?.hide().catch(() => {});
    })();
    setSpotifyOpen(false);
  }, [spotifyConnected]);

  const toggleSpotify = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!spotifyButtonRef.current) return;
    playClickTap();

    const win = await WebviewWindow.getByLabel("spotify-player");
    if (!win) {
      console.error("[status-pill] spotify-player window not found");
      return;
    }

    const visible = await win.isVisible();
    if (visible) {
      await win.hide();
      setSpotifyOpen(false);
      return;
    }

    if (sessionOpen) setSessionOpen(false);
    if (peerOpen) {
      const peerWin = await WebviewWindow.getByLabel("peer-list");
      await peerWin?.hide().catch(() => {});
      setPeerOpen(false);
    }
    if (chatOpen) setChatOpen(false);

    const pos = await computeSpotifyScreenPos(spotifyButtonRef.current);
    await win.setPosition(pos);
    await win.show();
    await win.setFocus();
    setSpotifyOpen(true);
  };

  const toggleChat = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!chatButtonRef.current) return;
    playClickTap();

    if (chatOpen) {
      setChatOpen(false);
      return;
    }

    // Only one overlay at a time — close session dropdown + peer popover
    // + spotify popover before opening chat. Mirrors the toggleSession
    // and togglePeer paths.
    if (sessionOpen) setSessionOpen(false);
    if (peerOpen) {
      const peerWin = await WebviewWindow.getByLabel("peer-list");
      await peerWin?.hide().catch(() => {});
      setPeerOpen(false);
    }
    if (spotifyOpen) {
      const win = await WebviewWindow.getByLabel("spotify-player");
      await win?.hide().catch(() => {});
      setSpotifyOpen(false);
    }

    setChatOpen(true);
  };

  const togglePeer = async (e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    if (!lanButtonRef.current) return;
    playClickTap();

    const popover = await WebviewWindow.getByLabel("peer-list");
    if (!popover) {
      console.error("[status-pill] peer-list window not found");
      return;
    }

    const visible = await popover.isVisible();
    if (visible) {
      await popover.hide();
      setPeerOpen(false);
      return;
    }

    // Only one overlay at a time — close every other dropdown before
    // showing the peer list.
    if (sessionOpen) setSessionOpen(false);
    if (chatOpen) setChatOpen(false);
    if (spotifyOpen) {
      const win = await WebviewWindow.getByLabel("spotify-player");
      await win?.hide().catch(() => {});
      setSpotifyOpen(false);
    }

    const pos = await computePopoverScreenPos(lanButtonRef.current);
    await popover.setPosition(pos);
    await popover.show();
    await popover.setFocus();
    setPeerOpen(true);
  };

  const peerTooltip = disabled
    ? "Already visiting someone"
    : peers.length === 0
      ? "No peers nearby"
      : `${peers.length} peer${peers.length === 1 ? "" : "s"} nearby`;

  return (
    <div ref={wrapRef} className="pill-wrap" data-testid="status-pill-wrap" style={{ opacity: statusOpacity }}>
      <div
        data-testid="status-pill"
        className={`pill ${glow ? "neon-glow" : ""} ${status === "busy" ? "neon-busy" : ""} ${status === "waiting" ? "neon-waiting" : ""} ${sessionOpen || peerOpen ? "is-open" : ""} ${!lanListEnabled ? "no-lan" : ""} ${!sessionListEnabled ? "no-tasks" : ""}`}
      >
        <button
          type="button"
          data-testid="status-dot"
          className={`dot-button ${dotClassMap[status] ?? "dot searching"}`}
          onClick={() => {
            setStatusTipVisible(true);
            clearTimeout(statusTipTimerRef.current);
            statusTipTimerRef.current = setTimeout(
              () => setStatusTipVisible(false),
              2000
            );
          }}
          aria-label={`Status: ${labelMap[status] ?? "Searching..."}`}
          title={labelMap[status] ?? "Searching..."}
        />
        {statusTipVisible && (
          <span data-testid="status-tip" className="status-tip" role="status">
            {labelMap[status] ?? "Searching..."}
          </span>
        )}

        <div className="pill-actions" data-testid="pill-actions">
          {sessionListEnabled && (
            <button
              type="button"
              data-testid="pill-action-task"
              className={`pill-action-btn ${sessionOpen ? "is-active" : ""}`}
              onClick={toggleSession}
              aria-label={`Show sessions list (${sessionCount})`}
              aria-expanded={sessionOpen}
              title="Session list"
            >
              <svg
                className="pill-action-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-7 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7 9h10v2H7V9zm0 4h10v2H7v-2zm0 4h7v2H7v-2z" />
              </svg>
              {sessionCount > 0 && (
                <span className="pill-action-badge" data-testid="pill-action-task-badge">
                  {sessionCount}
                </span>
              )}
            </button>
          )}

          <button
            ref={chatButtonRef}
            type="button"
            data-testid="pill-action-chat"
            className={`pill-action-btn ${chatOpen ? "is-active" : ""}`}
            onClick={toggleChat}
            aria-label="Coding helper chat"
            aria-expanded={chatOpen}
            title="Chat"
          >
            <svg
              className="pill-action-icon"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
            </svg>
          </button>

          {spotifyConnected && (
            <button
              ref={spotifyButtonRef}
              type="button"
              data-testid="pill-action-spotify"
              className={`pill-action-btn ${spotifyOpen ? "is-active" : ""}`}
              onClick={toggleSpotify}
              aria-label="Spotify player"
              aria-expanded={spotifyOpen}
              title="Spotify"
            >
              <svg
                className="pill-action-icon"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.5 14.4c-.2.3-.5.4-.8.2-2.2-1.3-4.9-1.6-8.2-.9-.3.1-.6-.1-.7-.4-.1-.3.1-.6.4-.7 3.5-.8 6.6-.4 9 1 .3.2.4.5.3.8zm1.2-2.7c-.2.3-.6.4-.9.3-2.5-1.5-6.3-2-9.3-1.1-.4.1-.8-.1-.9-.5-.1-.4.1-.8.5-.9 3.4-1 7.6-.5 10.4 1.3.4.2.5.6.2.9zm.1-2.8C14.7 9.1 9 8.9 6.1 9.8c-.4.1-.9-.1-1-.6-.1-.5.1-.9.6-1 3.3-1 9.6-.8 13.3 1.4.4.3.5.8.3 1.2-.3.4-.8.5-1.5.1z"/>
              </svg>
            </button>
          )}

          {lanListEnabled && (
          <button
            ref={lanButtonRef}
            type="button"
            data-testid="pill-action-lan"
            className={`pill-action-btn ${peerOpen ? "is-active" : ""} ${peers.length > 0 ? "has-peers" : ""}`}
            onClick={togglePeer}
            disabled={disabled}
            aria-label={`Mime Around You (${peers.length})`}
            aria-expanded={peerOpen}
            title={peerTooltip}
          >
            <svg
              className="pill-action-icon"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M9 2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2v3H5a1 1 0 0 0-1 1v1h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H6v-1h12v1h-1a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1h-2v-1a1 1 0 0 0-1-1h-6V9h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1H9z" />
            </svg>
            {peers.length > 0 && (
              <span className="pill-action-badge" data-testid="pill-action-lan-badge">
                {peers.length}
              </span>
            )}
          </button>
          )}

          <button
            type="button"
            data-testid="pill-action-push"
            className={`pill-action-btn push-toggle ${telegram.pushEnabled ? "is-active push-on" : ""}`}
            onClick={() => {
              if (!telegram.configured) return;
              telegram.setPushEnabled(!telegram.pushEnabled);
            }}
            disabled={!telegram.configured}
            aria-label={
              telegram.configured
                ? telegram.pushEnabled
                  ? "Telegram push: on"
                  : "Telegram push: off"
                : "Telegram push (configure in Settings)"
            }
            aria-pressed={telegram.pushEnabled}
            title={
              telegram.configured
                ? telegram.pushEnabled
                  ? "Telegram push enabled — click to mute"
                  : "Telegram push muted — click to enable"
                : "Configure Telegram in Settings first"
            }
          >
            <svg
              className="pill-action-icon"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M21.5 4.3 2.7 11.4c-.9.3-.9 1.6 0 1.9l4.6 1.6 1.7 5.6c.2.7 1 .9 1.5.4l2.6-2.5 4.7 3.5c.6.5 1.6.1 1.7-.7l2.4-15.4c.1-.7-.6-1.3-1.4-1zM9.6 14.8 18 7.2l-6.8 8.1-.4 3.3-1.2-3.8z" />
            </svg>
          </button>
        </div>
      </div>

      {sessionListEnabled && sessionOpen && (
        <div
          data-testid="session-dropdown"
          className="session-dropdown"
          role="menu"
          style={{
            top: `${dropdownTop}px`,
            maxHeight: `${dropdownMaxHeight}px`,
          }}
        >
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
                        aria-label={`Full path: ${g.pretty}`}
                        onMouseEnter={(e) =>
                          showPathTooltip(e.currentTarget, g.pretty)
                        }
                        onMouseLeave={hidePathTooltip}
                      >
                        ?
                      </span>
                    )}
                  </span>
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
                          className={`session-child ${s.has_claude ? "has-claude" : ""} ${s.has_codex ? "has-codex" : ""}`}
                          data-testid={`session-item-${s.pid}`}
                          title="Click to bring this terminal to the front"
                          onClick={(e) => {
                            e.stopPropagation();
                            invoke("focus_terminal", { pid: s.pid, tty: s.tty || null })
                              .catch((err) => console.error("[focus_terminal]", err));
                            setSessionOpen(false);
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
                            {s.has_codex && (
                              <span
                                className="session-child-codex"
                                aria-label="Codex CLI running"
                              >
                                ⓒ
                              </span>
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

      {chatOpen && (
        <div
          data-testid="chat-dropdown"
          className="chat-dropdown"
          style={{
            top: `${chatDropdownTop}px`,
            // Explicit height (not max-height) so the inner flex
            // children inherit a determinate size and chat-messages
            // can actually scroll. See .chat-dropdown comment in
            // chat.css for why max-height collapses inner scroll.
            height: `${chatDropdownMaxHeight}px`,
          }}
        >
          <Chat onClose={() => setChatOpen(false)} />
        </div>
      )}

      {pathTooltip &&
        createPortal(
          <div
            ref={tooltipRef}
            className="session-path-tooltip"
            style={{ visibility: "hidden" }}
            role="tooltip"
          >
            {pathTooltip.text}
          </div>,
          document.body
        )}
    </div>
  );
}
