import { z } from "zod";
import { pointsSchema } from "../money/money";
import { campaignScoringRuleSchema } from "./campaign";

/**
 * The terms a viewer was shown when they started watching, frozen. YT-0101.
 *
 * ## The criterion, and why it needs a type of its own
 *
 * *"Terms shown to a user at entry are frozen for the duration of their
 * watch."* Without something like this, an advertiser editing a live
 * campaign changes what a viewer is owed **while they are watching it** —
 * someone starts a 2,000-point campaign, the advertiser drops it to 500
 * mid-view, and the reward that arrives is not the one on the entry card
 * they accepted. That is not a rare race; it is what editing a live campaign
 * *means* unless something stops it.
 *
 * Under decision O-1 the stakes are higher than they look. The reward is all
 * or nothing at completion, so a viewer gives the full thirty minutes before
 * learning what they get. There is no partial credit to soften a change made
 * at minute twenty-nine.
 *
 * ## A version, not a per-session copy
 *
 * The obvious implementation is to snapshot the terms onto each watch
 * session. That stores the same four numbers once per viewer per campaign,
 * and the copies have no guarantee of agreeing with anything.
 *
 * Instead the terms are **immutable versioned rows**: editing a
 * reward-affecting field mints a new version, and a watch session references
 * the version id it entered under. One row per distinct set of terms rather
 * than one per viewer, and the version history is an audit trail of
 * everything the campaign has ever promised — which is what a dispute needs,
 * and what a per-session copy scattered across a table cannot answer.
 *
 * ## What counts as reward-affecting
 *
 * Only the fields below. A title or synopsis edit does **not** mint a
 * version: nothing a viewer is owed depends on them, and versioning every
 * typo would bury the changes that matter. `durationSeconds` does count —
 * under O-1 the viewer must watch the *full length*, so extending it after
 * entry changes what they must do to be paid at all.
 */
export const campaignTermsSchema = z.object({
  /** Stable across versions. Identifies which campaign these terms belong to. */
  campaignId: z.uuid(),
  /**
   * Monotonic per campaign, starting at 1. A number rather than a uuid so a
   * dispute can be reasoned about in order without a join.
   */
  version: z.number().int().positive(),
  rewardPoints: pointsSchema,
  questionCount: z.number().int().min(0).max(20),
  scoringRule: campaignScoringRuleSchema,
  durationSeconds: z.number().int().positive(),
  /** When these terms began applying. */
  effectiveFrom: z.iso.datetime(),
});

export type CampaignTerms = z.infer<typeof campaignTermsSchema>;

/** The fields whose change mints a new version. Exported so the test can prove the list is honest. */
export const REWARD_AFFECTING_FIELDS = [
  "rewardPoints",
  "questionCount",
  "scoringRule",
  "durationSeconds",
] as const;

export type RewardAffectingField = (typeof REWARD_AFFECTING_FIELDS)[number];

/**
 * Whether an edit requires a new terms version.
 *
 * Compares only the reward-affecting fields, ignoring `version` and
 * `effectiveFrom` — those are properties OF a version, not part of what a
 * viewer was promised, and including them would make every comparison
 * trivially unequal.
 */
export function requiresNewTermsVersion(
  current: CampaignTerms,
  proposed: Pick<CampaignTerms, RewardAffectingField>,
): boolean {
  return REWARD_AFFECTING_FIELDS.some((field) => current[field] !== proposed[field]);
}

/** Mints the next version from an accepted edit. */
export function nextTermsVersion(
  current: CampaignTerms,
  proposed: Pick<CampaignTerms, RewardAffectingField>,
  effectiveFrom: string,
): CampaignTerms {
  return campaignTermsSchema.parse({
    campaignId: current.campaignId,
    version: current.version + 1,
    rewardPoints: proposed.rewardPoints,
    questionCount: proposed.questionCount,
    scoringRule: proposed.scoringRule,
    durationSeconds: proposed.durationSeconds,
    effectiveFrom,
  });
}
