/**
 * Campaign pacing. YT-0106.
 *
 * ## What this does NOT do, first, because it is the easiest thing to get wrong
 *
 * **Pacing is not the funded-allocation hard stop, and nothing here should
 * ever be mistaken for it.** `campaign-reward-config.ts` records where that
 * lives: `ledger.allocation` holds `remaining_points` with a
 * `CHECK (remaining_points >= 0)`, and drawdown is
 * `UPDATE ... WHERE remaining_points >= $n`, so an exhausted allocation
 * matches no row. That is the enforcement — in the value zone, owned by the
 * ledger role, atomic against concurrent drawdown.
 *
 * This module smooths spend *over time*. It answers "should we serve this
 * one right now, or are we burning the budget too fast?", and it is
 * advisory by construction: a pacing check that passes does not entitle
 * anyone to points, and a pacing check that is skipped cannot overspend the
 * allocation, because the ledger still refuses. Building a TypeScript
 * function that *looks* like the hard stop is worse than having none, since
 * the next reader will trust it.
 *
 * ## Why a campaign needs pacing at all if the ledger already hard-stops
 *
 * Because "cannot exceed the allocation" and "should not spend it all
 * before lunch" are different problems. An unpaced campaign funded for a
 * month is exhausted by whoever happens to be watching on the first
 * morning — the advertiser paid for a month of reach and bought a few
 * hours of it. The ledger is indifferent to that; it only refuses the
 * transaction after the money is gone.
 *
 * ## Read-only on the serving path — how, not merely claimed
 *
 * The serving path calls `availableTokens` / `canServe`, and neither writes
 * anything. Refill is **computed from elapsed time**, not applied by a
 * writer: given `lastRefillAt` and `now`, the tokens that have accrued
 * since are arithmetic. So serving needs no lock, no write transaction, and
 * no coordination — any number of servers can evaluate the same snapshot
 * concurrently and reach the same answer.
 *
 * Spend is recorded elsewhere, by whatever settles the grant, and arrives
 * back here as an updated `PacingState`. That asynchrony is the source of
 * the overspend window below, and it is a deliberate trade: a serving path
 * that wrote its own accounting would need a transaction per decision on
 * the hottest path in the product.
 *
 * ## Overspend is bounded by one refill interval — and by WHAT, exactly
 *
 * This bound has a precondition, and it is worth stating plainly because
 * the obvious reading of it is false.
 *
 * A read-only serving path **cannot** bound concurrent overspend on its
 * own. Twenty servers evaluating the same snapshot before any of their
 * spend has settled all see a full bucket and all say yes; their combined
 * admission is twenty times the cost, not one bucket's worth. Nothing in an
 * uncoordinated read can prevent that, and a comment claiming otherwise
 * would be describing a guarantee that does not exist. (This was caught by
 * the test that tries to break it, which is the only reason it is not
 * written here as an unqualified promise.)
 *
 * What is actually true, and what the tests pin:
 *
 * 1. **Within one accounting cycle**, admissions are bounded by the bucket
 *    only if spend settles before the next decision. It usually does not,
 *    so this is the weak half.
 * 2. **Across cycles**, the bound holds: `applySpend` is applied by a single
 *    serialised writer, and because capacity is exactly one interval's
 *    refill, a bucket can never carry more than one interval of budget into
 *    the next cycle. So a serving path that refreshes its snapshot at least
 *    once per interval overspends by at most one interval's refill,
 *    cumulatively — the excess is debited from the next cycle rather than
 *    compounding.
 * 3. **The absolute ceiling is not here at all.** `ledger.allocation`'s
 *    conditional drawdown is what makes concurrent overspend safe rather
 *    than merely bounded, and it is atomic where this is advisory.
 *
 * So the operational requirement this module places on its caller is:
 * **refresh pacing state at least once per `intervalMs`.** A caller holding
 * a snapshot for ten intervals gets ten intervals of overspend, and no
 * amount of arithmetic here prevents it.
 *
 * Capacity is derived rather than configurable for the same reason it
 * always was: a burst allowance would widen the bound in (2), which is the
 * one real guarantee this module offers.
 */

/**
 * How a campaign's spend is meant to be spread.
 *
 * `intervalMs` is the granularity of the refill and therefore also the size
 * of the overspend bound. Shorter intervals pace more smoothly and bound
 * more tightly, at the cost of more frequent accounting updates.
 */
export interface DeliverySchedule {
  /** Total points this campaign may spend across the whole flight. */
  readonly totalPoints: number;
  /** Flight start, epoch ms. */
  readonly startAtMs: number;
  /** Flight end, epoch ms. Must be after `startAtMs`. */
  readonly endAtMs: number;
  /** Refill granularity, ms. */
  readonly intervalMs: number;
}

/**
 * The stored half. Written by whatever settles spend, never by serving.
 *
 * `tokens` is the balance as of `lastRefillAt`; it is NOT the balance now.
 * Anything wanting the current figure calls `availableTokens`, which adds
 * the accrual since. Storing a "current" balance would require a writer on
 * every read to keep it honest, which is the thing this design avoids.
 */
export interface PacingState {
  readonly tokens: number;
  readonly lastRefillAtMs: number;
}

