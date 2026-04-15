import { useState, useCallback, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { info, error as logError } from "@tauri-apps/plugin-log";
import type { Status } from "../types/status";
import {
  loadImage,
  prepareCanvas,
  removeSmallComponents,
  detectRows,
  extractFrames,
  getFramePreview,
  createStripFromFrames,
  type Frame,
} from "../utils/spriteSheetProcessor";
import { ALL_STATUSES } from "../hooks/useCustomMimes";
import { AnimationPreview } from "./AnimationPreview";

interface SmartImportProps {
  onSave: (
    name: string,
    blobs: Record<Status, { blob: Uint8Array; frames: number }>,
    meta: {
      sheetBlob: Uint8Array;
      frameInputs: Record<Status, string>;
    }
  ) => Promise<void>;
  onCancel: () => void;
  initialFilePath?: string;
  initialName?: string;
  initialFrameInputs?: Record<Status, string>;
  editingId?: string;
}

const STATUS_LABELS: Record<Status, string> = {
  idle: "Idle",
  busy: "Busy",
  service: "Service",
  disconnected: "Disconnected",
  searching: "Searching",
  initializing: "Initializing",
  visiting: "Visiting",
};

const STATUS_DESCRIPTIONS: Record<Status, string> = {
  idle: "No commands running — the default resting state",
  busy: "A terminal command is actively running",
  service: "A long-running process (e.g. dev server) is active",
  disconnected: "No terminal sessions connected",
  searching: "App just launched, looking for terminal sessions",
  initializing: "First-launch setup in progress",
  visiting: "A friend's mime is visiting from the local network",
};

/** Parse "1-5" or "1,2,3,5,6" into 0-based indices. Preserves order and duplicates. Ranges are directional: 3-1 → 3,2,1. */
export function parseFrameInput(input: string, maxFrame: number): number[] {
  const indices: number[] = [];
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.split("-");
    if (range.length === 2) {
      const start = parseInt(range[0]);
      const end = parseInt(range[1]);
      if (!isNaN(start) && !isNaN(end)) {
        const step = start <= end ? 1 : -1;
        for (let i = start; step === 1 ? i <= end : i >= end; i += step) {
          if (i >= 1 && i <= maxFrame) {
            indices.push(i - 1);
          }
        }
      }
    } else {
      const n = parseInt(trimmed);
      if (!isNaN(n) && n >= 1 && n <= maxFrame) {
        indices.push(n - 1);
      }
    }
  }
  return indices;
}

/** Inverse of parseFrameInput. Collapses consecutive runs; preserves direction. */
export function serializeFrames(nums: number[]): string {
  if (nums.length === 0) return "";
  const parts: string[] = [];
  let i = 0;
  while (i < nums.length) {
    let j = i;
    const prevDup = i > 0 && nums[i - 1] === nums[i];
    const step = prevDup
      ? 0
      : nums[i + 1] === nums[i] + 1
      ? 1
      : nums[i + 1] === nums[i] - 1
      ? -1
      : 0;
    if (step !== 0) {
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + step) j++;
    }
    parts.push(j === i ? `${nums[i]}` : `${nums[i]}-${nums[j]}`);
    i = j + 1;
  }
  return parts.join(",");
}

