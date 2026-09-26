/**
 * The streak transition itself (5.5.a, F12, F16) — pure and
 * framework-free so both `apps/api`'s `modules/me` and a future worker job
 * can share exactly one implementation of "what does one more countable day
 * do to a streak".
 *
 * ## What this does NOT decide
 *
 * Region-clock day boundaries (F16), whether a user is a teen (never gets
 * the bonus), and whether the region's coverage ratio permits paying it
 * (F12: paused below 1.1) are every one of them a fact this file is not
 * given — the caller resolves `completedDays` in the region's own calendar
 * and gates each returned bonus before calling `grantAction`. This function
 * only ever answers "given these already-resolved calendar days, what is
 * the streak now, and which bonuses does it cross".
 */

export interface StreakState {
  readonly currentLength: number;
  /** Region-local `YYYY-MM-DD`, or `null` before the first counted day. */
  readonly lastCountedDate: string | null;
  /** Whether THIS streak (since its last break) has already paid day 3. */
  readonly day3Granted: boolean;
  readonly day7Granted: boolean;
}

export const INITIAL_STREAK_STATE: StreakState = {
  currentLength: 0,
  lastCountedDate: null,
  day3Granted: false,
  day7Granted: false,
};

export interface StreakBonus {
  readonly day: 3 | 7;
  /** The region-local date the streak reached this length on. */
  readonly forDate: string;
}

export interface StreakAdvance {
  readonly state: StreakState;
  readonly bonuses: readonly StreakBonus[];
}

/**
 * Folds one or more newly-countable days into a streak.
 *
 * `completedDays` must be sorted ascending and every entry strictly after
 * `state.lastCountedDate` — the caller has already turned "sessions
 * completed" into "distinct region-calendar days with at least one", which
 * is the only thing F12 counts. A day that is not the calendar day right
 * after the last counted one breaks the streak (resets to length 1) rather
 * than erroring — "a broken streak never costs points" (F12) means a gap is
 * an ordinary input, not a caller mistake.
 *
 * Processing one day at a time (not jumping straight to the final length)
 * is what lets day 3 and day 7 each be caught exactly once even when a
 * caller runs this rarely and hands over several days at once.
 */
export function advanceStreak(state: StreakState, completedDays: readonly string[]): StreakAdvance {
  let current = state;
  const bonuses: StreakBonus[] = [];

  for (const day of completedDays) {
    const consecutive =
      current.lastCountedDate !== null && isNextCalendarDay(current.lastCountedDate, day);
    const length = consecutive ? current.currentLength + 1 : 1;
    current = {
      currentLength: length,
      lastCountedDate: day,
      // A break starts a new streak, which can earn the bonus again.
      day3Granted: consecutive ? current.day3Granted : false,
      day7Granted: consecutive ? current.day7Granted : false,
    };

    // `>=`, not `===`: a caller that deferred a bonus (F12's coverage pause
    // — see `StreakService`) has already advanced `lastCountedDate` past
    // the day that first reached length 3 or 7, so a later call never
    // folds a day where the length is EXACTLY 3 or 7 again. `day3Granted`/
    // `day7Granted` staying false is what keeps this reachable — it is the
    // one thing a deferred bonus's retry depends on.
    if (length >= 3 && !current.day3Granted) {
      bonuses.push({ day: 3, forDate: day });
      current = { ...current, day3Granted: true };
    }
    if (length >= 7 && !current.day7Granted) {
      bonuses.push({ day: 7, forDate: day });
      current = { ...current, day7Granted: true };
    }
  }

  return { state: current, bonuses };
}

/** Whole-calendar-day arithmetic on `YYYY-MM-DD` strings, timezone-free by construction. */
function isNextCalendarDay(previous: string, next: string): boolean {
  const previousMs = Date.parse(`${previous}T00:00:00Z`);
  const nextMs = Date.parse(`${next}T00:00:00Z`);
  return nextMs - previousMs === 24 * 60 * 60 * 1000;
}

/** F16: one clock per region. A local constant, not a schema field — region.ts's currency table is A's. */
export const REGION_TIMEZONE: Readonly<Record<"AU" | "ID", string>> = {
  AU: "Australia/Sydney",
  ID: "Asia/Jakarta",
};

/** The region-local calendar date (`YYYY-MM-DD`) a UTC instant falls on, per F16's clock. */
export function regionDateString(instant: Date, region: "AU" | "ID"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: REGION_TIMEZONE[region],
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
