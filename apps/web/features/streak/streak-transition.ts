import { daysBetween } from "./streak-date";
import { rewardForStreakLength } from "./streak-schedule";
import type { StreakState } from "./streak-state";

export interface CheckInResult {
  nextState: StreakState;
  /** True if `today` had already been checked into — `nextState` then equals the input state exactly, and no reward is granted a second time. */
  alreadyCheckedInToday: boolean;
  /** True if this check-in extended an existing streak; false if it started a new one (first ever, or after a missed day). */
  streakContinued: boolean;
  /** The reward for the resulting streak length. Only meaningful when `!alreadyCheckedInToday`. */
  rewardPoints: number;
}

/**
 * The pure decision at the centre of the check-in flow — parse (the
 * caller already has a validated `StreakState`) → compute (here) →
 * persist (the caller writes `nextState`), per docs/13-engineering-
 * standards.md §1's "extract the middle" move. Independently testable
 * with plain data, no localStorage and no React.
 *
 * The rule, exactly as the ticket asks and no softer: a gap of more than
 * one day since the last check-in starts the streak over at 1. Missing
 * exactly one day is not specially forgiven — the ticket did not ask for
 * a grace period, and inventing one unasked would be scope creep in the
 * other direction. **This is exactly the mechanic docs/19-cold-start-and-
 * data-strategy.md's sharing table and this ticket's own brief warn
 * about — "a streak that punishes a missed day works against a rewards
 * product" — built as specified, flagged rather than silently softened
 * or silently shipped. See the ticket report.**
 */
export function checkIn(state: StreakState, today: string): CheckInResult {
  if (state.lastCheckInDate === today) {
    return {
      nextState: state,
      alreadyCheckedInToday: true,
      streakContinued: false,
      rewardPoints: 0,
    };
  }

  const gapDays = state.lastCheckInDate === null ? null : daysBetween(state.lastCheckInDate, today);
  const streakContinued = gapDays === 1;
  const nextStreakLength = streakContinued ? state.streakLength + 1 : 1;

  return {
    nextState: { streakLength: nextStreakLength, lastCheckInDate: today },
    alreadyCheckedInToday: false,
    streakContinued,
    rewardPoints: rewardForStreakLength(nextStreakLength),
  };
}
