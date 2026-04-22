import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { InstallPromptDialog } from "../../components/InstallPromptDialog";
import type { InstallPromptPayload } from "../../hooks/useInstallPrompt";

const mockImportFromBytes = vi.fn();

vi.mock("../../hooks/useCustomMimes", () => ({
  useCustomMimes: () => ({
    mimes: [],
    loaded: true,
    importFromBytes: mockImportFromBytes,
    pickSpriteFile: vi.fn(),
    addMime: vi.fn(),
    addMimeFromBlobs: vi.fn(),
    updateMime: vi.fn(),
    updateMimeFromSmartImport: vi.fn(),
    deleteMime: vi.fn(),
    exportMime: vi.fn(),
    importMime: vi.fn(),
    getSpriteUrl: vi.fn(),
  }),
}));

const basePrompt: InstallPromptPayload = {
  id: "pkg-123",
  name: "Cool Mime",
  creator: "Alice",
  size_bytes: 2048,
  preview_url: "https://example.com/preview.gif",
  download_url: "https://example.com/bundle.animime",
};

describe("InstallPromptDialog", () => {
  beforeEach(() => {
    mockImportFromBytes.mockReset();
  });

  it("renders nothing when prompt is null and error is null", () => {
    const { container } = render(
      <InstallPromptDialog prompt={null} error={null} onDone={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders error-only card when prompt is null but error is set", () => {
    render(
      <InstallPromptDialog
        prompt={null}
        error="Marketplace fetch failed"
        onDone={vi.fn()}
      />
    );
    expect(screen.getByTestId("install-prompt-dialog")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Marketplace fetch failed"
    );
    expect(screen.queryByTestId("install-confirm")).toBeNull();
  });

  it("Close button fires onDone from error-only state", () => {
    const onDone = vi.fn();
    render(
      <InstallPromptDialog
        prompt={null}
        error="Bad format"
        onDone={onDone}
      />
    );
    fireEvent.click(screen.getByTestId("install-cancel"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("merges Rust error prop into error slot when prompt is present", () => {
    render(
      <InstallPromptDialog
        prompt={basePrompt}
        error="Network failure"
        onDone={vi.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Network failure");
    // preview/name still rendered
    expect(screen.getByText("Cool Mime")).toBeInTheDocument();
  });

  it("renders name, creator, and size when prompt is provided", () => {
    render(<InstallPromptDialog prompt={basePrompt} onDone={vi.fn()} />);
    expect(screen.getByTestId("install-prompt-dialog")).toBeInTheDocument();
    expect(screen.getByText("Cool Mime")).toBeInTheDocument();
    expect(screen.getByText("by Alice")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
  });

  it("shows '< 1 KB' for sub-1024-byte prompt", () => {
    render(
      <InstallPromptDialog
        prompt={{ ...basePrompt, size_bytes: 512 }}
        onDone={vi.fn()}
      />
    );
    expect(screen.getByText("< 1 KB")).toBeInTheDocument();
  });

  it("does not render creator line when creator is null", () => {
    render(
      <InstallPromptDialog
        prompt={{ ...basePrompt, creator: null }}
        onDone={vi.fn()}
      />
    );
    expect(screen.queryByText(/^by /)).toBeNull();
  });

  it("Cancel button fires onDone", () => {
    const onDone = vi.fn();
    render(<InstallPromptDialog prompt={basePrompt} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("install-cancel"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("Install button fetches bytes, calls importFromBytes, then fires onDone", async () => {
    const onDone = vi.fn();
    const fakeBytes = new Uint8Array([1, 2, 3]);
    const fakeBuffer = fakeBytes.buffer;

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValueOnce(fakeBuffer),
    } as unknown as Response);

    mockImportFromBytes.mockResolvedValueOnce("custom-999");

    render(<InstallPromptDialog prompt={basePrompt} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("install-confirm"));

    await waitFor(() => {
      expect(mockImportFromBytes).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        "Cool Mime.animime"
      );
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows error and clears busy when fetch fails", async () => {
    const onDone = vi.fn();

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as unknown as Response);

    render(<InstallPromptDialog prompt={basePrompt} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("install-confirm"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Download failed (HTTP 503)"
      );
    });

    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId("install-cancel")).not.toBeDisabled();
  });

  it("shows error when importFromBytes rejects", async () => {
    const onDone = vi.fn();
    const fakeBytes = new Uint8Array([1]).buffer;

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValueOnce(fakeBytes),
    } as unknown as Response);

    mockImportFromBytes.mockRejectedValueOnce(new Error("Invalid .animime file"));

    render(<InstallPromptDialog prompt={basePrompt} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("install-confirm"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid .animime file");
    });

    expect(onDone).not.toHaveBeenCalled();
  });
});
