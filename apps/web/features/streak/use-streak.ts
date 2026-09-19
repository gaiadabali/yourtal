"use client";

import { useCallback, useEffect, useState } from "react";
import { dateKey } from "./streak-date";
import { cycleDayNumber, rewardForStreakLength } from "./streak-schedule";
import { INITIAL_STREAK_STATE, readStreakState, writeStreakState } from "./streak-state";
import { checkIn } from "./streak-transition";

export interface UseStreakResult {
  streakLength: number;
  /** 1..STREAK_CYCLE_LENGTH — where today's check-in (already made, or on offer) lands on the ladder. */
  cycleDay: number;
  hasCheckedInToday: boolean;
  /** Reward for today's check-in — already granted if `hasCheckedInToday`, otherwise on offer. Display only — see streak-state.ts's caveat. */
  todaysReward: number;
  handleCheckIn: () => void;
}

/**
 * Owns streak state and the check-in action, so `streak-check-in-card.tsx`
 * stays markup (docs/13-engineering-standards.md §2: "3+ useState plus an
 * effect -> extract hook").
 *
 * The "what would checking in today do" preview reuses the same pure
 * `checkIn()` (streak-transition.ts) that the actual check-in commits —
 * calling it with `lastCheckInDate === today` already yields the correct
 * no-op and correctly re-derives whether a gap would reset the streak.
 * Re-deriving that rule by hand a second time here is exactly the kind of
 * duplicate logic that drifts.
 *
 * Reads localStorage only after mount (state starts at `INITIAL_STREAK_
 * STATE` and `today` starts `null`) — the same SSR-safe pattern
 * `resume-position.ts`'s callers use: this is a client leaf, so it never
 * runs during the RSC render, but React still hydrates from a
 * server-rendered pass that has no access to the browser's storage, and
 * reading synchronously during render would mismatch that pass.
 */
export function useStreak(): UseStreakResult {
  const [state, setState] = useState(INITIAL_STREAK_STATE);
  const [today, setToday] = useState<string | null>(null);

  useEffect(() => {
    const now = dateKey(new Date());
    setToday(now);
    setState(readStreakState());
  }, []);

  const handleCheckIn = useCallback(() => {
    if (today === null) {
      return;
    }
    setState((current) => {
      const result = checkIn(current, today);
      if (!result.alreadyCheckedInToday) {
        writeStreakState(result.nextState);
      }
      return result.nextState;
    });
  }, [today]);

  if (today === null) {
    return {
      streakLength: 0,
      cycleDay: 1,
      hasCheckedInToday: false,
      todaysReward: 0,
      handleCheckIn,
    };
  }

  const preview = checkIn(state, today);
  // Already checked in today: `preview.nextState` equals the committed
  // `state` and its reward already landed on the ladder, so look that
  // reward up directly rather than through `preview.rewardPoints`, which
  // the no-op branch of `checkIn()` deliberately reports as 0 (it is not
  // granting anything a second time).
  const todaysReward = preview.alreadyCheckedInToday
    ? rewardForStreakLength(state.streakLength)
    : preview.rewardPoints;

  return {
    // `state.streakLength` — the committed count — never `preview`'s: a
    // streak the user has not actually reached must never be displayed
    // as already reached. `preview.nextState.streakLength` is exactly
    // that not-yet-real number before today's check-in happens, and
    // showing it here was a real bug caught by this feature's own test
    // (see streak-check-in-card.test.tsx's first case) — it made a
    // brand-new visitor see "1-day streak" before ever tapping the
    // button, the same class of dishonesty O-1 exists to prevent
    // elsewhere in this app, just in a different feature.
    streakLength: state.streakLength,
    cycleDay: cycleDayNumber(preview.nextState.streakLength),
    hasCheckedInToday: preview.alreadyCheckedInToday,
    todaysReward,
    handleCheckIn,
  };
}
