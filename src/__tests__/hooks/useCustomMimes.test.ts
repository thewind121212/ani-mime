import { renderHook, act } from "@testing-library/react";
import { useCustomMimes, ALL_STATUSES } from "../../hooks/useCustomMimes";
import { mockStoreValue, getMockStore } from "../../__mocks__/tauri-store";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";
import { mkdir, writeFile, remove, exists } from "@tauri-apps/plugin-fs";
import type { CustomMimeData } from "../../types/status";

/** Helper: build a full sprites record for all statuses */
function makeSpriteRecord(
  prefix: string
): CustomMimeData["sprites"] {
  const sprites: Record<string, { fileName: string; frames: number }> = {};
  for (const status of ALL_STATUSES) {
    sprites[status] = { fileName: `${prefix}-${status}.png`, frames: 4 };
  }
  return sprites as CustomMimeData["sprites"];
}

/** Helper: build a complete CustomMimeData */
function makeMime(id: string, name: string): CustomMimeData {
  return { id, name, sprites: makeSpriteRecord(id) };
}

/** Helper: build blobs record for addMimeFromBlobs */
function makeBlobsRecord(): Record<
  string,
  { blob: Uint8Array; frames: number }
> {
  const blobs: Record<string, { blob: Uint8Array; frames: number }> = {};
  for (const status of ALL_STATUSES) {
    blobs[status] = { blob: new Uint8Array([1, 2, 3]), frames: 4 };
  }
  return blobs;
}