export function SmartImport({
  onSave,
  onCancel,
  initialFilePath,
  initialName,
  initialFrameInputs,
  editingId: _editingId,
}: SmartImportProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [frameInputs, setFrameInputs] = useState<Record<Status, string>>(() => {
    const init: any = {};
    for (const s of ALL_STATUSES) init[s] = "";
    return init;
  });
  const [name, setName] = useState(initialName ?? "");
  const [processing, setProcessing] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [allFramePreviews, setAllFramePreviews] = useState<string[]>([]);
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [animPreview, setAnimPreview] = useState<{ url: string; frames: number; label: string } | null>(null);
  const [frameThumbs, setFrameThumbs] = useState<Record<Status, { src: string; num: number }[]>>(() => {
    const init: Record<string, { src: string; num: number }[]> = {};
    for (const s of ALL_STATUSES) init[s] = [];
    return init as Record<Status, { src: string; num: number }[]>;
  });
  const previewCache = useRef<Map<number, string>>(new Map());
  const [dragging, setDragging] = useState<{ status: Status; index: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ status: Status; index: number } | null>(null);

  const processFile = useCallback(async (filePath: string) => {
    setError(null);
    try {
      const rawName = filePath.split("/").pop() ?? "";
      setFileName(rawName);
      if (!initialName) {
        setName(rawName.replace(/\.[^.]+$/, ""));
      }
      const bytes = await readFile(filePath);
      setRawBytes(new Uint8Array(bytes));
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "png";
      const mime = ext === "gif" ? "image/gif" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
      const blob = new Blob([bytes], { type: mime });
      const src = URL.createObjectURL(blob);
      const img = await loadImage(src);
      URL.revokeObjectURL(src);

      const prepared = prepareCanvas(img).canvas;
      removeSmallComponents(prepared);
      setCanvas(prepared);
      previewCache.current.clear();

      const detected = detectRows(prepared);
      if (detected.length === 0) {
        setError("No sprite rows detected. Try a different image or background color.");
        return;
      }

      const allFrames = extractFrames(detected);
      setFrames(allFrames);

      // Auto-assign: distribute frames evenly across statuses (skipped in edit mode)
      const autoInputs: Record<string, string> = {};
      if (initialFrameInputs) {
        for (const s of ALL_STATUSES) autoInputs[s] = initialFrameInputs[s] ?? "";
      } else {
        const perStatus = Math.max(1, Math.floor(allFrames.length / ALL_STATUSES.length));
        for (let si = 0; si < ALL_STATUSES.length; si++) {
          const start = si * perStatus + 1;
          const end = si === ALL_STATUSES.length - 1
            ? allFrames.length
            : Math.min((si + 1) * perStatus, allFrames.length);
          autoInputs[ALL_STATUSES[si]] = `${start}-${end}`;
        }
      }
      setFrameInputs(autoInputs as Record<Status, string>);

      // Generate initial thumbnails
      const initThumbs: Record<string, { src: string; num: number }[]> = {};
      for (const s of ALL_STATUSES) {
        const indices = parseFrameInput(autoInputs[s], allFrames.length);
        initThumbs[s] = indices.map((i) => ({ src: getFramePreview(prepared, allFrames[i], 72), num: i + 1 }));
      }
      setFrameThumbs(initThumbs as Record<Status, { src: string; num: number }[]>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load image";
      logError(`[smart-import] processFile failed: ${msg}`);
      setError(msg);
    }
  }, []);

  const handlePickSheet = useCallback(async () => {
    const result = await open({
      multiple: false,
      filters: [{ name: "Sprite Sheet", extensions: ["png", "gif", "jpg", "jpeg"] }],
    });
    if (!result) return;
    await processFile(result);
  }, [processFile]);

  const didAutoLoad = useRef(false);
  useEffect(() => {
    if (initialFilePath && !didAutoLoad.current) {
      didAutoLoad.current = true;
      processFile(initialFilePath);
    }
  }, [initialFilePath, processFile]);

  const applyFramesChange = useCallback((status: Status, nextNums: number[]) => {
    if (!canvas || frames.length === 0) return;
    const cache = previewCache.current;
    const thumbs = nextNums.map((num) => {
      let src = cache.get(num);
      if (!src) {
        src = getFramePreview(canvas, frames[num - 1], 72);
        cache.set(num, src);
      }
      return { src, num };
    });
    setFrameThumbs((prev) => ({ ...prev, [status]: thumbs }));
    setFrameInputs((prev) => ({ ...prev, [status]: serializeFrames(nextNums) }));
  }, [canvas, frames]);

  const onChipDragStart = (status: Status, index: number) => (e: React.DragEvent) => {
    const payload = { sourceStatus: status, index, num: frameThumbs[status][index].num };
    e.dataTransfer.setData("application/x-frame", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "copyMove";
    setDragging({ status, index });
  };

  const onChipDragOver = (status: Status, index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.altKey ? "copy" : "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientX - rect.left > rect.width / 2;
    setDropTarget({ status, index: after ? index + 1 : index });
  };

  const onListDragOver = (status: Status) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.altKey ? "copy" : "move";
    setDropTarget((prev) => {
      if (prev && prev.status === status) return prev;
      return { status, index: frameThumbs[status].length };
    });
  };

  const onListDrop = (status: Status) => (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/x-frame");
    if (!raw) return;
    const data = JSON.parse(raw) as { sourceStatus: Status; index: number; num: number };
    const copy = e.altKey || e.dataTransfer.dropEffect === "copy";
    const insertAt = dropTarget?.status === status ? dropTarget.index : frameThumbs[status].length;

    if (data.sourceStatus === status) {
      const nums = frameThumbs[status].map((t) => t.num);
      const [m] = nums.splice(data.index, 1);
      nums.splice(insertAt > data.index ? insertAt - 1 : insertAt, 0, m);
      applyFramesChange(status, nums);
    } else {
      const dst = frameThumbs[status].map((t) => t.num);
      dst.splice(insertAt, 0, data.num);
      applyFramesChange(status, dst);
      if (!copy) {
        const src = frameThumbs[data.sourceStatus].map((t) => t.num).filter((_, i) => i !== data.index);
        applyFramesChange(data.sourceStatus, src);
      }
    }
    setDragging(null);
    setDropTarget(null);
  };

  const onDragEnd = () => {
    setDragging(null);
    setDropTarget(null);
  };

  const handlePreview = useCallback(async (status: Status, inputValue?: string) => {
    if (!canvas || frames.length === 0) return;
    const value = inputValue ?? frameInputs[status];
    const indices = parseFrameInput(value, frames.length);
    applyFramesChange(status, indices.map((i) => i + 1));
    if (indices.length === 0) return;

    const strip = await createStripFromFrames(canvas, frames, indices);
    const blob = new Blob([strip.blob as BlobPart], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    if (animPreview?.url) URL.revokeObjectURL(animPreview.url);
    setAnimPreview({ url, frames: strip.frames, label: STATUS_LABELS[status] });
  }, [canvas, frames, frameInputs, animPreview, applyFramesChange]);



  useEffect(() => {
    if (!showModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal]);

  const handleShowAllFrames = useCallback(() => {
    if (!canvas || frames.length === 0) return;
    if (allFramePreviews.length === 0) {
      const previews = frames.map((f) => getFramePreview(canvas, f));
      setAllFramePreviews(previews);
    }
    setShowModal(true);
  }, [canvas, frames, allFramePreviews]);

  const allStatusesAssigned = ALL_STATUSES.every((s) => {
    const indices = parseFrameInput(frameInputs[s], frames.length);
    return indices.length > 0;
  });

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    if (!canvas) { setError("No sprite sheet loaded"); return; }
    if (!allStatusesAssigned) {
      const missing = ALL_STATUSES.find((s) => parseFrameInput(frameInputs[s], frames.length).length === 0);
      setError(`Assign frames to "${missing}"`);
      return;
    }
    setProcessing(true);
    setError(null);

    try {
      info(`[smart-import] saving mime "${name}" with ${ALL_STATUSES.length} statuses`);
      const blobs: Record<string, { blob: Uint8Array; frames: number }> = {};

      for (const status of ALL_STATUSES) {
        const indices = parseFrameInput(frameInputs[status], frames.length);
        const strip = await createStripFromFrames(canvas, frames, indices);
        blobs[status] = strip;
      }

      if (!rawBytes) throw new Error("No source sheet data available");
      const sheetBlob = rawBytes;

      await onSave(
        name.trim(),
        blobs as Record<Status, { blob: Uint8Array; frames: number }>,
        { sheetBlob, frameInputs }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save mime";
      logError(`[smart-import] handleSave failed: ${msg}`);
      setError(msg);
    } finally {
      setProcessing(false);
    }
  }, [canvas, name, allStatusesAssigned, frameInputs, frames, onSave]);

  return (
    <div className="smart-import">
      {!canvas ? (
        <div className="smart-import-pick" data-testid="smart-import-pick">
          <div className="settings-card">
            <div className="smart-import-dropzone" onClick={handlePickSheet}>
              <div className="add-icon" style={{ fontSize: 32 }}>+</div>
              <span>Choose a sprite sheet</span>
              <span className="smart-import-hint">PNG, GIF, or JPG</span>
            </div>
          </div>
          <div className="custom-creator-actions">
            <button className="creator-btn cancel" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="settings-card" style={{ marginBottom: 10 }}>
            <div className="settings-row">
              <span className="settings-row-label">Name</span>
              <input
                type="text"
                className="settings-input"
                style={{ textAlign: "right" }}
                value={name}
                placeholder="My Custom Mime"
                maxLength={20}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="settings-row">
              <span className="settings-row-label">File</span>
              <span className="smart-import-file">{fileName}</span>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">Frames</span>
              <div className="smart-import-frames-info">
                <span className="smart-import-file">{frames.length} detected</span>
                <button className="smart-import-preview-btn" onClick={handleShowAllFrames}>
                  Show all
                </button>
              </div>
            </div>
          </div>

          <div className="settings-card">
            <div className="smart-import-rows-header">
              <span className="settings-row-label">Assign frames to states</span>
              <span className="smart-import-hint">e.g. 1-5, 3-1, or 1,3,5</span>
            </div>
            {ALL_STATUSES.map((status) => (
              <div className="smart-import-frame-assign" key={status}>
                <div className="smart-import-frame-header">
                  <div>
                    <span className="settings-row-label">{STATUS_LABELS[status]}</span>
                    <div className="status-desc">{STATUS_DESCRIPTIONS[status]}</div>
                  </div>
                  <div className="smart-import-frame-input-group">
                    <input
                      type="text"
                      className="smart-import-frame-input"
                      value={frameInputs[status]}
                      placeholder="1-5"
                      onChange={(e) => setFrameInputs((prev) => ({ ...prev, [status]: e.target.value }))}
                      onBlur={(e) => {
                        const nums = parseFrameInput(e.currentTarget.value, frames.length).map((i) => i + 1);
                        applyFramesChange(status, nums);
                      }}
                    />
                    <button className="smart-import-preview-btn" onClick={() => handlePreview(status)}>Preview</button>
                  </div>
                </div>
                {frameThumbs[status]?.length > 0 && (
                  <div
                    className={`smart-import-frame-previews${dropTarget?.status === status ? " drop-target" : ""}`}
                    data-testid={`frame-list-${status}`}
                    onDragOver={onListDragOver(status)}
                    onDrop={onListDrop(status)}
                  >
                    {frameThumbs[status].map((thumb, i) => {
                      const isDragging = dragging?.status === status && dragging.index === i;
                      const dropSide =
                        dropTarget?.status === status && dropTarget.index === i ? "before" :
                        dropTarget?.status === status && dropTarget.index === i + 1 ? "after" : null;
                      const cls = `smart-import-frame-thumb-item${isDragging ? " dragging" : ""}${dropSide ? ` drop-${dropSide}` : ""}`;
                      return (
                      <div
                        key={`${thumb.num}-${i}`}
                        draggable
                        onDragStart={onChipDragStart(status, i)}
                        onDragOver={onChipDragOver(status, i)}
                        onDragEnd={onDragEnd}
                        className={cls}
                        data-testid={`frame-chip-${status}-${thumb.num}`}
                      >
                        <img src={thumb.src} alt={`Frame ${thumb.num}`} className="smart-import-frame-thumb" draggable={false} />
                        <span className="smart-import-frame-num">{thumb.num}</span>
                        <button
                          type="button"
                          className="smart-import-frame-thumb-remove"
                          aria-label={`Remove frame ${thumb.num}`}
                          data-testid={`frame-remove-${status}-${thumb.num}`}
                          onClick={() => {
                            const next = frameThumbs[status].filter((_, idx) => idx !== i).map((t) => t.num);
                            applyFramesChange(status, next);
                          }}
                        >
                          ×
                        </button>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {error && <div className="save-error">{error}</div>}
          <div className="custom-creator-actions">
            <button className="creator-btn cancel" onClick={onCancel}>Cancel</button>
            <button
              className="creator-btn save"
              onClick={handleSave}
              disabled={processing}
            >
              {processing ? "Processing..." : "Save"}
            </button>
          </div>
        </>
      )}

      {showModal && (
        <div className="smart-import-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="smart-import-modal" onClick={(e) => e.stopPropagation()}>
            <div className="smart-import-modal-header">
              <span>All Frames ({frames.length})</span>
              <button className="smart-import-modal-close" onClick={() => setShowModal(false)}>x</button>
            </div>
            <div className="smart-import-modal-grid">
              {allFramePreviews.map((src, i) => (
                <div key={i} className="smart-import-modal-frame">
                  <img src={src} alt={`Frame ${i + 1}`} />
                  <span className="smart-import-modal-label">{i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {animPreview && (
        <AnimationPreview
          spriteUrl={animPreview.url}
          frames={animPreview.frames}
          label={animPreview.label}
          onClose={() => {
            URL.revokeObjectURL(animPreview.url);
            setAnimPreview(null);
          }}
        />
      )}
    </div>
  );
}
