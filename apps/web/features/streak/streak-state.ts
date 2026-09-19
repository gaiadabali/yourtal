import * as z from "zod/mini";

/**
 * Persists streak progress to localStorage (YT-0177) — same rationale and
 * the same failure discipline as `features/player/resume-position.ts`:
 * localStorage is a process boundary (another tab, a stale schema
 * version, a tampered value), so every read is Zod-parsed and every
 * read/write is wrapped in try/catch. A corrupt or missing entry must
 * never break the check-in screen — it degrades to "no streak yet."
 *
 * Uses `zod/mini` rather than `zod` for the same client-bundle reason
 * `resume-position.ts` does (full Zod is ~96 KB gz; this feature's card is
 * a client leaf on the Earn board, which is already near the initial-JS
 * budget — docs/13b-typescript-standards.md §8).
 *
 * **What this does NOT do, and this is the load-bearing caveat**: this
 * only remembers a streak *locally, on this device*. It does not credit
 * points to the wallet balance, because there is no faucet endpoint to
 * call — see `streak-schedule.ts`'s KNOWN GAP note. `streak-check-in-
 * card.tsx` is written to never imply otherwise: it shows a streak and a
 * reward *schedule*, never a claim that points have landed in the wallet.
 */
const STORAGE_KEY = "yourtal:streak:v1";

export const streakStateSchema = z.object({
  streakLength: z.number().check(z.minimum(0)),
  /** `YYYY-MM-DD`, or null before the first ever check-in. */
  lastCheckInDate: z.nullable(z.string().check(z.minLength(1))),
});

export type StreakState = z.infer<typeof streakStateSchema>;

export const INITIAL_STREAK_STATE: StreakState = { streakLength: 0, lastCheckInDate: null };

/** Reads the persisted streak, or the initial (zero) state if there is none or it fails to validate. */
export function readStreakState(): StreakState {
  try {
    if (typeof window === "undefined") {
      return INITIAL_STREAK_STATE;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return INITIAL_STREAK_STATE;
    }
    const parsed: unknown = JSON.parse(raw);
    const result = streakStateSchema.safeParse(parsed);
    return result.success ? result.data : INITIAL_STREAK_STATE;
  } catch {
    return INITIAL_STREAK_STATE;
  }
}

/** Best-effort write. A failure here loses no reward that was ever actually granted — see this file's doc comment — so it is silently ignored. */
export function writeStreakState(state: StreakState): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode, quota exceeded, or storage disabled.
  }
}