describe("useCustomMimes", () => {
  it("defaults to empty mimes array", async () => {
    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    expect(result.current.mimes).toEqual([]);
    expect(result.current.loaded).toBe(true);
  });

  it("loads saved mimes from store", async () => {
    const saved = [makeMime("custom-111", "TestMime")];
    mockStoreValue("settings.json", "customMimes", saved);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    expect(result.current.mimes).toEqual(saved);
    expect(result.current.loaded).toBe(true);
  });

  it("addMimeFromBlobs creates sprite files and updates mimes list", async () => {
    // exists returns false so mkdir is called
    vi.mocked(exists).mockResolvedValue(false);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    let returnedId: string | undefined;
    await act(async () => {
      returnedId = await result.current.addMimeFromBlobs(
        "BlobMime",
        makeBlobsRecord() as any
      );
    });

    // mkdir was called to ensure sprites directory
    expect(mkdir).toHaveBeenCalledWith(
      "/mock/app-data/custom-sprites",
      { recursive: true }
    );

    // writeFile was called once for each status
    expect(writeFile).toHaveBeenCalledTimes(ALL_STATUSES.length);

    // Each call writes to the correct path pattern
    for (const call of vi.mocked(writeFile).mock.calls) {
      expect(call[0]).toMatch(/^\/mock\/app-data\/custom-sprites\/custom-\d+-\w+\.png$/);
      expect(call[1]).toBeInstanceOf(Uint8Array);
    }

    // State updated with new mime
    expect(result.current.mimes).toHaveLength(1);
    expect(result.current.mimes[0].name).toBe("BlobMime");
    expect(returnedId).toBeDefined();
    expect(returnedId).toMatch(/^custom-\d+$/);

    // All statuses have sprite entries
    for (const status of ALL_STATUSES) {
      expect(result.current.mimes[0].sprites[status]).toBeDefined();
      expect(result.current.mimes[0].sprites[status].frames).toBe(4);
    }

    // Persisted to store
    const store = getMockStore("settings.json");
    expect(store!.set).toHaveBeenCalledWith("customMimes", expect.any(Array));
    expect(store!.save).toHaveBeenCalled();
  });

  it("deleteMime removes from list", async () => {
    const mime = makeMime("custom-222", "ToDelete");
    mockStoreValue("settings.json", "customMimes", [mime]);

    // exists returns true so mkdir is not called
    vi.mocked(exists).mockResolvedValue(true);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    expect(result.current.mimes).toHaveLength(1);

    await act(async () => {
      await result.current.deleteMime("custom-222");
    });

    // remove was called for each status sprite
    expect(remove).toHaveBeenCalledTimes(ALL_STATUSES.length);

    expect(result.current.mimes).toHaveLength(0);

    // Persisted to store
    const store = getMockStore("settings.json");
    expect(store!.set).toHaveBeenCalledWith("customMimes", []);
    expect(store!.save).toHaveBeenCalled();
  });

  it("deleteMime handles missing files gracefully", async () => {
    const mime = makeMime("custom-333", "MissingFiles");
    mockStoreValue("settings.json", "customMimes", [mime]);

    vi.mocked(exists).mockResolvedValue(true);
    // Simulate file not found on remove
    vi.mocked(remove).mockRejectedValue(new Error("file not found"));

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    // Should not throw
    await act(async () => {
      await result.current.deleteMime("custom-333");
    });

    // Still removed from the list despite file errors
    expect(result.current.mimes).toHaveLength(0);
  });

  it("updates when custom-mimes-changed event fires", async () => {
    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    expect(result.current.mimes).toEqual([]);

    const eventMimes = [makeMime("custom-444", "EventMime")];
    await act(async () => {
      emitMockEvent("custom-mimes-changed", eventMimes);
    });

    expect(result.current.mimes).toEqual(eventMimes);
  });

  it("addMimeFromBlobs writes source sheet + stores meta when smartImportMeta provided", async () => {
    vi.mocked(exists).mockResolvedValue(true);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    const frameInputs: Record<string, string> = {};
    for (const status of ALL_STATUSES) frameInputs[status] = "1-3";

    let returnedId: string | undefined;
    await act(async () => {
      returnedId = await result.current.addMimeFromBlobs(
        "SmartMime",
        makeBlobsRecord() as any,
        {
          sheetBlob: new Uint8Array([9, 9, 9]),
          frameInputs: frameInputs as Record<
            import("../../types/status").Status,
            string
          >,
        }
      );
    });

    // 7 status strips + 1 source sheet = 8 writes
    expect(writeFile).toHaveBeenCalledTimes(ALL_STATUSES.length + 1);

    // Exactly one of the writes targets the <id>-source.png path
    const sheetCall = vi
      .mocked(writeFile)
      .mock.calls.find((c) => /\/custom-\d+-source\.png$/.test(c[0] as string));
    expect(sheetCall).toBeDefined();
    expect(sheetCall![1]).toEqual(new Uint8Array([9, 9, 9]));

    // Persisted mime carries smartImportMeta with the correct sheetFileName
    expect(result.current.mimes[0].smartImportMeta).toBeDefined();
    expect(result.current.mimes[0].smartImportMeta!.sheetFileName).toMatch(
      /^custom-\d+-source\.png$/
    );
    expect(result.current.mimes[0].smartImportMeta!.frameInputs).toEqual(
      frameInputs
    );
    expect(returnedId).toMatch(/^custom-\d+$/);
  });

  it("addMimeFromBlobs omits smartImportMeta when not provided (backward compatible)", async () => {
    vi.mocked(exists).mockResolvedValue(true);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    await act(async () => {
      await result.current.addMimeFromBlobs(
        "NoMetaMime",
        makeBlobsRecord() as any
      );
    });

    // Only 7 writes (no source sheet)
    expect(writeFile).toHaveBeenCalledTimes(ALL_STATUSES.length);
    expect(result.current.mimes[0].smartImportMeta).toBeUndefined();
  });

  it("loads a legacy-shaped store entry (no smartImportMeta field) cleanly", async () => {
    // Simulate a mime persisted by a pre-feature build: the JSON has no
    // smartImportMeta key at all (not even undefined). This guards against
    // code paths that would crash on a missing field or add one spuriously.
    const legacyEntry = {
      id: "custom-legacy-001",
      name: "FromOldBuild",
      sprites: {
        idle: { fileName: "custom-legacy-001-idle.png", frames: 4 },
        busy: { fileName: "custom-legacy-001-busy.png", frames: 4 },
        service: { fileName: "custom-legacy-001-service.png", frames: 4 },
        disconnected: { fileName: "custom-legacy-001-disconnected.png", frames: 4 },
        searching: { fileName: "custom-legacy-001-searching.png", frames: 4 },
        initializing: { fileName: "custom-legacy-001-initializing.png", frames: 4 },
        visiting: { fileName: "custom-legacy-001-visiting.png", frames: 4 },
      },
    };
    mockStoreValue("settings.json", "customMimes", [legacyEntry]);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    expect(result.current.mimes).toHaveLength(1);
    expect(result.current.mimes[0].id).toBe("custom-legacy-001");
    // Key assertion: missing field is exposed as `undefined`, not throwing.
    expect(result.current.mimes[0].smartImportMeta).toBeUndefined();
  });

  it("updateMimeFromSmartImport overwrites strips + source sheet and updates meta", async () => {
    const existing: CustomMimeData = {
      id: "custom-777",
      name: "OldName",
      sprites: makeSpriteRecord("custom-777"),
      smartImportMeta: {
        sheetFileName: "custom-777-source.png",
        frameInputs: ALL_STATUSES.reduce<Record<string, string>>((acc, s) => {
          acc[s] = "1-2";
          return acc;
        }, {}),
      },
    } as any;
    mockStoreValue("settings.json", "customMimes", [existing]);
    vi.mocked(exists).mockResolvedValue(true);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});
    vi.mocked(writeFile).mockClear();

    const newInputs: Record<string, string> = {};
    for (const status of ALL_STATUSES) newInputs[status] = "3-6";

    await act(async () => {
      await result.current.updateMimeFromSmartImport(
        "custom-777",
        "NewName",
        makeBlobsRecord() as any,
        new Uint8Array([5, 5, 5]),
        newInputs as Record<import("../../types/status").Status, string>
      );
    });

    // 7 strips + 1 sheet overwritten
    expect(writeFile).toHaveBeenCalledTimes(ALL_STATUSES.length + 1);

    // All writes target filenames prefixed with the existing id (no new id generated)
    for (const call of vi.mocked(writeFile).mock.calls) {
      expect(call[0]).toMatch(/\/custom-777-/);
    }

    const updated = result.current.mimes.find((m) => m.id === "custom-777")!;
    expect(updated.name).toBe("NewName");
    expect(updated.smartImportMeta!.frameInputs).toEqual(newInputs);
    expect(updated.smartImportMeta!.sheetFileName).toBe("custom-777-source.png");

    // Sprite frame counts reflect the new blobs (4 from makeBlobsRecord)
    for (const status of ALL_STATUSES) {
      expect(updated.sprites[status].frames).toBe(4);
    }
  });

  it("updateMimeFromSmartImport is a no-op if id is unknown", async () => {
    mockStoreValue("settings.json", "customMimes", []);
    vi.mocked(exists).mockResolvedValue(true);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});
    vi.mocked(writeFile).mockClear();

    await act(async () => {
      await result.current.updateMimeFromSmartImport(
        "custom-does-not-exist",
        "x",
        makeBlobsRecord() as any,
        new Uint8Array([1]),
        ALL_STATUSES.reduce<Record<string, string>>((a, s) => { a[s] = "1"; return a; }, {}) as any
      );
    });

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("deleteMime removes the source sheet when smartImportMeta is present", async () => {
    const mime: CustomMimeData = {
      id: "custom-888",
      name: "SmartToDelete",
      sprites: makeSpriteRecord("custom-888"),
      smartImportMeta: {
        sheetFileName: "custom-888-source.png",
        frameInputs: ALL_STATUSES.reduce<Record<string, string>>((a, s) => { a[s] = "1"; return a; }, {}),
      },
    } as any;
    mockStoreValue("settings.json", "customMimes", [mime]);
    vi.mocked(exists).mockResolvedValue(true);
    vi.mocked(remove).mockResolvedValue(undefined);

    const { result } = renderHook(() => useCustomMimes());
    await act(async () => {});

    await act(async () => {
      await result.current.deleteMime("custom-888");
    });

    // 7 strips + 1 source sheet = 8 removes
    expect(remove).toHaveBeenCalledTimes(ALL_STATUSES.length + 1);
    const sheetRemove = vi
      .mocked(remove)
      .mock.calls.find((c) => /custom-888-source\.png$/.test(c[0] as string));
    expect(sheetRemove).toBeDefined();
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useCustomMimes());
    await act(async () => {});

    // useCustomMimes registers a listener for custom-mimes-changed
    expect(listen).toHaveBeenCalledWith(
      "custom-mimes-changed",
      expect.any(Function)
    );

    const eventMimes = [makeMime("custom-555", "BeforeUnmount")];
    await act(async () => {
      emitMockEvent("custom-mimes-changed", eventMimes);
    });
    expect(result.current.mimes).toEqual(eventMimes);

    unmount();

    // Emit after unmount — state should not change
    const afterMimes = [makeMime("custom-666", "AfterUnmount")];
    await act(async () => {
      emitMockEvent("custom-mimes-changed", afterMimes);
    });

    expect(result.current.mimes).toEqual(eventMimes);
  });
});
