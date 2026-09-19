import { describe, expect, it } from "vitest";
import {
  cycleDayNumber,
  rewardForStreakLength,
  STREAK_CYCLE_LENGTH,
  STREAK_CYCLE_POINTS,
} from "./streak-schedule";

describe("cycleDayNumber", () => {
  it("maps streak length 1 to day 1", () => {
    expect(cycleDayNumber(1)).toBe(1);
  });

  it("maps streak length 7 to day 7, the last day of the cycle", () => {
    expect(cycleDayNumber(7)).toBe(7);
  });

  it("wraps streak length 8 back onto day 1 — escalation resets, never grows unbounded", () => {
    expect(cycleDayNumber(8)).toBe(1);
  });

  it("wraps streak length 15 onto day 1 again (two full cycles plus one)", () => {
    expect(cycleDayNumber(15)).toBe(1);
  });

  it("throws for a streak length below 1 — there is no day 0", () => {
    expect(() => cycleDayNumber(0)).toThrow(RangeError);
  });
});

describe("rewardForStreakLength", () => {
  it("is a pure lookup into the fixed table — same input, same output, every time", () => {
    for (let i = 0; i < 5; i += 1) {
      expect(rewardForStreakLength(4)).toBe(STREAK_CYCLE_POINTS[3]);
    }
  });

  it("escalates strictly within the cycle (no chance element — every value is fixed)", () => {
    const rewards = Array.from({ length: STREAK_CYCLE_LENGTH }, (_, i) =>
      rewardForStreakLength(i + 1),
    );
    for (let i = 1; i < rewards.length; i += 1) {
      expect(rewards[i]).toBeGreaterThan(rewards[i - 1] ?? 0);
    }
  });

  it("repeats the exact same schedule on the second cycle", () => {
    for (let day = 1; day <= STREAK_CYCLE_LENGTH; day += 1) {
      expect(rewardForStreakLength(day + STREAK_CYCLE_LENGTH)).toBe(rewardForStreakLength(day));
    }
  });
});
