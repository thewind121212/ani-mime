import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { readFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { useStatus } from "../hooks/useStatus";
import { usePet } from "../hooks/usePet";
import { useScale } from "../hooks/useScale";
import { useCustomMimes } from "../hooks/useCustomMimes";
import { getSpriteMap } from "../constants/sprites";
import { useEffectEnabled, isEffectEnabledAsync } from "./useEffectEnabled";
import { effects } from "./index";
import type { EffectDefinition } from "./types";

const FRAME_BASE_PX = 128;
const CANDIDATE_FRAME_SIZES = [128, 96, 64, 48, 32, 16];

function inferGrid(w: number, h: number, frames: number) {
  for (const fp of CANDIDATE_FRAME_SIZES) {
    if (w % fp === 0 && h % fp === 0) {
      const cols = w / fp;
      const rows = h / fp;
      if (cols * rows >= frames) return { framePx: fp, cols };
    }
  }
  return { framePx: h, cols: Math.max(1, Math.round(w / Math.max(1, h))) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Flatten a potentially multi-row sprite sheet into a single-row strip.
 * The shadow clone CSS animation shifts background-position-x only,
 * so grids must be converted to horizontal strips.
 */
async function flattenToStrip(blob: Blob, frames: number): Promise<string> {
  const blobUrl = URL.createObjectURL(blob);
  const img = await loadImage(blobUrl);
  const { framePx, cols } = inferGrid(img.naturalWidth, img.naturalHeight, frames);

  // Already a flat strip — use the blob URL directly
  if (cols >= frames) return blobUrl;

  // Flatten grid to horizontal strip via canvas
  const canvas = document.createElement("canvas");
  canvas.width = framePx * frames;
  canvas.height = framePx;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < frames; i++) {
    const srcX = (i % cols) * framePx;
    const srcY = Math.floor(i / cols) * framePx;
    ctx.drawImage(img, srcX, srcY, framePx, framePx, i * framePx, 0, framePx, framePx);
  }
  URL.revokeObjectURL(blobUrl);

  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(URL.createObjectURL(b!)), "image/png");
  });
}

interface EffectOverlayProps {
  onActiveChange?: (active: boolean) => void;
}

interface ActiveEffect {
  definition: EffectDefinition;
  spriteUrl: string;
  frames: number;
  frameSize: number;
  anchorX: number;
  anchorY: number;
}

/**
 * Briefly hide #root content so the window resize+move is invisible.
 * Avoids the up-left flash that the previous "pin in old root coords"
 * approach caused: setPosition and setSize aren't atomic, and any pin
 * computed in old window coords desyncs from the new window origin
 * mid-transition.
 */
function hideRootContent() {
  const root = document.getElementById("root");
  if (!root) return;
  root.style.opacity = "0";
}

function showRootContent() {
  const root = document.getElementById("root");
  if (!root) return;
  root.style.opacity = "";
}

/**
 * #root pins its container to the TOP edge (`align-items: flex-start`)
 * so the pet doesn't jump when the session dropdown grows the window
 * height. That breaks the effect-expand symmetry: when expandWindow
 * shifts the window UP by shiftY to keep the dog's visual center fixed,
 * the container goes up with the window, so the pet ends up shiftY px
 * higher on screen instead of staying put. Pushing #root down by the
 * same shiftY via paddingTop cancels the upward window shift and keeps
 * the dog at the original screen Y. X works without help because root
 * is `justify-content: center` — the centered container naturally
 * tracks the window center as it grows.
 */
function pinRootVertical(shiftY: number) {
  const root = document.getElementById("root");
  if (!root) return;
  root.style.paddingTop = `${Math.max(0, shiftY)}px`;
}

function unpinRootVertical() {
  const root = document.getElementById("root");
  if (!root) return;
  root.style.paddingTop = "";
}

/**
 * Expose the active expand shift (in window-local px) to layout-fixed
 * descendants like the session dropdown. Those popovers use
 * `position: fixed` keyed off the pill's bounding rect — the rect was
 * captured before the window grew and shifted, so without compensation
 * the dropdown rides up with the new window origin and visibly "jumps"
 * during the busy transition. Components subtract these vars from their
 * own translate so they stay anchored to the screen position they had
 * before the effect started.
 */
