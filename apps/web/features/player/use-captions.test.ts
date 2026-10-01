import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { CAPTIONS_STORAGE_KEY, useCaptions } from "./use-captions";

function fakeVideo(initialMode: TextTrackMode) {
  const track = { mode: initialMode };
  const textTracks = Object.assign([track], {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  return { ref: { current: { textTracks } as unknown as HTMLVideoElement }, track };
}

describe("useCaptions (13.9.e)", () => {
  beforeEach(() => window.localStorage.clear());

  it("follows the OS setting when the viewer never chose", () => {
    const { ref, track } = fakeVideo("showing");
    const { result } = renderHook(() => useCaptions(ref, true));
    expect(result.current.on).toBe(true);
    expect(track.mode).toBe("showing");
  });

  it("starts off when the OS shows nothing and there is no choice", () => {
    const { ref, track } = fakeVideo("disabled");
    const { result } = renderHook(() => useCaptions(ref, true));
    expect(result.current.on).toBe(false);
    expect(track.mode).toBe("hidden");
  });

  it("a saved choice beats the OS setting, and toggling saves it", () => {
    window.localStorage.setItem(CAPTIONS_STORAGE_KEY, "off");
    const { ref, track } = fakeVideo("showing");
    const { result } = renderHook(() => useCaptions(ref, true));
    expect(result.current.on).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.on).toBe(true);
    expect(track.mode).toBe("showing");
    expect(window.localStorage.getItem(CAPTIONS_STORAGE_KEY)).toBe("on");
  });
});
