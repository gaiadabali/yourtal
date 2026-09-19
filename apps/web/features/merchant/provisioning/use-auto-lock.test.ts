import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoLock } from "./use-auto-lock";

const IDLE_MS = 1_000;

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useAutoLock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onIdle once the idle window elapses with no activity", () => {
    const onIdle = vi.fn();
    renderHook(() => useAutoLock(onIdle, IDLE_MS));

    act(() => {
      vi.advanceTimersByTime(IDLE_MS - 1);
    });
    expect(onIdle).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("resets the idle window on pointer activity", () => {
    const onIdle = vi.fn();
    renderHook(() => useAutoLock(onIdle, IDLE_MS));

    act(() => {
      vi.advanceTimersByTime(IDLE_MS - 1);
      window.dispatchEvent(new Event("pointerdown"));
    });
    act(() => {
      vi.advanceTimersByTime(IDLE_MS - 1);
    });
    expect(onIdle).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("locks immediately when the tab becomes hidden, without waiting for the idle timer", () => {
    const onIdle = vi.fn();
    renderHook(() => useAutoLock(onIdle, IDLE_MS));

    act(() => {
      vi.advanceTimersByTime(10);
      setVisibility("hidden");
    });
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("stops listening once unmounted", () => {
    const onIdle = vi.fn();
    const { unmount } = renderHook(() => useAutoLock(onIdle, IDLE_MS));
    unmount();

    act(() => {
      vi.advanceTimersByTime(IDLE_MS + 100);
    });
    expect(onIdle).not.toHaveBeenCalled();
  });
});
