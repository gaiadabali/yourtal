/**
 * The daily check-in reward ladder (YT-0177).
 *
 * Deliberately a **fixed table, not a formula with randomness anywhere
 * near it** — the acceptance criterion is "deterministic escalating
 * rewards; no chance element anywhere," and docs/09-points-economy-and-
 * redemption.md §6 already names streaks as an **unfunded-faucet risk**:
 * "points awarded for ... streaks ... have no business paying for them."
 * A fixed table is auditable and cappable in a way a random draw is not —
 * finance can look at this file and know the exact maximum weekly cost per
 * active user, which is the property a reserve-funded faucet needs.
 *
 * The ladder escalates within a 7-day cycle and then repeats — it never
 * grows unbounded, which is what keeps the faucet's per-user cost capped
 * regardless of how long a streak runs. `STREAK_CYCLE_POINTS` is the one
 * source of truth for the schedule; nothing else in this feature hardcodes
 * a reward number.
 *
 * KNOWN GAP, same shape as `features/player/chapter.ts`: there is no
 * `@yourtal/contracts/streak` schema yet (checked — it does not exist),
 * and no faucet endpoint in `packages/contracts` that could actually credit
 * a reserve-funded point grant for a check-in. This module is therefore
 * local to `apps/web`, and `streak-state.ts` persists progress to
 * localStorage only — see that file's doc comment for what that does and
 * does not promise the user. Promoting this to a real, server-settled
 * faucet is explicitly out of this ticket's reach (frontend cannot invent
 * a contract) and is called out in the ticket report.
 */

export const STREAK_CYCLE_LENGTH = 7;

/** Points for cycle days 1..7. Never edit in place without updating the doc comment above — this is the one number finance would ask for. */
export const STREAK_CYCLE_POINTS: readonly number[] = [10, 15, 20, 25, 30, 40, 75];

if (STREAK_CYCLE_POINTS.length !== STREAK_CYCLE_LENGTH) {
  throw new Error("STREAK_CYCLE_POINTS must have exactly STREAK_CYCLE_LENGTH entries");
}

/**
 * Maps a 1-indexed streak length (1 = first check-in ever, or first after a
 * break) onto its position in the 7-day cycle, also 1-indexed. Streak
 * length 8 maps back onto day 1's reward, streak length 15 also maps onto
 * day 1, and so on — the escalation resets every week rather than growing
 * forever, by design (see the doc comment above).
 */
export function cycleDayNumber(streakLength: number): number {
  if (streakLength < 1) {
    throw new RangeError("streakLength must be >= 1");
  }
  return ((streakLength - 1) % STREAK_CYCLE_LENGTH) + 1;
}

/** Points awarded for a given streak length. Pure lookup — no randomness, ever. */
export function rewardForStreakLength(streakLength: number): number {
  const dayNumber = cycleDayNumber(streakLength);
  return STREAK_CYCLE_POINTS[dayNumber - 1] ?? 0;
}
