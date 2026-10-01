/**
 * How many points a completed, earning session is owed. 5.3.a, YT-0124.
 *
 * The base is always paid — `judgeCompletion` already gated on full
 * coverage and every question answered, so reaching this point means the
 * base half of O-1 is satisfied. The bonus is `base_only`'s whole reason to
 * exist: some campaigns pay it, some do not, and the terms version this
 * session entered under is what says which (frozen, never the campaign's
 * current, possibly-edited config — EW-20).
 *
 * The bonus requires a PERFECT score, not a partial one. `docs/18`'s
 * accuracy bonus is a bonus for attention, not a partial-credit curve, and
 * a prorated version would need its own founder-approved formula this
 * ticket was never given. Zero questions asked earns
 * no bonus: a bonus-bearing campaign under a minute is asked nothing
 * (`questionsAskedFor`), and paying the bonus there made the ledger refuse
 * the grant, so the viewer got nothing at all.
 */
export interface RewardTerms {
  readonly rewardPoints: number;
  readonly accuracyBonusPoints: number;
  readonly scoringRule: "base_only" | "base_plus_accuracy_bonus";
}

export function pointsForCompletion(terms: RewardTerms, asked: number, correct: number): number {
  // No questions asked means no accuracy to reward; the ledger's TermsPoints agrees.
  const perfectScore = asked > 0 && correct >= asked;
  const earnsBonus = terms.scoringRule === "base_plus_accuracy_bonus" && perfectScore;
  return terms.rewardPoints + (earnsBonus ? terms.accuracyBonusPoints : 0);
}