function setEffectShiftVars(shiftX: number, shiftY: number) {
  const root = document.documentElement;
  root.style.setProperty("--effect-shift-x", `${shiftX}px`);
  root.style.setProperty("--effect-shift-y", `${shiftY}px`);
}

function clearEffectShiftVars() {
  const root = document.documentElement;
  root.style.removeProperty("--effect-shift-x");
  root.style.removeProperty("--effect-shift-y");
}

export function EffectOverlay({ onActiveChange }: EffectOverlayProps) {
  const { status } = useStatus();
  const { pet } = usePet();
  const { scale } = useScale();
  const { mimes } = useCustomMimes();

  const [activeEffect, setActiveEffect] = useState<ActiveEffect | null>(null);
  const [windowReady, setWindowReady] = useState(false);
  const prevStatusRef = useRef(status);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedWindowRef = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
    shiftX: number;
    shiftY: number;
  } | null>(null);
  const customSpriteUrlRef = useRef<string | null>(null);

  const expandWindow = useCallback(async (size: number): Promise<{ anchorX: number; anchorY: number }> => {
    const fallback = { anchorX: size / 2, anchorY: size / 2 };
    try {
      const win = getCurrentWindow();

      // Read CURRENT window geometry every call. On re-entry (rapid
      // busy→idle→busy while the previous restoreWindow is still in
      // flight), curW may already be `size` — using a *live* shift
      // computed from curW means we don't teleport the window back to
      // the original baseline pos and any user drag during the
      // expanded state is preserved.
      const factor = await win.scaleFactor();
      const physPos = await win.outerPosition();
      const physSize = await win.outerSize();
      const curX = physPos.x / factor;
      const curY = physPos.y / factor;
      const curW = physSize.width / factor;
      const curH = physSize.height / factor;

      // Capture the natural baseline only on the first expand of a
      // cycle. If savedWindowRef already exists, the previous
      // restoreWindow is mid-flight and curW could be `size` — capturing
      // it as "natural" would lock the window expanded on next restore.
      if (!savedWindowRef.current) {
        const shiftX = (size - curW) / 2;
        // Don't shift the window upward at all — even with the
        // paddingTop pin, the async window-move IPC and the synchronous
        // CSS update don't land in the same paint frame, so the mascot
        // briefly drops/rises on every expand/restore. Letting the
        // window grow down-right keeps the mascot pinned to its
        // original screen Y on every busy ↔ idle transition.
        const shiftY = 0;
        savedWindowRef.current = { x: curX, y: curY, w: curW, h: curH, shiftX, shiftY };
      }

      const { shiftX, shiftY } = savedWindowRef.current;

      // Live shift = how far we need to move *from where the window is
      // right now* to land at size×size centered on the original dog
      // screen position. When curW === size (already expanded) this is
      // 0 → no teleport. When curW === naturalW it equals the saved
      // shiftX → standard expand.
      const liveShiftX = (size - curW) / 2;
      const liveShiftY = 0;

      // Compensate for the window shifting up by shiftY: push the
      // flex-start container down by the same amount so the dog stays
      // at its original screen Y. paddingTop must match the *actual*
      // shift (post-clamp), otherwise the pet drifts vertically.
      // Set BEFORE the resize so the layout is already correct when
      // the new window geometry commits.
      pinRootVertical(shiftY);
      // Publish shift vars before the resize so any fixed-positioned
      // popover (session dropdown, peer list, tooltips) can offset
      // itself in the same frame and not visibly jump.
      setEffectShiftVars(shiftX, shiftY);

      // Hide content during the resize+move so the brief frame where
      // setPosition has committed but setSize hasn't (or vice-versa)
      // doesn't show the dog at the wrong screen position.
      hideRootContent();

      await win.setShadow(false);
      await Promise.all([
        win.setPosition(new LogicalPosition(curX - liveShiftX, curY - liveShiftY)),
        win.setSize(new LogicalSize(size, size)),
      ]);

      showRootContent();
      setWindowReady(true);

      // Measure dog center inside the expanded window so the clone
      // animation can be anchored on the pet rather than window center.
      // Retries across multiple frames because:
      //   - custom-mime first load: Mascot returns null until its sprite
      //     blob decodes, so [data-testid="mascot-sprite"] is briefly
      //     absent and a single-RAF query falls back to window center.
      //   - visiting→busy transition: mascot replaces the placeholder
      //     this same render cycle.
      // Falls back to mascot-wrap (always present) before the
      // window-center fallback so the clone never bursts from window
      // center when any dog-shaped target is reachable.
      return await new Promise<{ anchorX: number; anchorY: number }>((resolve) => {
        const MAX_TRIES = 8;
        let tries = 0;
        const tick = () => {
          const el =
            document.querySelector<HTMLElement>('[data-testid="mascot-sprite"]') ||
            document.querySelector<HTMLElement>('[data-testid="mascot-placeholder"]') ||
            document.querySelector<HTMLElement>('[data-testid="mascot-wrap"]');
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return resolve({
                anchorX: r.left + r.width / 2,
                anchorY: r.top + r.height / 2,
              });
            }
          }
          tries++;
          if (tries >= MAX_TRIES) return resolve(fallback);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    } catch (err) {
      console.error("[effects] expand error:", err);
      showRootContent();
      setWindowReady(true);
      return fallback;
    }
  }, []);

  const restoreWindow = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      if (savedWindowRef.current) {
        const { w, h, shiftX, shiftY } = savedWindowRef.current;

        // Anchor restore to the window's *current* position so any user
        // drag during the animation is preserved. Use the *saved*
        // shifts (not (curSize - origSize)/2) so a clamped expand
        // (e.g. dog near top of screen) restores symmetrically: the
        // pet lands back at its pre-effect screen position even when
        // shiftY < requestedShiftY.
        const factor = await win.scaleFactor();
        const physPos = await win.outerPosition();
        const curX = physPos.x / factor;
        const curY = physPos.y / factor;
        const targetX = curX + shiftX;
        const targetY = curY + shiftY;

        hideRootContent();
        await Promise.all([
          win.setPosition(new LogicalPosition(targetX, targetY)),
          win.setSize(new LogicalSize(w, h)),
        ]);
        // Drop the vertical pin only after the window is back to its
        // original size, otherwise the container would re-anchor to
        // the top while the window is still tall and the pet would
        // briefly jump up before the resize completes.
        unpinRootVertical();
        clearEffectShiftVars();
        showRootContent();
        // await win.setShadow(true);
        savedWindowRef.current = null;
      }
    } catch (err) {
      console.error("[effects] restore error:", err);
      unpinRootVertical();
      showRootContent();
    }
  }, []);

  const stopEffect = useCallback(() => {
    clearTimeout(timerRef.current);
    setActiveEffect(null);
    setWindowReady(false);
    onActiveChange?.(false);
    restoreWindow();
    if (customSpriteUrlRef.current) {
      URL.revokeObjectURL(customSpriteUrlRef.current);
      customSpriteUrlRef.current = null;
    }
  }, [onActiveChange, restoreWindow]);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (activeEffect && status !== activeEffect.definition.trigger) {
      stopEffect();
      return;
    }

    if (prevStatus === status) return;

    // Permission resume (waiting → busy): the task was already running
    // before the prompt; skip the shadow-clone burst since it's not a
    // fresh start. Without this, every "Allow" click triggers a clone
    // animation mid-task.
    if (prevStatus === "waiting" && status === "busy") return;

    const matchingEffect = effects.find((e) => e.trigger === status);
    if (!matchingEffect) return;

    const isCustom = pet.startsWith("custom-");
    const frameSize = FRAME_BASE_PX * scale;
    let cancelled = false;

    const activate = async () => {
      // Gate on the persisted toggle BEFORE touching the window. The
      // enable check inside EffectRunner only suppresses sprite render —
      // it can't prevent expandWindow from running, so without this
      // guard a disabled effect still grows the window (then snaps
      // back), which compounds with the savedWindowRef race above and
      // can leave the window stuck at the expanded size.
      if (!(await isEffectEnabledAsync(matchingEffect.id))) return;
      if (cancelled) return;

      // Pause concurrent window mutators (useWindowAutoSize, bubble-grow
      // effect) BEFORE any further work. Status change synchronously
      // triggers bubble grow + container resize; if we delay the pause
      // until after the async sprite load, those effects fire their own
      // setPosition/setSize and savedWindowRef captures a stale
      // baseline — the pet ends up at the wrong screen Y after expand.
      onActiveChange?.(true);

      let activated = false;
      try {
        let spriteUrl: string;
        let frames: number;

        if (isCustom) {
          const customMime = mimes.find((m) => m.id === pet);
          if (!customMime) return;
          const spriteData = customMime.sprites[status] ?? customMime.sprites.searching;
          frames = spriteData.frames;
          const base = await appDataDir();
          const filePath = await join(base, "custom-sprites", spriteData.fileName);
          const bytes = await readFile(filePath);
          if (cancelled) return;
          const blob = new Blob([bytes], { type: "image/png" });
          spriteUrl = await flattenToStrip(blob, frames);
          if (cancelled) {
            URL.revokeObjectURL(spriteUrl);
            return;
          }
          customSpriteUrlRef.current = spriteUrl;
        } else {
          const spriteMap = getSpriteMap(pet);
          const sprite = spriteMap[status];
          spriteUrl = new URL(
            `../assets/sprites/${sprite.file}`,
            import.meta.url
          ).href;
          frames = sprite.frames;
        }

        // Expand window (pinning prevents content shift). Await it so
        // we can measure the dog's screen position after the new
        // window geometry commits, then anchor the effect on the pet.
        let anchorX = frameSize / 2;
        let anchorY = frameSize / 2;
        if (matchingEffect.expandWindow) {
          const anchor = await expandWindow(matchingEffect.expandWindow);
          if (cancelled) return;
          anchorX = anchor.anchorX;
          anchorY = anchor.anchorY;
        } else {
          setWindowReady(true);
          // Same fallback chain as expandWindow's anchor measure:
          // sprite → placeholder → wrap. Avoids a stale (frameSize/2)
          // anchor when Mascot is mid-mount (custom mime decode,
          // visiting transition).
          const el =
            document.querySelector<HTMLElement>('[data-testid="mascot-sprite"]') ||
            document.querySelector<HTMLElement>('[data-testid="mascot-placeholder"]') ||
            document.querySelector<HTMLElement>('[data-testid="mascot-wrap"]');
          if (el) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              anchorX = r.left + r.width / 2;
              anchorY = r.top + r.height / 2;
            }
          }
        }

        setActiveEffect({
          definition: matchingEffect,
          spriteUrl,
          frames,
          frameSize,
          anchorX,
          anchorY,
        });

        timerRef.current = setTimeout(stopEffect, matchingEffect.duration);
        activated = true;
      } finally {
        // If we bailed out (cancelled, missing data, or threw), release
        // the pause we acquired up top. Otherwise stopEffect owns it.
        if (!activated) onActiveChange?.(false);
      }
    };

    activate();

    return () => {
      cancelled = true;
      clearTimeout(timerRef.current);
    };
  }, [status]);

  if (!activeEffect || !windowReady) return null;

  return (
    <EffectRunner effect={activeEffect} onDisabled={stopEffect} />
  );
}

interface EffectRunnerProps {
  effect: ActiveEffect;
  onDisabled: () => void;
}

function EffectRunner({ effect, onDisabled }: EffectRunnerProps) {
  const { enabled } = useEffectEnabled(effect.definition.id);

  useEffect(() => {
    if (!enabled) onDisabled();
  }, [enabled]);

  if (!enabled) return null;

  const Component = effect.definition.component;
  return (
    <Component
      spriteUrl={effect.spriteUrl}
      frames={effect.frames}
      frameSize={effect.frameSize}
      anchorX={effect.anchorX}
      anchorY={effect.anchorY}
    />
  );
}
