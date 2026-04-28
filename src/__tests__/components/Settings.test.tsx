import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Settings } from "../../components/Settings";

// Mock all hooks used by Settings
vi.mock("../../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark" as const, setTheme: vi.fn(), loaded: true }),
}));

vi.mock("../../hooks/usePet", () => ({
  usePet: () => ({ pet: "rottweiler", setPet: vi.fn(), loaded: true }),
}));

vi.mock("../../hooks/useBubble", () => ({
  useBubble: () => ({
    visible: false,
    message: "",
    dismiss: vi.fn(),
    enabled: true,
    setEnabled: vi.fn(),
  }),
}));

vi.mock("../../hooks/useGlow", () => ({
  useGlow: () => ({ mode: "light" as const, setMode: vi.fn() }),
}));

vi.mock("../../hooks/useNickname", () => ({
  useNickname: () => ({ nickname: "TestDog", setNickname: vi.fn(), loaded: true }),
}));

vi.mock("../../hooks/useScale", () => ({
  useScale: () => ({
    scale: 1 as const,
    setScale: vi.fn(),
    SCALE_PRESETS: [0.5, 1, 1.5, 2],
  }),
}));

const { mockMimes } = vi.hoisted(() => ({ mockMimes: { current: [] as any[] } }));

vi.mock("../../hooks/useCustomMimes", () => ({
  useCustomMimes: () => ({
    mimes: mockMimes.current,
    loaded: true,
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
  ALL_STATUSES: [
    "idle",
    "busy",
    "service",
    "disconnected",
    "searching",
    "waiting",
    "initializing",
    "visiting",
  ],
}));

// Mock SmartImport component
vi.mock("../../components/SmartImport", () => ({
  SmartImport: () => <div data-testid="smart-import">SmartImport</div>,
}));

/** Click a sidebar tab by name */
function clickTab(container: HTMLElement, name: string) {
  const btn = container.querySelector(`.sidebar-item:nth-child(${
    name === "General" ? 1 : name === "Mime" ? 2 : 3
  })`) as HTMLElement;
  fireEvent.click(btn);
}

describe("Settings", () => {
  beforeEach(() => {
    mockMimes.current = [];
  });

  it("renders sidebar with tabs", async () => {
    const { container } = render(<Settings />);

    await waitFor(() => {
      const sidebar = container.querySelector(".settings-sidebar")!;
      expect(sidebar).toBeInTheDocument();
      const sidebarButtons = sidebar.querySelectorAll(".sidebar-item");
      expect(sidebarButtons).toHaveLength(3);
      expect(sidebarButtons[0].textContent).toBe("General");
      expect(sidebarButtons[1].textContent).toBe("Mime");
      expect(sidebarButtons[2].textContent).toBe("About");
    });
  });

  it("renders General tab by default with appearance settings", async () => {
    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByText("Appearance")).toBeInTheDocument();
      expect(screen.getByText("Glow Effect")).toBeInTheDocument();
      expect(screen.getByText("Theme")).toBeInTheDocument();
    });
  });

  it("renders Behavior section in General tab", async () => {
    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByText("Behavior")).toBeInTheDocument();
      expect(screen.getByText("Speech Bubbles")).toBeInTheDocument();
    });
  });

  it("renders glow mode buttons (Off, Light, Dark)", async () => {
    render(<Settings />);

    await waitFor(() => {
      expect(screen.getByText("Off")).toBeInTheDocument();
      // "Light" and "Dark" appear in both glow and theme toggles
      expect(screen.getAllByText("Light").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Dark").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders theme buttons (Dark and Light)", async () => {
    render(<Settings />);

    await waitFor(() => {
      const darkButtons = screen.getAllByText("Dark");
      const lightButtons = screen.getAllByText("Light");
      // 2 each: one in glow toggle, one in theme toggle
      expect(darkButtons).toHaveLength(2);
      expect(lightButtons).toHaveLength(2);
    });
  });

  it("switches to Mime tab", async () => {
    const { container } = render(<Settings />);

    await waitFor(() => {
      expect(container.querySelector(".settings-sidebar")).toBeInTheDocument();
    });

    clickTab(container, "Mime");

    await waitFor(() => {
      expect(screen.getByText("Select your mime")).toBeInTheDocument();
      expect(screen.getByText("Identity")).toBeInTheDocument();
    });
  });

  it("renders nickname input in Mime tab", async () => {
    const { container } = render(<Settings />);

    await waitFor(() => {
      expect(container.querySelector(".settings-sidebar")).toBeInTheDocument();
    });

    clickTab(container, "Mime");

    await waitFor(() => {
      expect(screen.getByText("Nickname")).toBeInTheDocument();
      const input = screen.getByPlaceholderText("Enter your name");
      expect(input).toHaveValue("TestDog");
    });
  });

  it("renders Display Size section in Mime tab", async () => {
    const { container } = render(<Settings />);

    await waitFor(() => {
      expect(container.querySelector(".settings-sidebar")).toBeInTheDocument();
    });

    clickTab(container, "Mime");

    await waitFor(() => {
      expect(screen.getByText("Display Size")).toBeInTheDocument();
      expect(screen.getByText("Scale")).toBeInTheDocument();
      expect(screen.getByText("Tiny")).toBeInTheDocument();
      expect(screen.getByText("Normal")).toBeInTheDocument();
      expect(screen.getByText("Large")).toBeInTheDocument();
      expect(screen.getByText("XL")).toBeInTheDocument();
    });
  });

  it("renders pet cards in Mime tab", async () => {
    const { container } = render(<Settings />);

    await waitFor(() => {
      expect(container.querySelector(".settings-sidebar")).toBeInTheDocument();
    });

    clickTab(container, "Mime");

    await waitFor(() => {
      expect(screen.getByText("Rottweiler")).toBeInTheDocument();
      expect(screen.getByText("Dalmatian")).toBeInTheDocument();
      expect(screen.getByText("Samurai")).toBeInTheDocument();
    });
  });

  it("switches to About tab", async () => {
    const { container } = render(<Settings />);

    await waitFor(() => {
      expect(container.querySelector(".settings-sidebar")).toBeInTheDocument();
    });

    clickTab(container, "About");

    await waitFor(() => {
      expect(screen.getByText("Ani-Mime")).toBeInTheDocument();
      expect(screen.getByText(/Version \d+\.\d+\.\d+/)).toBeInTheDocument();
    });
  });

  it("renders author info in About tab", async () => {
    const { container } = render(<Settings />);

    await waitFor(() => {
      expect(container.querySelector(".settings-sidebar")).toBeInTheDocument();
    });

    clickTab(container, "About");

    await waitFor(() => {
      expect(screen.getByText("vietnguyenhoangw")).toBeInTheDocument();
      expect(screen.getByText("@vietnguyenw")).toBeInTheDocument();
    });
  });

  const ALL_STATUSES_CONST = ["idle", "busy", "service", "disconnected", "searching", "waiting", "initializing", "visiting"] as const;

  function buildSprites(id: string) {
    return Object.fromEntries(
      ALL_STATUSES_CONST.map((s) => [s, { fileName: `${id}-${s}.png`, frames: 3 }])
    );
  }

  it("editing a smart-import mime opens the Smart Import editor", async () => {
    mockMimes.current = [{
      id: "custom-smart-1",
      name: "Smarty",
      sprites: buildSprites("custom-smart-1"),
      smartImportMeta: {
        sheetFileName: "custom-smart-1-source.png",
        frameInputs: Object.fromEntries(ALL_STATUSES_CONST.map((s) => [s, "1-3"])),
      },
    }];

    const { container } = render(<Settings />);
    await waitFor(() => {
      expect(container.querySelector(".settings-sidebar")).toBeInTheDocument();
    });
    clickTab(container, "Mime");

    const editBtn = await screen.findByTestId("edit-mime-custom-smart-1");
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByTestId("smart-import")).toBeInTheDocument();
    });
    // Manual editor's "Choose PNG" hallmark must NOT be present
    expect(screen.queryByText(/Choose PNG/)).not.toBeInTheDocument();
  });

  it("editing a manual (no meta) mime opens the Manual editor", async () => {
    mockMimes.current = [{
      id: "custom-manual-1",
      name: "Manny",
      sprites: buildSprites("custom-manual-1"),
      // no smartImportMeta
    }];

    const { container } = render(<Settings />);
    await waitFor(() => {
      expect(container.querySelector(".settings-sidebar")).toBeInTheDocument();
    });
    clickTab(container, "Mime");

    const editBtn = await screen.findByTestId("edit-mime-custom-manual-1");
    fireEvent.click(editBtn);

    await waitFor(() => {
      // Manual editor is inline; "Choose PNG" is on each status's file picker button
      expect(screen.queryAllByText(/Choose PNG|[a-z0-9-]+\.png/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("smart-import")).not.toBeInTheDocument();
  });

  it("editing a LEGACY pre-feature mime (no smartImportMeta key at all) opens the Manual editor", async () => {
    // Distinct from manual-created: the legacy JSON shape has NO smartImportMeta key.
    // This guards against an accidental `'smartImportMeta' in mime` check that would split their behavior.
    const legacy = {
      id: "custom-legacy-1",
      name: "FromOldBuild",
      sprites: buildSprites("custom-legacy-1"),
    };
    mockMimes.current = [legacy];

    const { container } = render(<Settings />);
    await waitFor(() => {
      expect(container.querySelector(".settings-sidebar")).toBeInTheDocument();
    });
    clickTab(container, "Mime");

    const editBtn = await screen.findByTestId("edit-mime-custom-legacy-1");
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.queryAllByText(/Choose PNG|[a-z0-9-]+\.png/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId("smart-import")).not.toBeInTheDocument();
  });
});
