import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SmartImport, serializeFrames } from "../../components/SmartImport";

// Stub the sprite-sheet processor so the test doesn't need a real canvas pipeline.
// Keep the pure string helpers (parseFrameInput / serializeFrames) real since the
// component and tests both use them for input normalization.
vi.mock("../../utils/spriteSheetProcessor", async () => {
  const actual = await vi.importActual<typeof import("../../utils/spriteSheetProcessor")>(
    "../../utils/spriteSheetProcessor"
  );
  const fakeCanvas = () => document.createElement("canvas");
  const fakeFrames = Array.from({ length: 7 }, (_, i) => ({
    index: i, x1: 0, y1: 0, x2: 10, y2: 10,
  }));
  return {
    parseFrameInput: actual.parseFrameInput,
    serializeFrames: actual.serializeFrames,
    loadImage: vi.fn(async () => ({} as HTMLImageElement)),
    prepareCanvas: vi.fn(() => ({ canvas: fakeCanvas(), ctx: null })),
    removeSmallComponents: vi.fn(),
    detectRows: vi.fn(() => [{ top: 0, bottom: 10, spans: [{ x1: 0, x2: 10 }] }]),
    extractFrames: vi.fn(() => fakeFrames),
    getFramePreview: vi.fn((_c: HTMLCanvasElement, f: { index: number }) => `data:fake-${f.index + 1}`),
    createStripFromFrames: vi.fn(async () => ({ blob: new Uint8Array([0]), frames: 1 })),
  };
});

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(async () => new Uint8Array([137, 80, 78, 71])),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("@tauri-apps/plugin-log", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

// jsdom lacks createObjectURL
beforeAll(() => {
  if (!URL.createObjectURL) {
    (URL as any).createObjectURL = vi.fn(() => "blob://fake");
    (URL as any).revokeObjectURL = vi.fn();
  }
});

/** Fake dataTransfer compatible with fireEvent drag events. */
function makeDT() {
  const data: Record<string, string> = {};
  return {
    data,
    setData(k: string, v: string) { data[k] = v; },
    getData(k: string) { return data[k] ?? ""; },
    effectAllowed: "",
    dropEffect: "",
    types: [] as string[],
  } as any;
}

describe("SmartImport", () => {
  it("renders the dropzone when no file is loaded", () => {
    render(<SmartImport onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/Choose a sprite sheet/i)).toBeInTheDocument();
  });

  it("mounts the picker screen with edit-mode props", () => {
    render(
      <SmartImport
        onSave={vi.fn()}
        onCancel={vi.fn()}
        initialName="EditMe"
        editingId="custom-abc"
      />
    );
    expect(screen.getByTestId("smart-import-pick")).toBeInTheDocument();
  });
});

describe("serializeFrames", () => {
  it("returns empty string for empty array", () => {
    expect(serializeFrames([])).toBe("");
  });
  it("collapses ascending runs", () => {
    expect(serializeFrames([1, 2, 3, 4])).toBe("1-4");
  });
  it("preserves descending runs as a-b", () => {
    expect(serializeFrames([3, 2, 1])).toBe("3-1");
  });
  it("joins mixed singletons and runs", () => {
    expect(serializeFrames([1, 3, 4, 5, 7])).toBe("1,3-5,7");
  });
  it("keeps duplicates as singletons", () => {
    expect(serializeFrames([2, 2, 3])).toBe("2,2,3");
  });
});

describe("SmartImport frame editor", () => {
  it("removes a frame when × is clicked", async () => {
    render(<SmartImport onSave={vi.fn()} onCancel={vi.fn()} initialFilePath="/fake.png" />);
    const btn = await screen.findByTestId("frame-remove-idle-1");
    fireEvent.click(btn);
    await waitFor(() => {
      expect(screen.queryByTestId("frame-chip-idle-1")).toBeNull();
    });
  });

  it("moves a frame from busy to idle on drop (cross-group move)", async () => {
    render(<SmartImport onSave={vi.fn()} onCancel={vi.fn()} initialFilePath="/fake.png" />);
    const source = await screen.findByTestId("frame-chip-busy-2");
    const target = await screen.findByTestId("frame-chip-idle-1");
    const dataTransfer = makeDT();
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientX: 0 });
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => {
      const list = screen.getByTestId("frame-list-idle");
      const nums = [...list.querySelectorAll(".smart-import-frame-num")].map((n) => n.textContent);
      expect(nums).toEqual(["2", "1"]);
    });
    // source lost it
    expect(screen.queryByTestId("frame-chip-busy-2")).toBeNull();
  });

  it("normalizes text input on blur and rebuilds thumbs", async () => {
    render(<SmartImport onSave={vi.fn()} onCancel={vi.fn()} initialFilePath="/fake.png" />);
    await screen.findByTestId("frame-list-idle");
    const input = screen.getAllByPlaceholderText("1-5")[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1,2,3" } });
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe("1-3"));
    expect(screen.getByTestId("frame-chip-idle-1")).toBeInTheDocument();
    expect(screen.getByTestId("frame-chip-idle-2")).toBeInTheDocument();
    expect(screen.getByTestId("frame-chip-idle-3")).toBeInTheDocument();
  });

  it("copies a frame when Alt is held during drop", async () => {
    render(<SmartImport onSave={vi.fn()} onCancel={vi.fn()} initialFilePath="/fake.png" />);
    const source = await screen.findByTestId("frame-chip-busy-2");
    const target = await screen.findByTestId("frame-chip-idle-1");
    const dataTransfer = makeDT();
    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer, clientX: 0 });
    // Simulate Alt-held: testing-library doesn't reliably propagate altKey
    // through drag events, so set dropEffect directly (production sets this
    // during dragOver when e.altKey is true).
    dataTransfer.dropEffect = "copy";
    fireEvent.drop(target, { dataTransfer });
    await waitFor(() => {
      expect(screen.getByTestId("frame-chip-idle-2")).toBeInTheDocument();
    });
    // source kept it
    expect(screen.getByTestId("frame-chip-busy-2")).toBeInTheDocument();
  });

});
