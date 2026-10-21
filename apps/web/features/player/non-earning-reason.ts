import type { IdentityCheckStep } from "@yourtal/contracts/identity/earning-check";

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
  | "identityCheck"
  | "identityCheckPermanentEmail"
  | "generic";

const BY_REASON: Readonly<Record<string, NonEarningReasonKey>> = {
  already_earned: "alreadyEarned",
  no_funding_configured: "noFunding",
  pending_funding_check: "notConfirmed",
  // F126: the account has not verified a permanent email yet.
  identity_check_required: "identityCheck",
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

/**
 * F126's banner for a refused identity check: asking to verify would mislead
 * someone whose email is verified but disposable, so that case says so.
 * `missing` is absent when the server did not say (the end of a session).
 */
export function identityCheckKey(
  missing: readonly IdentityCheckStep[] | undefined,
): "identityCheck" | "identityCheckPermanentEmail" {
  const onlyPermanentEmail =
    missing !== undefined && missing.length > 0 && !missing.includes("verify_email");
  return onlyPermanentEmail ? "identityCheckPermanentEmail" : "identityCheck";
}
