import { Mascot } from "./components/Mascot";
import { StatusPill } from "./components/StatusPill";
import { SpeechBubble } from "./components/SpeechBubble";
import { VisitorDog } from "./components/VisitorDog";
import { DevTag } from "./components/DevTag";
import { DevBuildBadge } from "./components/DevBuildBadge";
import { EffectOverlay } from "./effects";
import { useStatus } from "./hooks/useStatus";
import { useDrag } from "./hooks/useDrag";
import { useTheme } from "./hooks/useTheme";
import { useBubble } from "./hooks/useBubble";
import { useVisitors } from "./hooks/useVisitors";
import { useScale } from "./hooks/useScale";
import { useDevMode } from "./hooks/useDevMode";
import { useDevAppBounds } from "./hooks/useDevAppBounds";
import { useDevContainerBounds } from "./hooks/useDevContainerBounds";
import { useDevRootBounds } from "./hooks/useDevRootBounds";
import { useWindowAutoSize } from "./hooks/useWindowAutoSize";
import { useSoundSettings } from "./hooks/useSoundSettings";
import { useSoundOverrides } from "./hooks/useSoundOverrides";
import { useCustomSounds } from "./hooks/useCustomSounds";
import { findStatusCase, findVisitCase, resolveSound, playResolvedSound } from "./constants/sounds";
import { stopAudio } from "./utils/audio";
import type { Status } from "./types/status";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
} from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useInstallPrompt } from "./hooks/useInstallPrompt";
import { InstallPromptDialog } from "./components/InstallPromptDialog";
import "./styles/theme.css";
import "./styles/app.css";
import "./styles/install-prompt.css";

// Total window height while the session-list dropdown is open.
// The dropdown itself is position: fixed so it doesn't inflate the
// container; StatusPill caps the dropdown's max-height to
// (this value - dropdownTop - bottom margin) so long lists scroll
// inside this budget instead of running past the window edge.
const SESSION_DROPDOWN_WINDOW_HEIGHT = 400;
const SESSION_DROPDOWN_MIN_WIDTH = 320;

// Chat dropdown — total Tauri window height while the chat panel is
// open. Width stays at whatever the container's current size is — the
// panel adapts to fit (no horizontal grow, no horizontal shift, no
// dog flash). Must stay in sync with CHAT_DROPDOWN_WINDOW_HEIGHT in
// StatusPill.tsx (panel max-height clamps against this).
const CHAT_DROPDOWN_WINDOW_HEIGHT = 600;

// Base container padding, duplicated from app.css. Used by the bubble
// window-grow logic to compute how much extra padding the container
// needs so the bubble fits inside the window without clipping.
const BASE_PAD_HORIZONTAL = 50; // padding-left + padding-right base
// The sprite's native frame width (css px, pre-scale).
const SPRITE_NATIVE_WIDTH = 128;
// Baseline root width — see app.css .container min-width. The bubble
// grow effect only kicks in horizontally when the bubble exceeds this,
// because anything narrower already fits inside the min-width baseline.
const BASELINE_WIDTH = 320;

/**
 * Map a status transition to the id of the sound case it should trigger.
 * Returns null when no sound should fire (no change, or coming from
 * "initializing" which is treated as silent startup).
 */
function transitionToCaseId(prev: Status, next: Status): string | null {
  if (prev === next) return null;
  if (prev === "initializing") return null;
  // Permission resume: waiting → busy is the user clicking "Allow" on a
  // Claude permission prompt. The task was already running; this is not
  // a fresh "working" start, so suppress the working sound. The
  // permission-allowed bubble handles the audible feedback for that
  // transition (and avoids double-up with the working loop).
  if (prev === "waiting" && next === "busy") return null;
  if (next === "busy" && prev !== "busy") return "working";
  if (prev === "busy" && next !== "busy") return "done";
  // For all other transitions the case id matches the status name
  // (idle/searching/service/disconnected/visiting).
  return next;
}

