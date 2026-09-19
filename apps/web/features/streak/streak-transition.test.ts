import { describe, expect, it } from "vitest";
import { rewardForStreakLength } from "./streak-schedule";
import type { StreakState } from "./streak-state";
import { checkIn } from "./streak-transition";

const NONE: StreakState = { streakLength: 0, lastCheckInDate: null };

describe("checkIn", () => {
  it("starts a streak at 1 on the very first check-in", () => {
    const result = checkIn(NONE, "2026-09-20");
    expect(result.alreadyCheckedInToday).toBe(false);
    expect(result.streakContinued).toBe(false);
    expect(result.nextState).toStrictEqual({ streakLength: 1, lastCheckInDate: "2026-09-20" });
    expect(result.rewardPoints).toBe(rewardForStreakLength(1));
  });

  it("extends the streak by 1 on a consecutive day", () => {
    const state: StreakState = { streakLength: 3, lastCheckInDate: "2026-09-20" };
    const result = checkIn(state, "2026-09-21");
    expect(result.streakContinued).toBe(true);
    expect(result.nextState.streakLength).toBe(4);
    expect(result.rewardPoints).toBe(rewardForStreakLength(4));
  });

  it("is a no-op if today was already checked into — never grants the reward twice", () => {
    const state: StreakState = { streakLength: 3, lastCheckInDate: "2026-09-20" };
    const result = checkIn(state, "2026-09-20");
    expect(result.alreadyCheckedInToday).toBe(true);
    expect(result.nextState).toBe(state);
    expect(result.rewardPoints).toBe(0);
  });

  it("resets the streak to 1 after a missed day — built exactly as the ticket specifies, not softened (see the ticket report's flag on this)", () => {
    const state: StreakState = { streakLength: 6, lastCheckInDate: "2026-09-20" };
    const result = checkIn(state, "2026-09-22"); // 2026-09-21 was missed
    expect(result.streakContinued).toBe(false);
    expect(result.nextState.streakLength).toBe(1);
    expect(result.rewardPoints).toBe(rewardForStreakLength(1));
  });

  it("resets the streak to 1 after any gap longer than a single missed day", () => {
    const state: StreakState = { streakLength: 6, lastCheckInDate: "2026-09-01" };
    const result = checkIn(state, "2026-09-22");
    expect(result.nextState.streakLength).toBe(1);
  });
});
