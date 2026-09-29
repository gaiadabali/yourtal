import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWatchTimeReminder } from "./use-watch-time-reminder";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
}

describe("useWatchTimeReminder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not show before 45 minutes of foreground time", () => {
    const { result } = renderHook(() => useWatchTimeReminder(true));
    act(() => {
      vi.advanceTimersByTime(44 * 60 * 1000);
    });
    expect(result.current.show).toBe(false);
  });

  it("shows once 45 minutes of foreground time have passed", () => {
    const { result } = renderHook(() => useWatchTimeReminder(true));
    act(() => {
      vi.advanceTimersByTime(45 * 60 * 1000);
    });
    expect(result.current.show).toBe(true);
  });

  it("does not count time while the tab is hidden", () => {
    const { result } = renderHook(() => useWatchTimeReminder(true));
    act(() => {
      setHidden(true);
      vi.advanceTimersByTime(45 * 60 * 1000);
    });
    expect(result.current.show).toBe(false);
  });

  it("never shows when disabled (an adult viewer)", () => {
    const { result } = renderHook(() => useWatchTimeReminder(false));
    act(() => {
      vi.advanceTimersByTime(120 * 60 * 1000);
    });
    expect(result.current.show).toBe(false);
  });

  it("dismiss hides it and it does not come back on its own", () => {
    const { result } = renderHook(() => useWatchTimeReminder(true));
    act(() => {
      vi.advanceTimersByTime(45 * 60 * 1000);
    });
    expect(result.current.show).toBe(true);

    act(() => result.current.dismiss());
    expect(result.current.show).toBe(false);

    act(() => {
      vi.advanceTimersByTime(45 * 60 * 1000);
    });
    expect(result.current.show).toBe(false);
  });
});
