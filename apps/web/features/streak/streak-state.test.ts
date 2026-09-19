import { beforeEach, describe, expect, it, vi } from "vitest";
import { INITIAL_STREAK_STATE, readStreakState, writeStreakState } from "./streak-state";

describe("streak-state", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a written state", () => {
    writeStreakState({ streakLength: 4, lastCheckInDate: "2026-09-20" });
    expect(readStreakState()).toEqual({ streakLength: 4, lastCheckInDate: "2026-09-20" });
  });

  it("returns the initial (zero) state when nothing has been written yet", () => {
    expect(readStreakState()).toEqual(INITIAL_STREAK_STATE);
  });

  it("treats a corrupted (non-JSON) stored value as the initial state, never throwing", () => {
    window.localStorage.setItem("yourtal:streak:v1", "{not json");
    expect(() => readStreakState()).not.toThrow();
    expect(readStreakState()).toEqual(INITIAL_STREAK_STATE);
  });

  it("treats a value that fails schema validation (wrong shape) as the initial state", () => {
    window.localStorage.setItem(
      "yourtal:streak:v1",
      JSON.stringify({ streakLength: "not a number" }),
    );
    expect(readStreakState()).toEqual(INITIAL_STREAK_STATE);
  });

  it("does not throw when localStorage.getItem itself throws (private-mode simulation)", () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new DOMException("blocked");
    });
    expect(() => readStreakState()).not.toThrow();
    expect(readStreakState()).toEqual(INITIAL_STREAK_STATE);
    spy.mockRestore();
  });

  it("does not throw when localStorage.setItem itself throws (quota-exceeded simulation)", () => {
    const spy = vi.spyOn(window.localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded");
    });
    expect(() =>
      writeStreakState({ streakLength: 1, lastCheckInDate: "2026-09-20" }),
    ).not.toThrow();
    spy.mockRestore();
  });
});
