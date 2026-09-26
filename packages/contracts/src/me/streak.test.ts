import { describe, expect, it } from "vitest";
import { INITIAL_STREAK_STATE, advanceStreak, regionDateString } from "./streak";

describe("advanceStreak", () => {
  it("counts three consecutive days and pays the day-3 bonus exactly once", () => {
    const { state, bonuses } = advanceStreak(INITIAL_STREAK_STATE, [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
    expect(state.currentLength).toBe(3);
    expect(state.lastCountedDate).toBe("2026-09-03");
    expect(bonuses).toEqual([{ day: 3, forDate: "2026-09-03" }]);
  });

  it("pays day 3 then day 7 across seven consecutive days, both exactly once", () => {
    const days = [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
    ];
    const { state, bonuses } = advanceStreak(INITIAL_STREAK_STATE, days);
    expect(state.currentLength).toBe(7);
    expect(bonuses).toEqual([
      { day: 3, forDate: "2026-09-03" },
      { day: 7, forDate: "2026-09-07" },
    ]);
  });

  it("a gap breaks the streak and restarts counting at length 1 with no bonus", () => {
    const afterThree = advanceStreak(INITIAL_STREAK_STATE, [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]).state;
    const { state, bonuses } = advanceStreak(afterThree, ["2026-09-05"]);
    expect(state.currentLength).toBe(1);
    expect(state.lastCountedDate).toBe("2026-09-05");
    expect(bonuses).toEqual([]);
  });

  it("a broken-then-restarted streak can earn the day-3 bonus again", () => {
    const broken = advanceStreak(INITIAL_STREAK_STATE, [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-05",
    ]).state;
    const { bonuses } = advanceStreak(broken, ["2026-09-06", "2026-09-07"]);
    expect(bonuses).toEqual([{ day: 3, forDate: "2026-09-07" }]);
  });

  it("retries a deferred bonus even after the streak has moved past the length that first earned it", () => {
    // Simulates a caller (StreakService) that reached length 3 on day 3 but
    // could not pay it (F12's coverage pause) and reverted only the
    // `day3Granted` flag — the length and lastCountedDate already advanced.
    const deferred = {
      currentLength: 4,
      lastCountedDate: "2026-09-04",
      day3Granted: false,
      day7Granted: false,
    };
    const { bonuses } = advanceStreak(deferred, ["2026-09-05"]);
    expect(bonuses).toEqual([{ day: 3, forDate: "2026-09-05" }]);
  });

  it("never pays the same bonus twice for one unbroken streak", () => {
    const afterSeven = advanceStreak(INITIAL_STREAK_STATE, [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
    ]).state;
    const { bonuses } = advanceStreak(afterSeven, ["2026-09-08"]);
    expect(bonuses).toEqual([]);
  });
});

describe("regionDateString", () => {
  it("AU (Australia/Sydney, UTC+10/+11) reads a UTC evening as the next local day", () => {
    // 2026-01-05T14:00:00Z is 2026-01-06 01:00 AEDT (+11).
    expect(regionDateString(new Date("2026-01-05T14:00:00Z"), "AU")).toBe("2026-01-06");
  });

  it("ID (Asia/Jakarta, fixed UTC+7, no DST) is stable year-round", () => {
    expect(regionDateString(new Date("2026-01-05T18:00:00Z"), "ID")).toBe("2026-01-06");
    expect(regionDateString(new Date("2026-07-05T18:00:00Z"), "ID")).toBe("2026-07-06");
  });
});
