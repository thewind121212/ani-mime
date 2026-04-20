import { useState, useLayoutEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { copyFile, mkdir, exists, remove, writeFile, readFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { info, warn } from "@tauri-apps/plugin-log";
import type { Status, CustomMimeData } from "../types/status";
import {
  loadImage,
  prepareCanvas,
  detectRows,
  extractFrames,
  createStripFromFrames,
  parseFrameInput,
} from "../utils/spriteSheetProcessor";

const STORE_FILE = "settings.json";
const STORE_KEY = "customMimes";
const SPRITES_DIR = "custom-sprites";
const ALL_STATUSES: Status[] = [
  "idle",
  "busy",
  "service",
  "disconnected",
  "searching",
  "initializing",
  "visiting",
];

export { ALL_STATUSES };

export function useCustomMimes() {
  const [mimes, setMimes] = useState<CustomMimeData[]>([]);
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    load(STORE_FILE).then(async (store) => {
      const saved = await store.get<CustomMimeData[]>(STORE_KEY);
      setMimes(saved ?? []);
      setLoaded(true);
    });
  }, []);

  useLayoutEffect(() => {
    const unlisten = listen<CustomMimeData[]>(
      "custom-mimes-changed",
      (event) => {
        setMimes(event.payload);
      }
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const saveMimes = useCallback(async (next: CustomMimeData[]) => {
    setMimes(next);
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, next);
    await store.save();
    info(`[custom-mimes] persisted ${next.length} mimes to store`);
    await emit("custom-mimes-changed", next);
  }, []);

  const ensureSpritesDir = useCallback(async () => {
    const base = await appDataDir();
    const dir = await join(base, SPRITES_DIR);
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
      info(`[custom-mimes] created sprites dir: ${dir}`);
    }
    return dir;
  }, []);

  const pickSpriteFile = useCallback(async (): Promise<string | null> => {
    const result = await open({
      multiple: false,
      filters: [{ name: "PNG Image", extensions: ["png"] }],
    });
    return result ?? null;
  }, []);

  const addMime = useCallback(
    async (
      name: string,
      spriteFiles: Record<Status, { sourcePath: string; frames: number }>
    ) => {
      const id = `custom-${Date.now()}`;
      info(`[custom-mimes] addMime: name="${name}", id=${id}`);
      const dir = await ensureSpritesDir();

      const sprites: Record<string, { fileName: string; frames: number }> = {};
      for (const status of ALL_STATUSES) {
        const { sourcePath, frames } = spriteFiles[status];
        const ext = sourcePath.split(".").pop() ?? "png";
        const fileName = `${id}-${status}.${ext}`;
        const destPath = `${dir}/${fileName}`;
        await copyFile(sourcePath, destPath);
        sprites[status] = { fileName, frames };
      }

      const newMime: CustomMimeData = {
        id,
        name,
        sprites: sprites as Record<
          Status,
          { fileName: string; frames: number }
        >,
      };

      await saveMimes([...mimes, newMime]);
      return id;
    },
    [mimes, saveMimes, ensureSpritesDir]
  );

  const addMimeFromBlobs = useCallback(async (
    name: string,
    spriteBlobs: Record<Status, { blob: Uint8Array; frames: number }>,
    smartImportMeta?: { sheetBlob: Uint8Array; frameInputs: Record<Status, string> }
  ) => {
    const id = `custom-${Date.now()}`;
    info(`[custom-mimes] addMimeFromBlobs: name="${name}", id=${id}, hasSmartMeta=${!!smartImportMeta}`);
    const dir = await ensureSpritesDir();

    const sprites: Record<string, { fileName: string; frames: number }> = {};
    for (const status of ALL_STATUSES) {
      const { blob, frames } = spriteBlobs[status];
      const fileName = `${id}-${status}.png`;
      const destPath = `${dir}/${fileName}`;
      info(`[custom-mimes] writing ${fileName} (${blob.length} bytes)`);
      await writeFile(destPath, blob);
      sprites[status] = { fileName, frames };
    }

    let metaRecord: CustomMimeData["smartImportMeta"];
    if (smartImportMeta) {
      const sheetFileName = `${id}-source.png`;
      info(`[custom-mimes] writing ${sheetFileName} (${smartImportMeta.sheetBlob.length} bytes)`);
      await writeFile(`${dir}/${sheetFileName}`, smartImportMeta.sheetBlob);
      metaRecord = { sheetFileName, frameInputs: smartImportMeta.frameInputs };
    }

    const newMime: CustomMimeData = {
      id,
      name,
      sprites: sprites as Record<Status, { fileName: string; frames: number }>,
      ...(metaRecord ? { smartImportMeta: metaRecord } : {}),
    };

    await saveMimes([...mimes, newMime]);
    return id;
  }, [mimes, saveMimes, ensureSpritesDir]);

  const updateMime = useCallback(
    async (
      id: string,
      name: string,
      spriteFiles: Record<Status, { sourcePath: string | null; frames: number }>
    ) => {
      const existing = mimes.find((m) => m.id === id);
      if (!existing) return;

      info(`[custom-mimes] updateMime: id=${id}, name="${name}"`);
      const dir = await ensureSpritesDir();

      const sprites: Record<string, { fileName: string; frames: number }> = {};
      for (const status of ALL_STATUSES) {
        const { sourcePath, frames } = spriteFiles[status];
        if (sourcePath) {
          const ext = sourcePath.split(".").pop() ?? "png";
          const fileName = `${id}-${status}.${ext}`;
          const destPath = `${dir}/${fileName}`;
          await copyFile(sourcePath, destPath);
          sprites[status] = { fileName, frames };
        } else {
          sprites[status] = { fileName: existing.sprites[status].fileName, frames };
        }
      }

      const updated: CustomMimeData = {
        id,
        name,
        sprites: sprites as Record<Status, { fileName: string; frames: number }>,
        // Preserve smartImportMeta if present so the Manual editor path doesn't
        // silently drop it (and orphan the source sheet) for a smart-import mime.
        ...(existing.smartImportMeta ? { smartImportMeta: existing.smartImportMeta } : {}),
      };

      await saveMimes(mimes.map((m) => (m.id === id ? updated : m)));
    },
    [mimes, saveMimes, ensureSpritesDir]
  );

  const updateMimeFromSmartImport = useCallback(
    async (
      id: string,
      name: string,
      spriteBlobs: Record<Status, { blob: Uint8Array; frames: number }>,
      sheetBlob: Uint8Array,
      frameInputs: Record<Status, string>
    ) => {
      const existing = mimes.find((m) => m.id === id);
      if (!existing) return;

      info(`[custom-mimes] updateMimeFromSmartImport: id=${id}, name="${name}"`);
      const dir = await ensureSpritesDir();

      const sprites: Record<string, { fileName: string; frames: number }> = {};
      for (const status of ALL_STATUSES) {
        const { blob, frames } = spriteBlobs[status];
        const fileName = `${id}-${status}.png`;
        await writeFile(`${dir}/${fileName}`, blob);
        sprites[status] = { fileName, frames };
      }

      const sheetFileName = `${id}-source.png`;
      await writeFile(`${dir}/${sheetFileName}`, sheetBlob);

      const updated: CustomMimeData = {
        id,
        name,
        sprites: sprites as Record<Status, { fileName: string; frames: number }>,
        smartImportMeta: { sheetFileName, frameInputs },
      };

      await saveMimes(mimes.map((m) => (m.id === id ? updated : m)));
    },
    [mimes, saveMimes, ensureSpritesDir]
  );

  const deleteMime = useCallback(
    async (id: string) => {
      info(`[custom-mimes] deleteMime: id=${id}`);
      const mime = mimes.find((m) => m.id === id);
      if (!mime) return;

      const dir = await ensureSpritesDir();
      for (const status of ALL_STATUSES) {
        const fileName = mime.sprites[status]?.fileName;
        if (fileName) {
          try {
            await remove(`${dir}/${fileName}`);
          } catch {
            /* ok if missing */
          }
        }
      }
      if (mime.smartImportMeta?.sheetFileName) {
        try {
          await remove(`${dir}/${mime.smartImportMeta.sheetFileName}`);
        } catch {
          /* ok if missing */
        }
      }

      await saveMimes(mimes.filter((m) => m.id !== id));
    },
    [mimes, saveMimes, ensureSpritesDir]
  );

  const exportMime = useCallback(async (id: string) => {
    const mime = mimes.find((m) => m.id === id);
    if (!mime) return;

    const dir = await ensureSpritesDir();
    const bytesToBase64 = (bytes: Uint8Array) =>
      btoa(Array.from(bytes).map((b) => String.fromCharCode(b)).join(""));

    let payloadObj: Record<string, unknown>;

    if (mime.smartImportMeta) {
      // v2: ship only sourceSheet + frameInputs. Per-status sprites are
      // regenerable by re-running detection + cropping on import.
      const sheetBytes = await readFile(`${dir}/${mime.smartImportMeta.sheetFileName}`);
      payloadObj = {
        version: 2,
        name: mime.name,
        smartImportMeta: {
          sourceSheet: bytesToBase64(sheetBytes),
          frameInputs: mime.smartImportMeta.frameInputs,
        },
      };
    } else {
      const sprites: Record<string, { frames: number; data: string }> = {};
      for (const status of ALL_STATUSES) {
        const { fileName, frames } = mime.sprites[status];
        const bytes = await readFile(`${dir}/${fileName}`);
        sprites[status] = { frames, data: bytesToBase64(bytes) };
      }
      payloadObj = { version: 1, name: mime.name, sprites };
    }

    const payload = JSON.stringify(payloadObj, null, 2);
    const date = new Date().toISOString().slice(0, 10);
    const safeName = mime.name.replace(/[^a-zA-Z0-9_-]/g, "-");
    const defaultName = `animime-${safeName}-${date}`;

    const dest = await save({
      defaultPath: defaultName,
      filters: [{ name: "Ani-Mime Export", extensions: ["animime"] }],
    });
    if (!dest) return;

    const path = dest.endsWith(".animime") ? dest : `${dest}.animime`;
    const encoder = new TextEncoder();
    await writeFile(path, encoder.encode(payload));
    info(`[custom-mimes] exported "${mime.name}" to ${path} (v${payloadObj.version}, ${payload.length} bytes)`);
  }, [mimes, ensureSpritesDir]);

  const importMime = useCallback(async (): Promise<string | null> => {
    const result = await open({
      multiple: false,
      filters: [{ name: "Ani-Mime Export", extensions: ["animime"] }],
    });
    if (!result) return null;

    const bytes = await readFile(result);
    const decoder = new TextDecoder();
    const payload = JSON.parse(decoder.decode(bytes));

    if (!payload.name || (payload.version !== 1 && payload.version !== 2)) {
      throw new Error("Invalid .animime file");
    }

    const base64ToBytes = (b64: string) => {
      const binary = atob(b64);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    };

    const id = `custom-${Date.now()}`;
    info(`[custom-mimes] importMime: name="${payload.name}", id=${id}, version=${payload.version}`);
    const dir = await ensureSpritesDir();

    const sprites: Record<string, { fileName: string; frames: number }> = {};
    let metaRecord: CustomMimeData["smartImportMeta"];

    if (payload.version === 2) {
      const meta = payload.smartImportMeta;
      if (!meta?.sourceSheet || !meta?.frameInputs) {
        throw new Error("v2 .animime file missing sourceSheet or frameInputs");
      }

      const sheetBytes = base64ToBytes(meta.sourceSheet);
      const sheetFileName = `${id}-source.png`;
      info(`[custom-mimes] v2 import: decoded source sheet (${sheetBytes.length} bytes), writing to disk`);
      await writeFile(`${dir}/${sheetFileName}`, sheetBytes);

      const magicType =
        sheetBytes[0] === 0x47 && sheetBytes[1] === 0x49 && sheetBytes[2] === 0x46 ? "image/gif" :
        sheetBytes[0] === 0xff && sheetBytes[1] === 0xd8 ? "image/jpeg" :
        "image/png";
      const sheetBlob = new Blob([sheetBytes as BlobPart], { type: magicType });
      const src = URL.createObjectURL(sheetBlob);
      try {
        const img = await loadImage(src);
        info(`[custom-mimes] v2 import: loaded image ${img.width}x${img.height}`);
        const prepared = prepareCanvas(img).canvas;
        const detected = detectRows(prepared);
        if (detected.length === 0) {
          throw new Error("Could not detect sprite rows in source sheet");
        }
        const allFrames = extractFrames(detected);
        info(`[custom-mimes] v2 import: detected ${detected.length} rows, ${allFrames.length} frames`);

        for (const status of ALL_STATUSES) {
          const input = meta.frameInputs[status] ?? "";
          const indices = parseFrameInput(input, allFrames.length);
          if (indices.length === 0) {
            throw new Error(`No frames assigned to "${status}" (input="${input}", maxFrame=${allFrames.length})`);
          }
          const strip = await createStripFromFrames(prepared, allFrames, indices);
          const fileName = `${id}-${status}.png`;
          await writeFile(`${dir}/${fileName}`, strip.blob);
          sprites[status] = { fileName, frames: strip.frames };
        }
        info(`[custom-mimes] v2 import: regenerated all ${ALL_STATUSES.length} status sprites`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warn(`[custom-mimes] v2 import failed: ${msg}`);
        throw err instanceof Error ? err : new Error(msg);
      } finally {
        URL.revokeObjectURL(src);
      }

      metaRecord = { sheetFileName, frameInputs: meta.frameInputs };
    } else {
      if (!payload.sprites) throw new Error("v1 .animime file missing sprites");

      for (const status of ALL_STATUSES) {
        const entry = payload.sprites[status];
        if (!entry || !entry.data) {
          throw new Error(`Missing sprite data for "${status}"`);
        }
        const blob = base64ToBytes(entry.data);
        const fileName = `${id}-${status}.png`;
        await writeFile(`${dir}/${fileName}`, blob);
        sprites[status] = { fileName, frames: entry.frames };
      }

      if (payload.smartImportMeta?.sourceSheet && payload.smartImportMeta?.frameInputs) {
        const sheetBytes = base64ToBytes(payload.smartImportMeta.sourceSheet);
        const sheetFileName = `${id}-source.png`;
        await writeFile(`${dir}/${sheetFileName}`, sheetBytes);
        metaRecord = { sheetFileName, frameInputs: payload.smartImportMeta.frameInputs };
      }
    }

    const newMime: CustomMimeData = {
      id,
      name: payload.name,
      sprites: sprites as Record<Status, { fileName: string; frames: number }>,
      ...(metaRecord ? { smartImportMeta: metaRecord } : {}),
    };

    await saveMimes([...mimes, newMime]);
    info(`[custom-mimes] imported "${payload.name}" as ${id}, hasSmartMeta=${!!metaRecord}`);
    return id;
  }, [mimes, saveMimes, ensureSpritesDir]);

  const getSpriteUrl = useCallback(
    async (fileName: string): Promise<string> => {
      const base = await appDataDir();
      const filePath = await join(base, SPRITES_DIR, fileName);
      return convertFileSrc(filePath);
    },
    []
  );

  return { mimes, loaded, pickSpriteFile, addMime, addMimeFromBlobs, updateMime, updateMimeFromSmartImport, deleteMime, exportMime, importMime, getSpriteUrl };
}
