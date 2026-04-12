import { renderHook, act } from "@testing-library/react";
import { useVisitors } from "../../hooks/useVisitors";
import { emitMockEvent } from "../../__mocks__/tauri-event";
import { listen } from "@tauri-apps/api/event";

describe("useVisitors", () => {
  it("returns empty array initially", () => {
    const { result } = renderHook(() => useVisitors());
    expect(result.current).toEqual([]);
  });

  it("adds visitor on 'visitor-arrived' event", async () => {
    const { result } = renderHook(() => useVisitors());

    await act(async () => {
      emitMockEvent("visitor-arrived", {
        instance_name: "Buddy-1234",
        pet: "dalmatian",
        nickname: "Buddy",
        duration_secs: 30,
      });
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toEqual({
      instance_name: "Buddy-1234",
      pet: "dalmatian",
      nickname: "Buddy",
      duration_secs: 30,
    });
  });

  it("adds multiple visitors", async () => {
    const { result } = renderHook(() => useVisitors());

    await act(async () => {
      emitMockEvent("visitor-arrived", {
        instance_name: "Buddy-1234",
        pet: "dalmatian",
        nickname: "Buddy",
        duration_secs: 30,
      });
      emitMockEvent("visitor-arrived", {
        instance_name: "Rex-5678",
        pet: "rottweiler",
        nickname: "Rex",
        duration_secs: 60,
      });
    });

    expect(result.current).toHaveLength(2);
  });

  it("removes visitor by instance_name on 'visitor-left' event", async () => {
    const { result } = renderHook(() => useVisitors());

    await act(async () => {
      emitMockEvent("visitor-arrived", {
        instance_name: "Buddy-1234",
        pet: "dalmatian",
        nickname: "Buddy",
        duration_secs: 30,
      });
      emitMockEvent("visitor-arrived", {
        instance_name: "Rex-5678",
        pet: "rottweiler",
        nickname: "Rex",
        duration_secs: 60,
      });
    });

    expect(result.current).toHaveLength(2);

    await act(async () => {
      emitMockEvent("visitor-left", { instance_name: "Buddy-1234", nickname: "Buddy" });
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].nickname).toBe("Rex");
  });

  it("falls back to nickname removal when instance_name is empty", async () => {
    const { result } = renderHook(() => useVisitors());

    await act(async () => {
      emitMockEvent("visitor-arrived", {
        instance_name: "",
        pet: "dalmatian",
        nickname: "Buddy",
        duration_secs: 30,
      });
    });

    expect(result.current).toHaveLength(1);

    await act(async () => {
      emitMockEvent("visitor-left", { instance_name: "", nickname: "Buddy" });
    });

    expect(result.current).toHaveLength(0);
  });

  it("cleans up listeners on unmount", async () => {
    const { result, unmount } = renderHook(() => useVisitors());

    expect(listen).toHaveBeenCalledWith("visitor-arrived", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("visitor-left", expect.any(Function));

    unmount();

    // Emit event after unmount — state should not change
    await act(async () => {
      emitMockEvent("visitor-arrived", { instance_name: "Ghost-9999", nickname: "Ghost", pet: "dalmatian", duration_secs: 30 });
    });

    expect(result.current).toEqual([]);
  });
});
