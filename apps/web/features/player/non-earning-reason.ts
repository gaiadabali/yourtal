/**
 * Maps the API's `nonEarningReason` to a `player.refusal.reasons.*` catalogue
 * key. The API sends either a short code (`already_earned`,
 * `no_funding_configured`, `pending_funding_check`) or, for a ledger refusal,
 * its English sentence (`apps/api/src/modules/watch/ledger-refusal.ts`, never
 * localised). The sentences are matched exactly so the viewer reads the
 * reason in their own language; anything unknown gets the generic line, never
 * raw API text. `non-earning-reason.test.ts` pins the sentences.
 */
export type NonEarningReasonKey =
  | "alreadyEarned"
  | "campaignCapReached"
  | "campaignDailyCapReached"
  | "outOfFunding"
  | "noFunding"
  | "paused"
  | "notAvailable"
  | "velocityCapped"
  | "unavailable"
  | "notConfirmed"
  | "generic";

const BY_REASON: Readonly<Record<string, NonEarningReasonKey>> = {
  already_earned: "alreadyEarned",
  no_funding_configured: "noFunding",
  pending_funding_check: "notConfirmed",
  "This campaign has given out all its rewards.": "campaignCapReached",
  "This campaign has given out today's rewards. You can earn from it again tomorrow.":
    "campaignDailyCapReached",
  "This campaign has run out of funding right now.": "outOfFunding",
  "Rewards are paused right now.": "paused",
  "This campaign is not available to your account.": "notAvailable",
  "You have reached today's earning limit.": "velocityCapped",
  "Rewards are temporarily unavailable.": "unavailable",
  "You have already earned points for this video.": "alreadyEarned",
  "Your points could not be confirmed right now.": "notConfirmed",
  "This campaign could not be funded right now.": "outOfFunding",
};

export function nonEarningReasonKey(reason: string | null): NonEarningReasonKey {
  if (reason === null || !Object.hasOwn(BY_REASON, reason)) return "generic";
  return BY_REASON[reason] ?? "generic";
}
