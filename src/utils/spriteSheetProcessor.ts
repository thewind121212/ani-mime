const FRAME_SIZE = 128;
// WebKit downsamples textures wider than ~8192px, breaking pixel-aligned frame
// stepping. Cap each row at 4096px (32 frames) and wrap into a 2D grid.
const MAX_SHEET_WIDTH = 4096;

function gridLayout(frameCount: number) {
  const cols = Math.max(1, Math.floor(MAX_SHEET_WIDTH / FRAME_SIZE));
  const rows = Math.max(1, Math.ceil(frameCount / cols));
  return { cols, rows, width: cols * FRAME_SIZE, height: rows * FRAME_SIZE };
}
const BG_TOLERANCE = 30;
const ALPHA_THRESHOLD = 10;
const MIN_GAP = 5;
const MIN_REGION_WIDTH = 10;

export interface DetectedRow {
  index: number;
  y1: number;
  y2: number;
  height: number;
  sprites: { x1: number; x2: number; width: number }[];
  frameCount: number;
}

export interface ProcessedStrip {
  blob: Uint8Array;
  frames: number;
}

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

/** Load an image from a file path or data URL */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to decode image (src=${src.slice(0, 40)}...)`));
    img.src = src;
  });
}

export type BgColor = { r: number; g: number; b: number };

function colorDistance(a: BgColor, b: BgColor): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/** Detect the dominant background color by sampling the 4 corners */
export function detectBgColor(canvas: HTMLCanvasElement): BgColor {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;

  const corners = [
    ctx.getImageData(1, 1, 1, 1).data,
    ctx.getImageData(width - 2, 1, 1, 1).data,
    ctx.getImageData(1, height - 2, 1, 1).data,
    ctx.getImageData(width - 2, height - 2, 1, 1).data,
  ];

  const colors = corners.map((d) => ({ r: d[0], g: d[1], b: d[2] }));
  let bestColor = colors[0];
  let bestCount = 0;

  for (const candidate of colors) {
    const count = colors.filter((c) => colorDistance(c, candidate) <= BG_TOLERANCE).length;
    if (count > bestCount) {
      bestCount = count;
      bestColor = candidate;
    }
  }

  return bestColor;
}

/** Draw image to canvas and remove background pixels within tolerance of bgColor */
export function prepareCanvas(
  img: HTMLImageElement,
  bgColor?: BgColor
): { canvas: HTMLCanvasElement; bgColor: BgColor } {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const detectedColor = bgColor ?? detectBgColor(canvas);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const dist = colorDistance(
      { r: data[i], g: data[i + 1], b: data[i + 2] },
      detectedColor
    );
    if (dist <= BG_TOLERANCE) {
      data[i + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return { canvas, bgColor: detectedColor };
}

/** Detect rows of sprites by finding horizontal transparent gaps */
export function detectRows(canvas: HTMLCanvasElement): DetectedRow[] {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const rows: DetectedRow[] = [];
  let inContent = false;
  let rowStart = 0;

  for (let y = 0; y < height; y++) {
    const rowData = ctx.getImageData(0, y, width, 1).data;
    let hasContent = false;
    for (let i = 3; i < rowData.length; i += 4) {
      if (rowData[i] > ALPHA_THRESHOLD) {
        hasContent = true;
        break;
      }
    }

    if (hasContent && !inContent) {
      rowStart = y;
      inContent = true;
    } else if (!hasContent && inContent) {
      const sprites = detectColumns(canvas, rowStart, y);
      rows.push({
        index: rows.length,
        y1: rowStart,
        y2: y,
        height: y - rowStart,
        sprites,
        frameCount: sprites.length,
      });
      inContent = false;
    }
  }

  if (inContent) {
    const sprites = detectColumns(canvas, rowStart, height);
    rows.push({
      index: rows.length,
      y1: rowStart,
      y2: height,
      height: height - rowStart,
      sprites,
      frameCount: sprites.length,
    });
  }

  return rows;
}

/** Detect individual sprite columns within a row by finding vertical transparent gaps.
 *  Tiny gaps (< MIN_GAP px) are bridged so detached parts like projectile tips
 *  stay merged. Narrow sliver regions (< MIN_REGION_WIDTH px) are absorbed
 *  into their nearest neighbor. */
function detectColumns(canvas: HTMLCanvasElement, y1: number, y2: number): { x1: number; x2: number; width: number }[] {
  const ctx = canvas.getContext("2d")!;
  const width = canvas.width;
  const rowHeight = y2 - y1;

  // Pass 1: detect raw content regions
  const raw: { x1: number; x2: number }[] = [];
  let inContent = false;
  let colStart = 0;

  for (let x = 0; x < width; x++) {
    const colData = ctx.getImageData(x, y1, 1, rowHeight).data;
    let hasContent = false;
    for (let i = 3; i < colData.length; i += 4) {
      if (colData[i] > ALPHA_THRESHOLD) {
        hasContent = true;
        break;
      }
    }

    if (hasContent && !inContent) {
      colStart = x;
      inContent = true;
    } else if (!hasContent && inContent) {
      raw.push({ x1: colStart, x2: x });
      inContent = false;
    }
  }
  if (inContent) {
    raw.push({ x1: colStart, x2: width });
  }

  if (raw.length === 0) return [];

  // Pass 2: bridge gaps smaller than MIN_GAP
  const merged: { x1: number; x2: number }[] = [{ ...raw[0] }];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1];
    const gap = raw[i].x1 - prev.x2;
    if (gap < MIN_GAP) {
      prev.x2 = raw[i].x2;
    } else {
      merged.push({ ...raw[i] });
    }
  }

  // Pass 3: absorb narrow slivers into nearest neighbor
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length; i++) {
      if (merged[i].x2 - merged[i].x1 < MIN_REGION_WIDTH && merged.length > 1) {
        if (i === 0) {
          merged[1].x1 = merged[i].x1;
        } else if (i === merged.length - 1) {
          merged[i - 1].x2 = merged[i].x2;
        } else {
          const gapLeft = merged[i].x1 - merged[i - 1].x2;
          const gapRight = merged[i + 1].x1 - merged[i].x2;
          if (gapLeft <= gapRight) {
            merged[i - 1].x2 = merged[i].x2;
          } else {
            merged[i + 1].x1 = merged[i].x1;
          }
        }
        merged.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return merged.map((r) => ({ x1: r.x1, x2: r.x2, width: r.x2 - r.x1 }));
}

export interface Frame {
  index: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Flatten all detected rows into a numbered list of individual frames */
export function extractFrames(rows: DetectedRow[]): Frame[] {
  const frames: Frame[] = [];
  for (const row of rows) {
    for (const col of row.sprites) {
      frames.push({ index: frames.length, x1: col.x1, y1: row.y1, x2: col.x2, y2: row.y2 });
    }
  }
  return frames;
}

/** Render a single frame as a data URL preview */
export function getFramePreview(canvas: HTMLCanvasElement, frame: Frame, size: number = 48): string {
  const ctx = canvas.getContext("2d")!;
  const sw = frame.x2 - frame.x1;
  const sh = frame.y2 - frame.y1;
  const spriteData = ctx.getImageData(frame.x1, frame.y1, sw, sh);
  const bbox = getTightBBox(spriteData);
  if (!bbox) return "";

  const cropW = bbox.x2 - bbox.x1;
  const cropH = bbox.y2 - bbox.y1;
  const scale = Math.min(size / cropW, size / cropH);
  const scaledW = Math.round(cropW * scale);
  const scaledH = Math.round(cropH * scale);

  const preview = document.createElement("canvas");
  preview.width = size;
  preview.height = size;
  const pctx = preview.getContext("2d")!;
  pctx.imageSmoothingEnabled = false;
  pctx.drawImage(
    canvas,
    frame.x1 + bbox.x1, frame.y1 + bbox.y1, cropW, cropH,
    Math.round((size - scaledW) / 2), Math.round((size - scaledH) / 2), scaledW, scaledH
  );
  return preview.toDataURL("image/png");
}

/** Create a horizontal sprite strip from specific frame indices */
export async function createStripFromFrames(
  canvas: HTMLCanvasElement,
  frames: Frame[],
  indices: number[]
): Promise<ProcessedStrip> {
  const ctx = canvas.getContext("2d")!;
  const selected = indices.map((i) => frames[i]).filter(Boolean);

  if (selected.length === 0) {
    throw new Error("No frames selected");
  }

  const { cols, width, height } = gridLayout(selected.length);
  const stripCanvas = document.createElement("canvas");
  stripCanvas.width = width;
  stripCanvas.height = height;
  const stripCtx = stripCanvas.getContext("2d")!;
  stripCtx.imageSmoothingEnabled = false;

  for (let i = 0; i < selected.length; i++) {
    const f = selected[i];
    const sw = f.x2 - f.x1;
    const sh = f.y2 - f.y1;
    const spriteData = ctx.getImageData(f.x1, f.y1, sw, sh);
    const bbox = getTightBBox(spriteData);
    if (!bbox) continue;

    const cropW = bbox.x2 - bbox.x1;
    const cropH = bbox.y2 - bbox.y1;
    const scale = Math.min(FRAME_SIZE / cropW, FRAME_SIZE / cropH);
    const scaledW = Math.round(cropW * scale);
    const scaledH = Math.round(cropH * scale);
    const ox = Math.round((FRAME_SIZE - scaledW) / 2);
    const oy = Math.round((FRAME_SIZE - scaledH) / 2);
    const cellX = (i % cols) * FRAME_SIZE;
    const cellY = Math.floor(i / cols) * FRAME_SIZE;

    stripCtx.drawImage(
      canvas,
      f.x1 + bbox.x1, f.y1 + bbox.y1, cropW, cropH,
      cellX + ox, cellY + oy, scaledW, scaledH
    );
  }

  const blob = await canvasToUint8Array(stripCanvas);
  return { blob, frames: selected.length };
}

/** Create a horizontal sprite strip from selected rows, scaled to FRAME_SIZE */
export async function createStrip(
  canvas: HTMLCanvasElement,
  rows: DetectedRow[]
): Promise<ProcessedStrip> {
  const ctx = canvas.getContext("2d")!;

  // Collect all sprite bounding boxes from the selected rows
  const sprites: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const row of rows) {
    for (const col of row.sprites) {
      sprites.push({ x1: col.x1, y1: row.y1, x2: col.x2, y2: row.y2 });
    }
  }

  if (sprites.length === 0) {
    throw new Error("No sprites found in selected rows");
  }

  // Create output sheet canvas (grid layout to stay under WebKit texture limit)
  const { cols, width, height } = gridLayout(sprites.length);
  const stripCanvas = document.createElement("canvas");
  stripCanvas.width = width;
  stripCanvas.height = height;
  const stripCtx = stripCanvas.getContext("2d")!;
  stripCtx.imageSmoothingEnabled = false; // pixelated scaling

  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i];
    const sw = s.x2 - s.x1;
    const sh = s.y2 - s.y1;

    // Get tight bounding box of actual content
    const spriteData = ctx.getImageData(s.x1, s.y1, sw, sh);
    const bbox = getTightBBox(spriteData);
    if (!bbox) continue;

    const cropW = bbox.x2 - bbox.x1;
    const cropH = bbox.y2 - bbox.y1;
    const scale = Math.min(FRAME_SIZE / cropW, FRAME_SIZE / cropH);
    const scaledW = Math.round(cropW * scale);
    const scaledH = Math.round(cropH * scale);
    const ox = Math.round((FRAME_SIZE - scaledW) / 2);
    const oy = Math.round((FRAME_SIZE - scaledH) / 2);
    const cellX = (i % cols) * FRAME_SIZE;
    const cellY = Math.floor(i / cols) * FRAME_SIZE;

    // Draw the cropped sprite scaled into the cell
    stripCtx.drawImage(
      canvas,
      s.x1 + bbox.x1, s.y1 + bbox.y1, cropW, cropH,
      cellX + ox, cellY + oy, scaledW, scaledH
    );
  }

  // Export as PNG blob
  const blob = await canvasToUint8Array(stripCanvas);
  return { blob, frames: sprites.length };
}

/** Remove small isolated pixel groups (e.g. text labels) via connected component analysis.
 *  Components whose bounding-box height is less than 25 % of the tallest component
 *  are treated as text / noise and erased. */
export function removeSmallComponents(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const total = width * height;

  const labels = new Int32Array(total);
  let nextLabel = 1;

  // Per-label bounding-box height (index 0 unused)
  const compMinY: number[] = [0];
  const compMaxY: number[] = [0];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (labels[idx] !== 0 || data[idx * 4 + 3] <= ALPHA_THRESHOLD) continue;

      const label = nextLabel++;
      let minY = y, maxY = y;
      const stack: number[] = [idx];
      labels[idx] = label;

      while (stack.length > 0) {
        const ci = stack.pop()!;
        const cx = ci % width;
        const cy = (ci - cx) / width;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const ni = ny * width + nx;
            if (labels[ni] !== 0 || data[ni * 4 + 3] <= ALPHA_THRESHOLD) continue;
            labels[ni] = label;
            stack.push(ni);
          }
        }
      }

      compMinY.push(minY);
      compMaxY.push(maxY);
    }
  }

  if (nextLabel <= 1) return;

  let maxH = 0;
  for (let i = 1; i < nextLabel; i++) {
    const h = compMaxY[i] - compMinY[i] + 1;
    if (h > maxH) maxH = h;
  }

  const heightThreshold = maxH * 0.25;

  // Build a fast lookup instead of Set.has() in the hot loop
  const isSmall = new Uint8Array(nextLabel);
  let anySmall = false;
  for (let i = 1; i < nextLabel; i++) {
    if (compMaxY[i] - compMinY[i] + 1 < heightThreshold) {
      isSmall[i] = 1;
      anySmall = true;
    }
  }

  if (!anySmall) return;

  for (let i = 0; i < total; i++) {
    if (isSmall[labels[i]]) {
      data[i * 4 + 3] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/** Get tight bounding box of non-transparent pixels in ImageData */
function getTightBBox(imageData: ImageData): { x1: number; y1: number; x2: number; y2: number } | null {
  const { width, height, data } = imageData;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let found = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }

  return found ? { x1: minX, y1: minY, x2: maxX + 1, y2: maxY + 1 } : null;
}

/** Convert canvas to PNG Uint8Array */
function canvasToUint8Array(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Failed to create blob"));
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
    }, "image/png");
  });
}

/** Generate a small preview image of a detected row */
export function getRowPreview(canvas: HTMLCanvasElement, row: DetectedRow, maxHeight: number = 48): string {
  const previewCanvas = document.createElement("canvas");
  const scale = maxHeight / row.height;
  const previewWidth = Math.round(canvas.width * scale);
  previewCanvas.width = previewWidth;
  previewCanvas.height = maxHeight;
  const ctx = previewCanvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, row.y1, canvas.width, row.height, 0, 0, previewWidth, maxHeight);
  return previewCanvas.toDataURL("image/png");
}