/** Number of whole refill intervals in the flight. At least one. */
export function intervalCount(schedule: DeliverySchedule): number {
  const span = schedule.endAtMs - schedule.startAtMs;
  if (span <= 0 || schedule.intervalMs <= 0) return 1;
  return Math.max(1, Math.floor(span / schedule.intervalMs));
}

/**
 * Points released per interval.
 *
 * Deliberately not rounded to an integer. Rounding down loses points across
 * a long flight — a campaign funded for 10,000 points over 3 intervals
 * would release 3,333 each and strand 1 — and rounding up lets the schedule
 * release more than the campaign was funded for, which pushes the problem
 * onto the ledger's refusal rather than solving it. The fractional
 * remainder stays in the arithmetic and is spent at whole-token
 * granularity by `canServe`.
 */
export function refillPerInterval(schedule: DeliverySchedule): number {
  return schedule.totalPoints / intervalCount(schedule);
}

/**
 * The bucket's maximum size — one interval's refill, exactly.
 *
 * **This is the overspend bound, expressed as a number.** It is derived
 * rather than configured for the reason in the header: a burst allowance
 * would be a knob that silently widens the guarantee in criterion 2.
 */
export function bucketCapacity(schedule: DeliverySchedule): number {
  return refillPerInterval(schedule);
}

/**
 * Tokens available at `nowMs`, derived — never stored, never written.
 *
 * Clamped to `bucketCapacity`, so an idle campaign does not accumulate a
 * weekend's worth of budget and dump it on Monday. That clamp is the same
 * mechanism as the overspend bound: unspent budget does not compound into
 * a burst.
 */
export function availableTokens(
  state: PacingState,
  schedule: DeliverySchedule,
  nowMs: number,
): number {
  const elapsed = nowMs - state.lastRefillAtMs;
  if (elapsed <= 0) return Math.min(state.tokens, bucketCapacity(schedule));

  const intervals = Math.floor(elapsed / schedule.intervalMs);
  const accrued = intervals * refillPerInterval(schedule);
  return Math.min(state.tokens + accrued, bucketCapacity(schedule));
}

export interface PacingVerdict {
  /** Whether pacing permits this spend now. Advisory — see the header. */
  readonly allowed: boolean;
  /** Tokens available at the moment of the check. */
  readonly available: number;
  /**
   * When enough tokens will have accrued, epoch ms. Present only when
   * refused, and absent when the campaign can never afford this cost —
   * a caller must distinguish "wait" from "never", and a far-future
   * timestamp would collapse the two.
   */
  readonly retryAtMs?: number;
}

/**
 * Whether pacing permits spending `cost` now. **Pure. Writes nothing.**
 *
 * `cost` is points, so a caller passes `maxPointsPerViewer(config)` rather
 * than a count of impressions — pacing a campaign by completions would let
 * an expensive campaign and a cheap one burn budget at wildly different
 * rates under identical pacing.
 */
export function canServe(
  state: PacingState,
  schedule: DeliverySchedule,
  nowMs: number,
  cost: number,
): PacingVerdict {
  const available = availableTokens(state, schedule, nowMs);
  if (cost <= available) {
    return { allowed: true, available };
  }

  // A cost larger than the bucket can ever hold will never be affordable by
  // waiting, however long the caller waits. Saying so is the difference
  // between a retry loop that terminates and one that does not.
  const capacity = bucketCapacity(schedule);
  if (cost > capacity) {
    return { allowed: false, available };
  }

  const shortfall = cost - available;
  const intervalsNeeded = Math.ceil(shortfall / refillPerInterval(schedule));
  return {
    allowed: false,
    available,
    retryAtMs: nowMs + intervalsNeeded * schedule.intervalMs,
  };
}

/**
 * The worst-case overspend this schedule permits, in points.
 *
 * Exposed so the bound in YT-0106's second criterion is a value a test can
 * assert on rather than a claim in a comment. If someone later introduces a
 * burst allowance, this number changes and the test that pins it fails —
 * which is the only way a documented guarantee stays true.
 */
export function maxOverspendPoints(schedule: DeliverySchedule): number {
  return bucketCapacity(schedule);
}

/**
 * The accounting half. **The only function here that produces new state.**
 *
 * Applied by whatever settles spend — a single serialised writer, never the
 * serving path. Returns a new state rather than mutating, so it composes
 * with an atomic compare-and-set by the caller.
 *
 * Tokens may go **negative**, deliberately. Clamping the floor at zero
 * would silently forgive an overspend: a cycle that admitted more than the
 * bucket held would start the next cycle full, and the excess would vanish
 * from the arithmetic that is supposed to be bounding it. Carrying the debt
 * is what makes the cumulative bound in the header true — the overspend is
 * repaid out of the next interval's refill instead of compounding.
 */
export function applySpend(
  state: PacingState,
  schedule: DeliverySchedule,
  spentPoints: number,
  nowMs: number,
): PacingState {
  // Accrue FIRST, then debit. Subtracting from the stale balance would
  // discard every token that accrued since `lastRefillAt`, so a campaign
  // that settled once per interval would lose exactly the refill it was
  // owed each time and sink into permanent debt -- pacing would throttle a
  // campaign to nothing while the schedule said it was on track.
  return {
    tokens: availableTokens(state, schedule, nowMs) - spentPoints,
    lastRefillAtMs: nowMs,
  };
}
