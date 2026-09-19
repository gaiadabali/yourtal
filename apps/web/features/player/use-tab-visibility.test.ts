import { afterEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabVisibility } from "./use-tab-visibility";

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("useTabVisibility", () => {
  afterEach(() => {
    setVisibilityState("visible");
  });

  it("starts visible when the document is visible", () => {
    setVisibilityState("visible");
    const { result } = renderHook(() => useTabVisibility());
    expect(result.current).toBe(true);
  });

  it("flips to false when the document is backgrounded", () => {
    setVisibilityState("visible");
    const { result } = renderHook(() => useTabVisibility());

    act(() => {
      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe(false);
  });

  it("flips back to true when the document becomes visible again", () => {
    setVisibilityState("visible");
    const { result } = renderHook(() => useTabVisibility());

    act(() => {
      setVisibilityState("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(false);

    act(() => {
      setVisibilityState("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(true);
  });

  it("also treats a window blur as backgrounded, independent of visibilitychange", () => {
    const { result } = renderHook(() => useTabVisibility());

    act(() => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(result.current).toBe(false);
  });
});
