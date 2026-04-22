import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";
import {
  emitMockEvent,
  listenerCount,
  resetMocks,
  resolveListen,
  setListenMode,
} from "../../__mocks__/tauri-event";

describe("useInstallPrompt", () => {
  afterEach(() => {
    resetMocks();
  });

  it("captures install-prompt event payloads", async () => {
    const { result } = renderHook(() => useInstallPrompt());

    // Wait for useEffect listener registration to settle
    await act(async () => {});

    act(() => {
      emitMockEvent("install-prompt", {
        id: "abc",
        name: "Cat",
        creator: "me",
        size_bytes: 1024,
        preview_url: "/p",
        download_url: "/d",
      });
    });

    expect(result.current.prompt?.name).toBe("Cat");

    act(() => result.current.clear());

    expect(result.current.prompt).toBeNull();
  });

  it("handles nullable creator field", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    await act(async () => {});

    act(() => {
      emitMockEvent("install-prompt", {
        id: "xyz",
        name: "Dog",
        creator: null,
        size_bytes: 2048,
        preview_url: "/prev",
        download_url: "/dl",
      });
    });

    expect(result.current.prompt?.creator).toBeNull();
    expect(result.current.prompt?.id).toBe("xyz");
  });

  it("starts with null prompt", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.prompt).toBeNull();
  });

  it("cleans up listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useInstallPrompt());
    await act(async () => {});

    // Listener must be registered before unmount
    expect(listenerCount("install-prompt")).toBe(1);

    unmount();

    // After unmount the unlisten callback must have removed the handler
    expect(listenerCount("install-prompt")).toBe(0);

    // Behavioral confirmation: emitting after unmount must not change state
    act(() => {
      emitMockEvent("install-prompt", {
        id: "abc",
        name: "Cat",
        creator: null,
        size_bytes: 1024,
        preview_url: "/p",
        download_url: "/d",
      });
    });

    expect(result.current.prompt).toBeNull();
  });

  it("does not leak listener when unmounted before listen() resolves", async () => {
    // Switch to deferred mode so the listen() promise won't resolve until we say so.
    // The mock's pendingResolve slot is last-write-wins: the hook registers two
    // listeners ("install-prompt" then "install-error"), so resolveListen() resolves
    // the last-registered one ("install-error").
    setListenMode("deferred");

    const { unmount } = renderHook(() => useInstallPrompt());

    // Unmount BEFORE either listen() promise has resolved — cleanup runs with
    // unlistenRef.current still null in the buggy implementation
    unmount();

    // Now resolve the pending listen() promise — the .then callback fires
    await act(async () => {
      resolveListen();
    });

    // The handler was added to `handlers` inside listen() before the promise
    // was returned, but the unlisten fn must have been called immediately
    // because the component was already unmounted. The mock only supports one
    // pending resolve at a time, so we verify the last-registered event ("install-error").
    expect(listenerCount("install-error")).toBe(0);
  });

  it("captures install-error payload in error state", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    await act(async () => {});

    act(() => {
      emitMockEvent("install-error", "Marketplace fetch failed");
    });

    expect(result.current.error).toBe("Marketplace fetch failed");
  });

  it("emit install-error clears prompt", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    await act(async () => {});

    act(() => {
      emitMockEvent("install-prompt", {
        id: "abc",
        name: "Cat",
        creator: null,
        size_bytes: 1024,
        preview_url: "/p",
        download_url: "/d",
      });
    });

    expect(result.current.prompt?.name).toBe("Cat");

    act(() => {
      emitMockEvent("install-error", "Bad format");
    });

    expect(result.current.prompt).toBeNull();
    expect(result.current.error).toBe("Bad format");
  });

  it("emit install-prompt clears error", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    await act(async () => {});

    act(() => {
      emitMockEvent("install-error", "Previous error");
    });

    expect(result.current.error).toBe("Previous error");

    act(() => {
      emitMockEvent("install-prompt", {
        id: "abc",
        name: "Cat",
        creator: null,
        size_bytes: 1024,
        preview_url: "/p",
        download_url: "/d",
      });
    });

    expect(result.current.error).toBeNull();
    expect(result.current.prompt?.name).toBe("Cat");
  });

  it("clear() resets both prompt and error to null", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    await act(async () => {});

    act(() => {
      emitMockEvent("install-error", "Some error");
    });

    expect(result.current.error).toBe("Some error");

    act(() => result.current.clear());

    expect(result.current.error).toBeNull();
    expect(result.current.prompt).toBeNull();
  });

  it("starts with null error", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.error).toBeNull();
  });

  it("unlistens install-error on unmount", async () => {
    const { unmount } = renderHook(() => useInstallPrompt());
    await act(async () => {});

    expect(listenerCount("install-error")).toBe(1);

    unmount();

    expect(listenerCount("install-error")).toBe(0);
  });
});