function App() {
  const { prompt, error: installError, clear } = useInstallPrompt();
  const { status, scenario } = useStatus();
  const { dragging, onMouseDown, start: startDrag } = useDrag();
  const { visible, message, dismiss } = useBubble();
  const visitors = useVisitors();
  const { scale } = useScale();
  const devMode = useDevMode();
  const appBoundsToggle = useDevAppBounds();
  const containerBoundsToggle = useDevContainerBounds();
  const rootBoundsToggle = useDevRootBounds();
  // Outline visibility is gated behind dev mode so the outlines never
  // show for normal users: toggling them individually in the Superpower
  // tool is only meaningful while dev mode is active. If dev mode is
  // ever turned off, all three outlines hide regardless of their
  // individual toggle state.
  const devAppBounds = devMode && appBoundsToggle;
  const devContainerBounds = devMode && containerBoundsToggle;
  const devRootBounds = devMode && rootBoundsToggle;
  const sound = useSoundSettings();
  const { overrides: soundOverrides } = useSoundOverrides();
  const { getSoundUrl } = useCustomSounds();

  // #root lives in the HTML template outside React's tree, so we toggle
  // its class imperatively when the dev toggle flips.
  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;
    root.classList.toggle("dev-root-bounds", devRootBounds);
  }, [devRootBounds]);

  // Ring the doorbell when a peer's dog arrives. Compares against the
  // previous visitor count so we only fire on growth (arrivals), not on
  // departures or initial mount when the list is already populated.
  const prevVisitorCountRef = useRef(visitors.length);
  useEffect(() => {
    if (visitors.length > prevVisitorCountRef.current && sound.isCategoryEnabled("visit")) {
      const c = findVisitCase("visitor-arrived");
      const resolved = c ? resolveSound(c, soundOverrides) : null;
      if (c && resolved) void playResolvedSound(resolved, c.playOptions, getSoundUrl);
    }
    prevVisitorCountRef.current = visitors.length;
  }, [visitors.length, sound.master, sound.visit, soundOverrides, getSoundUrl]);

  // Audio-only status driven by `audio-status-changed` from the backend.
  // Mirrors `current_ui` but is computed from AI sessions only — tmux
  // shells drive the visual mascot but not the working/done sounds, so
  // a `git status` inside a tmux pane doesn't ring the "done" sound on
  // every prompt.
  const [audioStatus, setAudioStatus] = useState<Status>("initializing");
  useEffect(() => {
    const unlisten = listen<string>("audio-status-changed", (e) => {
      setAudioStatus(e.payload as Status);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Working-status audio: loop the working sound while busy, play the
  // done sound once when the task finishes (busy → anything else).
  // Every transition maps to a case id whose sound is resolved through
  // the override map — lets users swap or silence any specific case.
  const busyLoopRef = useRef<HTMLAudioElement | null>(null);
  const prevAudioStatusRef = useRef(audioStatus);
  useEffect(() => {
    const prev = prevAudioStatusRef.current;
    prevAudioStatusRef.current = audioStatus;
    const statusEnabled = sound.isCategoryEnabled("status");

    // If status sounds (or master) got disabled mid-loop, cut it
    // immediately rather than waiting for the busy→idle transition.
    if (!statusEnabled && busyLoopRef.current) {
      stopAudio(busyLoopRef.current);
      busyLoopRef.current = null;
    }

    if (!statusEnabled) return;

    const caseId = transitionToCaseId(prev, audioStatus);
    if (!caseId) return;
    const c = findStatusCase(caseId);
    if (!c) return;
    const resolved = resolveSound(c, soundOverrides);

    if (caseId === "working") {
      if (resolved) {
        const shouldLoop = sound.workingLoop;
        void playResolvedSound(
          resolved,
          { ...c.playOptions, loop: shouldLoop },
          getSoundUrl
        ).then((el) => {
          // Only track the element if we actually looped — a one-shot
          // working sound ends on its own and doesn't need stopping on
          // the busy→idle transition.
          busyLoopRef.current = shouldLoop ? el : null;
        });
      }
    } else if (caseId === "done") {
      stopAudio(busyLoopRef.current);
      busyLoopRef.current = null;
      if (resolved) void playResolvedSound(resolved, c.playOptions, getSoundUrl);
    } else if (resolved) {
      void playResolvedSound(resolved, c.playOptions, getSoundUrl);
    }
  }, [audioStatus, sound.master, sound.status, sound.workingLoop, soundOverrides, getSoundUrl]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [effectActive, setEffectActive] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  // Stays true from the moment the dropdown starts closing until the
  // window has been fully resized and repositioned. Keeps
  // useWindowAutoSize paused across the whole transition so it can't
  // race this effect with its own setSize (which would otherwise flash
  // the content at the wrong position for a frame).
  const [sessionClosing, setSessionClosing] = useState(false);
  // Mirror of sessionOpen / sessionClosing for the inline chat panel.
  // The chat lives inside the main window (no separate WebviewWindow),
  // so the same window-grow + auto-size-pause pattern keeps the dog
  // anchored when the panel opens / closes.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatClosing, setChatClosing] = useState(false);
  // Tray "Coding Helper" menu item — opens the inline chat panel. The
  // tray handler in lib.rs shows the main window and emits this event;
  // we listen here and flip chatOpen on. Keeps the tray surface in sync
  // with the pill-button surface (both open the same inline panel).
  useEffect(() => {
    const unlisten = listen<void>("tray-chat-clicked", () => {
      setChatOpen(true);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
  // Logical-pixel leftward shift we applied to the window on open
  // (half the width growth). On close we add it back to the *current*
  // window position so user drags during the open state aren't undone.
  // Keeping this as a ref avoids triggering a re-render when we record it.
  const openShiftXRef = useRef<number | null>(null);
  const chatOpenShiftXRef = useRef<number | null>(null);
  // Extra padding the container needs so a multi-line / wide bubble
  // fits inside the window without clipping. Driven by a ResizeObserver
  // on the bubble; applied via CSS vars on .container.
  const [bubbleExtra, setBubbleExtra] = useState<{ top: number; horizontal: number }>({ top: 0, horizontal: 0 });
  // Logical-pixel shift currently applied to the window position to
  // accommodate the speech bubble. We track the delta we've applied
  // (instead of an absolute pre-bubble position) so the restore on
  // hide doesn't undo any drags the user made while the bubble was
  // visible. {0,0} means the window sits at its un-shifted position.
  const bubbleAppliedShiftRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // True while our bubble effect owns the window geometry — pauses
  // useWindowAutoSize so it doesn't race our setSize/setPosition.
  const bubbleGrowActive = visible && (bubbleExtra.top > 0 || bubbleExtra.horizontal > 0);
  useTheme();
  // Pause useWindowAutoSize while visitors are present — the visitor
  // effect below owns the window size in that mode (fixed 500 wide)
  // and useWindowAutoSize would otherwise shrink back to whatever
  // container.offsetWidth reports.
  useWindowAutoSize(
    containerRef,
    effectActive || sessionOpen || sessionClosing || chatOpen || chatClosing || bubbleGrowActive || visitors.length > 0
  );

  // Measure the rendered speech bubble (via ResizeObserver) and compute
  // how much extra container padding is needed so the bubble fits
  // inside the window. Extras are applied via CSS variables (see
  // `.container` in app.css) so `container.offsetWidth/offsetHeight`
  // reflects the new size — that's what the window-grow effect reads
  // to compute the setSize target.
  useLayoutEffect(() => {
    if (!visible) {
      setBubbleExtra((prev) =>
        prev.top === 0 && prev.horizontal === 0 ? prev : { top: 0, horizontal: 0 }
      );
      return;
    }

    const el = document.querySelector<HTMLDivElement>('[data-testid="speech-bubble"]');
    if (!el) return;

    const recompute = () => {
      const rect = el.getBoundingClientRect();
      // Horizontal: bubble is centered on mascot-wrap (sprite-sized),
      // so its overhang per side past the sprite is (bubble - sprite)/2.
      // The container's natural width = max(min-width, sprite + base
      // padding). Whenever the per-side overhang exceeds what the base
      // padding already reserves (and the leftover space inside the
      // 320 baseline), the bubble clips against the body's overflow:
      // hidden. Compute the needed extra symmetrically and apply on
      // both sides via --bubble-extra-h.
      const overhangPerSide = Math.max(
        0,
        Math.ceil((rect.width - SPRITE_NATIVE_WIDTH * scale) / 2)
      );
      // Subtract the half of (baseline - sprite - base padding) that
      // already exists inside the 320 window — anything beyond that
      // budget needs to grow the window. Floor at 0.
      const baselineSlackPerSide = Math.max(
        0,
        Math.floor((BASELINE_WIDTH - SPRITE_NATIVE_WIDTH * scale - BASE_PAD_HORIZONTAL) / 2)
      );
      const extraH = Math.max(0, overhangPerSide - baselineSlackPerSide);
      // Vertical: bubble is absolute and overflows above the container
      // when taller than the natural budget (overlap + BASE_PAD_TOP).
      // We deliberately do NOT push the container down to fit it, because
      // the only way to keep the mascot visually anchored is a paired
      // window setPosition — and the async window move never lands in the
      // same paint frame as the synchronous CSS padding update, which
      // makes the dog jump on every status change. Letting the bubble
      // clip when the window is near the screen top is the lesser evil.
      const extraTop = 0;
      setBubbleExtra((prev) =>
        prev.top === extraTop && prev.horizontal === extraH
          ? prev
          : { top: extraTop, horizontal: extraH }
      );
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, scale]);

  // Grow the window around the bubble so it doesn't clip at the window
  // edge, and keep the sprite visually anchored by shifting window
  // position by the same deltas. Mirrors the session-dropdown pattern
  // above; skipped while the session is resizing the window so the
  // two effects don't fight.
  // Also skipped while an EffectOverlay (e.g. shadow-clone) owns the
  // window geometry — otherwise the bubble's setPosition/setSize race
  // with expandWindow and the pet's visual Y desyncs from the pin.
  useEffect(() => {
    if (sessionOpen || sessionClosing || chatOpen || chatClosing || effectActive) return;

    const win = getCurrentWindow();
    const { top: extraTop, horizontal: extraH } = bubbleExtra;
    const shouldGrow = visible && (extraTop > 0 || extraH > 0);
    const target = shouldGrow ? { x: extraH, y: extraTop } : { x: 0, y: 0 };
    const applied = bubbleAppliedShiftRef.current;
    const dx = target.x - applied.x;
    const dy = target.y - applied.y;
    const sizeChanged = !!containerRef.current;

    if (dx === 0 && dy === 0 && !sizeChanged) return;

    void (async () => {
      try {
        const el = containerRef.current;
        const ops: Promise<void>[] = [];
        if (dx !== 0 || dy !== 0) {
          const sf = await win.scaleFactor();
          const pos = await win.outerPosition();
          const logical = pos.toLogical(sf);
          ops.push(
            win.setPosition(
              new LogicalPosition(
                Math.round(logical.x) - dx,
                Math.round(logical.y) - dy
              )
            )
          );
        }
        if (el) {
          ops.push(
            win.setSize(new LogicalSize(el.offsetWidth, el.offsetHeight))
          );
        }
        await Promise.all(ops);
        bubbleAppliedShiftRef.current = target;
      } catch (err) {
        console.error("[bubble-grow] resize failed:", err);
      }
    })();
  }, [visible, bubbleExtra, sessionOpen, sessionClosing, chatOpen, chatClosing, effectActive]);

  // Visitor count change → drive the window size directly.
  //
  // With visitors: window fixed at 500 wide × max(250, content-height).
  // Without visitors: hand control back to useWindowAutoSize, which
  // will resize to container.offsetWidth (>= 320 via min-width) on
  // its next ResizeObserver tick.
  //
  // requestAnimationFrame waits one frame so React/CSS have committed
  // the new layout (visitor-col mounted/unmounted) before we measure.
  // Saved position when visitor mode grows the window, restored on
  // last-visitor-leaves. Parallel to savedPosRef used by the session
  // dropdown effect.
  const visitorSavedPosRef = useRef<LogicalPosition | null>(null);

  // When visitors arrive, grow the window to 500px wide and shift it
  // left by half the delta so the sprite stays visually anchored —
  // same pattern the session-dropdown effect uses for its own resize.
  // On the last visitor leaving, restore the saved position and let
  // the container's natural (min-width 320) size take over via setSize.
  useEffect(() => {
    const win = getCurrentWindow();

    if (visitors.length > 0) {
      const el = containerRef.current;
      if (!el) return;
      const currentWidth = el.offsetWidth;
      const currentHeight = el.offsetHeight;
      const newWidth = 500;
      const newHeight = Math.max(250, currentHeight);
      const dx = newWidth - currentWidth;

      void (async () => {
        try {
          const sf = await win.scaleFactor();
          const pos = await win.outerPosition();
          const logical = pos.toLogical(sf);
          const origX = Math.round(logical.x);
          const origY = Math.round(logical.y);
          if (!visitorSavedPosRef.current) {
            visitorSavedPosRef.current = new LogicalPosition(origX, origY);
          }
          await Promise.all([
            win.setPosition(
              new LogicalPosition(origX - Math.round(dx / 2), origY)
            ),
            win.setSize(new LogicalSize(newWidth, newHeight)),
          ]);
        } catch (err) {
          console.error("[visitors] grow failed:", err);
        }
      })();
      return;
    }

    // Restore path
    const savedPos = visitorSavedPosRef.current;
    if (!savedPos) return;
    visitorSavedPosRef.current = null;

    void (async () => {
      try {
        const el = containerRef.current;
        const ops: Promise<void>[] = [win.setPosition(savedPos)];
        if (el) {
          ops.push(
            win.setSize(new LogicalSize(el.offsetWidth, el.offsetHeight))
          );
        }
        await Promise.all(ops);
      } catch (err) {
        console.error("[visitors] restore failed:", err);
      }
    })();
  }, [visitors.length]);

  // When the dropdown opens the window grows wider (>= SESSION_DROPDOWN_MIN_WIDTH).
  // Because #root centers its content, a wider window visibly shifts the
  // pet + pill rightward. To keep the pet visually anchored we also move
  // the window left by half the width growth. On close we undo just that
  // open-time shift against the *current* window position so the pet
  // lands back where the user expects — even if they dragged the window
  // while the dropdown was open.
  //
  // setSize + setPosition are fired in parallel via Promise.all so they
  // commit close to the same native-window frame — otherwise the
  // sequential awaits make one change visible before the other and the
  // pet flickers between positions.
  useEffect(() => {
    const win = getCurrentWindow();

    if (sessionOpen) {
      const el = containerRef.current;
      if (!el) return;
      const currentWidth = el.offsetWidth;
      const currentHeight = el.offsetHeight;
      const newWidth = Math.max(currentWidth, SESSION_DROPDOWN_MIN_WIDTH);
      // Cap total window height at SESSION_DROPDOWN_WINDOW_HEIGHT (400).
      // Uses max() so taller pre-existing content (e.g. a multi-line
      // bubble) keeps its height rather than being squeezed.
      const newHeight = Math.max(currentHeight, SESSION_DROPDOWN_WINDOW_HEIGHT);
      const dx = newWidth - currentWidth;
      const shiftX = Math.round(dx / 2);

      void (async () => {
        try {
          const scale = await win.scaleFactor();
          const pos = await win.outerPosition();
          const logical = pos.toLogical(scale);
          const origX = Math.round(logical.x);
          const origY = Math.round(logical.y);
          openShiftXRef.current = shiftX;
          await Promise.all([
            win.setPosition(new LogicalPosition(origX - shiftX, origY)),
            win.setSize(new LogicalSize(newWidth, newHeight)),
          ]);
        } catch (err) {
          console.error("[session-dropdown] open resize failed:", err);
        }
      })();
      return;
    }

    const shiftX = openShiftXRef.current;
    if (shiftX === null) {
      // Nothing to revert — make sure we don't leave sessionClosing
      // stuck true (onOpenChange flipped it optimistically).
      setSessionClosing(false);
      return;
    }
    openShiftXRef.current = null;

    // Dropdown→dropdown handoff: if chat just opened in the same render
    // batch, skip the shrink-to-natural restore — the chat-open effect
    // is about to setSize(width, CHAT_DROPDOWN_WINDOW_HEIGHT) and we'd
    // race it. Without this, the close's setSize lands AFTER the open's
    // and clamps the window back to 250-ish, leaving only the chat
    // header visible inside the panel.
    if (chatOpen) {
      setSessionClosing(false);
      return;
    }

    void (async () => {
      try {
        const scale = await win.scaleFactor();
        const pos = await win.outerPosition();
        const logical = pos.toLogical(scale);
        const restoredX = Math.round(logical.x) + shiftX;
        const restoredY = Math.round(logical.y);
        const el = containerRef.current;
        const ops: Promise<void>[] = [
          win.setPosition(new LogicalPosition(restoredX, restoredY)),
        ];
        if (el) {
          ops.push(
            win.setSize(new LogicalSize(el.offsetWidth, el.offsetHeight))
          );
        }
        await Promise.all(ops);
      } catch (err) {
        console.error("[session-dropdown] close resize failed:", err);
      } finally {
        setSessionClosing(false);
      }
    })();
    // chatOpen intentionally NOT in deps — it's only read for the
    // dropdown→dropdown handoff. Adding it would re-fire the grow
    // path when chat toggles independently and race the chat effect.
  }, [sessionOpen]);

  // Mirror the session-dropdown effect above, but for the inline chat
  // panel. Critically, only the HEIGHT grows — width stays put. With a
  // horizontal grow the window has to shift left (to keep the dog
  // centered) and the inter-IPC frame between setPosition and setSize
  // visibly flashes the dog left for one paint. Session-list avoids
  // this by sizing its panel to fit the existing 320px baseline; we do
  // the same for chat — the panel adapts to whatever window width it's
  // sitting in via `left/right: 12px` in chat.css.
  useEffect(() => {
    const win = getCurrentWindow();

    if (chatOpen) {
      const el = containerRef.current;
      if (!el) return;
      const currentHeight = el.offsetHeight;
      const newHeight = Math.max(currentHeight, CHAT_DROPDOWN_WINDOW_HEIGHT);
      // shiftX kept at 0 — no horizontal grow, no horizontal shift.
      chatOpenShiftXRef.current = 0;

      void (async () => {
        try {
          await win.setSize(new LogicalSize(el.offsetWidth, newHeight));
        } catch (err) {
          console.error("[chat-dropdown] open resize failed:", err);
        }
      })();
      return;
    }

    const shiftX = chatOpenShiftXRef.current;
    if (shiftX === null) {
      setChatClosing(false);
      return;
    }
    chatOpenShiftXRef.current = null;

    // Symmetric handoff: if session-list just opened in the same render
    // batch, skip the shrink — the session-open effect will setSize the
    // window. Otherwise the chat-close shrink races the session-open
    // grow and the dropdown ends up clipped.
    if (sessionOpen) {
      setChatClosing(false);
      return;
    }

    void (async () => {
      try {
        const el = containerRef.current;
        if (el) {
          await win.setSize(new LogicalSize(el.offsetWidth, el.offsetHeight));
        }
      } catch (err) {
        console.error("[chat-dropdown] close resize failed:", err);
      } finally {
        setChatClosing(false);
      }
    })();
    // sessionOpen intentionally NOT in deps — same reason as the
    // session-dropdown effect. Closure captures the post-batch value.
  }, [chatOpen]);

  return (
    <>
    <div
      ref={containerRef}
      data-testid="app-container"
      className={`container ${dragging ? "dragging" : ""} ${scenario ? "scenario-active" : ""} ${visitors.length > 0 ? "has-visitors" : ""} ${effectActive ? "effect-active" : ""} ${devAppBounds ? "dev-bounds" : ""} ${devContainerBounds ? "dev-container-bounds" : ""}`}
      style={{
        // Driven by the bubble measurement effect above. 0 when the
        // bubble is hidden or fits in the default padding.
        "--bubble-extra-top": `${bubbleExtra.top}px`,
        "--bubble-extra-h": `${bubbleExtra.horizontal}px`,
        // Enforced inline (as well as via .has-visitors CSS rule) to
        // guarantee the highest specificity wins: whichever stylesheet
        // ordering or hot-reload state we're in, the min-width here
        // is authoritative.
        minWidth: visitors.length > 0 ? "500px" : "320px",
        minHeight: "250px",
      } as React.CSSProperties}
      onMouseDown={onMouseDown}
    >
      <div className="main-col">
        {scenario && <div data-testid="scenario-badge" className="scenario-badge">SCENARIO</div>}
        <EffectOverlay onActiveChange={setEffectActive} />
        {/* mascot-wrap anchors the absolute-positioned speech bubble.
            Keeping the bubble out of the flex flow prevents it from
            nudging the sprite's Y position when it appears/disappears. */}
        <div className="mascot-wrap" data-testid="mascot-wrap">
          <SpeechBubble visible={visible} message={message} onDismiss={dismiss} />
          {status !== "visiting" && <Mascot status={status} onDragStart={startDrag} />}
          {status === "visiting" && <div data-testid="mascot-placeholder" style={{ width: 128 * scale, height: 128 * scale }} />}
        </div>
        <DevBuildBadge />
        <StatusPill
          status={status}
          glow={visible}
          disabled={status === "visiting"}
          onOpenChange={(open) => {
            // Flip sessionClosing to true in the SAME render batch that
            // sessionOpen becomes false — this keeps useWindowAutoSize
            // paused across the whole close transition, otherwise its
            // effect re-runs synchronously with paused=false and fires
            // an extra setSize that flashes the content at the wrong
            // position for a frame.
            if (!open) setSessionClosing(true);
            setSessionOpen(open);
          }}
          onChatOpenChange={(open) => {
            // Same close-transition guard as onOpenChange. The chat panel
            // is bigger than the session list, so the auto-size race is
            // visually louder here — chatClosing keeps useWindowAutoSize
            // paused until the close-effect's setSize lands.
            if (!open) setChatClosing(true);
            setChatOpen(open);
          }}
        />
        {devMode && <DevTag />}
      </div>
      {visitors.length > 0 && (
        <div className="visitors-col" data-testid="visitors-col">
          {visitors.map((v, i) => (
            <VisitorDog
              key={v.instance_name || v.nickname || `${i}`}
              pet={v.pet}
              nickname={v.nickname}
              message={v.message}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
    <InstallPromptDialog prompt={prompt} error={installError} onDone={clear} />
    </>
  );
}

export default App;
