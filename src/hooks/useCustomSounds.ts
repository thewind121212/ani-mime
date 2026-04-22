import { useState, useLayoutEffect, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, exists, remove, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { info, warn } from "@tauri-apps/plugin-log";

const STORE_FILE = "settings.json";
const STORE_KEY = "customSounds";
const SOUNDS_DIR = "custom-sounds";
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const ACCEPTED_EXTENSIONS = ["mp3", "wav", "ogg", "m4a", "aac", "flac"] as const;

export interface CustomSound {
  id: string;
  name: string;
  fileName: string;
  sizeBytes: number;
}

/** URL cache: blob URLs live for the session. Invalidated when a sound is deleted. */
const urlCache = new Map<string, string>();

async function buildBlobUrl(fileName: string): Promise<string> {
  const base = await appDataDir();
  const path = await join(base, SOUNDS_DIR, fileName);
  const bytes = await readFile(path);
  const blob = new Blob([bytes as BlobPart]);
  return URL.createObjectURL(blob);
}

export function useCustomSounds() {
  const [sounds, setSounds] = useState<CustomSound[]>([]);
  const [loaded, setLoaded] = useState(false);

  useLayoutEffect(() => {
    load(STORE_FILE).then(async (store) => {
      const saved = await store.get<CustomSound[]>(STORE_KEY);
      setSounds(saved ?? []);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<CustomSound[]>("custom-sounds-changed", (e) => {
      setSounds(e.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const persist = useCallback(async (next: CustomSound[]) => {
    setSounds(next);
    const store = await load(STORE_FILE);
    await store.set(STORE_KEY, next);
    await store.save();
    await emit("custom-sounds-changed", next);
  }, []);

  const ensureDir = useCallback(async () => {
    const base = await appDataDir();
    const dir = await join(base, SOUNDS_DIR);
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
      info(`[custom-sounds] created dir: ${dir}`);
    }
    return dir;
  }, []);

  /**
   * Prompt for an audio file, validate its size + extension, copy it into the
   * app data dir and persist. Returns the new sound, or throws with a user-
   * facing error message.
   */
  const importSound = useCallback(async (): Promise<CustomSound | null> => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: [...ACCEPTED_EXTENSIONS] }],
    });
    if (!picked) return null;

    const ext = (picked.split(".").pop() ?? "").toLowerCase();
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new Error(`Unsupported file type .${ext}`);
    }

    // Read once — used for both size check and write. For a 2 MB limit the
    // memory cost is negligible and it avoids needing the `stat` permission.
    const bytes = await readFile(picked);
    if (bytes.length > MAX_SIZE_BYTES) {
      throw new Error(
        `File is ${(bytes.length / 1024 / 1024).toFixed(2)} MB — the limit is 2 MB`
      );
    }

    const id = `custom-${Date.now()}`;
    const fileName = `${id}.${ext}`;
    const displayName = picked.split("/").pop() ?? fileName;

    const dir = await ensureDir();
    await writeFile(`${dir}/${fileName}`, bytes);

    const record: CustomSound = {
      id,
      name: displayName,
      fileName,
      sizeBytes: bytes.length,
    };

    await persist([...sounds, record]);
    info(`[custom-sounds] imported "${displayName}" as ${id} (${bytes.length} bytes)`);
    return record;
  }, [sounds, persist, ensureDir]);

  const deleteSound = useCallback(
    async (id: string) => {
      const found = sounds.find((s) => s.id === id);
      if (!found) return;
      const dir = await ensureDir();
      try {
        await remove(`${dir}/${found.fileName}`);
      } catch (err) {
        warn(`[custom-sounds] failed to remove ${found.fileName}: ${err}`);
      }
      // Invalidate cached blob URL so a later sound with the same id (unlikely
      // but possible) doesn't point at stale bytes.
      const cached = urlCache.get(id);
      if (cached) {
        URL.revokeObjectURL(cached);
        urlCache.delete(id);
      }
      await persist(sounds.filter((s) => s.id !== id));
      info(`[custom-sounds] deleted ${id}`);
    },
    [sounds, persist, ensureDir]
  );

  const getSoundUrl = useCallback(async (id: string): Promise<string | null> => {
    const cached = urlCache.get(id);
    if (cached) return cached;
    const found = sounds.find((s) => s.id === id);
    if (!found) return null;
    const url = await buildBlobUrl(found.fileName);
    urlCache.set(id, url);
    return url;
  }, [sounds]);

  return { sounds, loaded, importSound, deleteSound, getSoundUrl };
}

export { MAX_SIZE_BYTES };
